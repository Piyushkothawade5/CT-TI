<#
  CT-TI label print agent (Windows PowerShell 5.1+)

  Polls the Supabase ct_print_jobs queue and, for each authorized job:
    - action 'save'  : writes the rough .btw into C:\CTLabels\<itemCode>\ and opens
                        it in BarTender so the operator can correct it and Ctrl+S.
    - action 'print' : copies the saved item-code label to a temp working file,
                        injects the TI's starting serial (patch-serial.js), and opens
                        it in BarTender for the operator to print `label_count` copies.

  The per-TI quantity lock is enforced on the server (issue_ti_labels) BEFORE the
  webapp ever creates a 'print' job, so this agent only ever executes already-counted
  work. Run it as a Scheduled Task at logon on the single print PC.

  Setup: copy config.example.json to config.json and fill it in, then:  npm install
#>

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptDir "config.json"
if (-not (Test-Path $configPath)) {
  throw "config.json not found. Copy config.example.json to config.json and fill it in."
}
$cfg = Get-Content $configPath -Raw | ConvertFrom-Json
$patchScript = Join-Path $scriptDir "patch-serial.js"

# Win32 helper to detect a BarTender modal error dialog (MFC dialogs aren't
# exposed to UI Automation, so read them via GetWindowText).
Add-Type @"
using System;using System.Text;using System.Runtime.InteropServices;using System.Collections.Generic;
public static class BtWin {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int m);
  delegate bool EnumProc(IntPtr h, IntPtr l);
  public static string FindError() {
    string result = null;
    EnumWindows((h, l) => {
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      string t = sb.ToString();
      if (t.Contains("Error Message") || t.Contains("Warning Message")) {
        var parts = new List<string>();
        EnumChildWindows(h, (ch, cl) => {
          var cb = new StringBuilder(1024); GetWindowText(ch, cb, 1024);
          string ct = cb.ToString();
          if (ct.Length > 2 && ct != "OK" && !ct.StartsWith("&")) parts.Add(ct);
          return true;
        }, IntPtr.Zero);
        result = t + " :: " + string.Join(" ", parts.ToArray());
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
"@

$script:Token = $null

function Get-AuthToken {
  $body = @{ email = $cfg.agentEmail; password = $cfg.agentPassword } | ConvertTo-Json
  $resp = Invoke-RestMethod -Method Post `
    -Uri "$($cfg.supabaseUrl)/auth/v1/token?grant_type=password" `
    -Headers @{ apikey = $cfg.supabaseAnonKey } `
    -ContentType "application/json" -Body $body
  $script:Token = $resp.access_token
  Write-Host "[auth] signed in as $($cfg.agentEmail)"
}

function Invoke-Rest {
  param([string]$Method, [string]$Path, $Body, [string]$Prefer)
  if (-not $script:Token) { Get-AuthToken }
  $headers = @{ apikey = $cfg.supabaseAnonKey; Authorization = "Bearer $($script:Token)" }
  if ($Prefer) { $headers["Prefer"] = $Prefer }
  $uri = "$($cfg.supabaseUrl)/rest/v1/$Path"
  try {
    if ($Body) {
      return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ContentType "application/json" -Body $Body
    }
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 401) {
      Get-AuthToken
      $headers["Authorization"] = "Bearer $($script:Token)"
      if ($Body) {
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ContentType "application/json" -Body $Body
      }
      return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
    }
    throw
  }
}

function Set-JobStatus {
  param([string]$Id, [string]$Status, [string]$ErrorText)
  $payload = @{ status = $Status }
  if ($ErrorText) { $payload["error"] = $ErrorText.Substring(0, [Math]::Min(500, $ErrorText.Length)) }
  Invoke-Rest -Method Patch -Path "ct_print_jobs?id=eq.$Id" -Body ($payload | ConvertTo-Json) -Prefer "return=minimal" | Out-Null
}

function Get-SafeItemCode {
  param([string]$Value)
  $safe = ($Value -replace '[^A-Za-z0-9._-]', '_').Trim('_')
  if (-not $safe) { $safe = "ITEM" }
  return $safe
}

function Open-InBarTender {
  param([string]$FilePath)
  # Open via the file association (like double-clicking the .btw) so BarTender adds
  # the document to its existing session rather than replacing/closing other open
  # labels. Fall back to the /F= switch if the association isn't wired up.
  try { Start-Process -FilePath $FilePath | Out-Null }
  catch { Start-Process -FilePath $cfg.bartendExe -ArgumentList "/F=`"$FilePath`"" | Out-Null }
}

# Save and Edit share one safe behavior: the local library file is the source of
# truth for THIS PC. If it already exists -> just open it (never overwrite the
# operator's corrections). If it's missing (e.g. this is a different PC that never
# saved it) -> create it from the template the app sent, then open it.
function Invoke-OpenLabelJob {
  param($Job)
  $safe = Get-SafeItemCode $Job.item_code
  $dir = Join-Path $cfg.libraryDir $safe
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $target = Join-Path $dir "$safe.btw"

  if (Test-Path $target) {
    Open-InBarTender $target
    Set-JobStatus -Id $Job.id -Status "saved"
    Write-Host "[$($Job.action)] $($Job.item_code) -> opened existing $target (not overwritten)"
    return
  }

  if (-not $Job.btw_base64) {
    Set-JobStatus -Id $Job.id -Status "error" -ErrorText "No saved label on this PC and no template supplied. Click Save Label to create it here first."
    Write-Host "[$($Job.action)] $($Job.item_code) -> missing file and no template data"
    return
  }

  [IO.File]::WriteAllBytes($target, [Convert]::FromBase64String($Job.btw_base64))
  Open-InBarTender $target
  Set-JobStatus -Id $Job.id -Status "saved"
  Write-Host "[$($Job.action)] $($Job.item_code) -> created + opened $target"
}

# ---- print helpers: read the ACTUAL printed count from the Windows spooler ----

function Set-JobResult {
  param([string]$Id, [int]$Count, [string]$Status, [string]$ErrorText)
  $payload = @{ status = $Status; label_count = $Count }
  if ($ErrorText) { $payload["error"] = $ErrorText.Substring(0, [Math]::Min(500, $ErrorText.Length)) }
  Invoke-Rest -Method Patch -Path "ct_print_jobs?id=eq.$Id" -Body ($payload | ConvertTo-Json) -Prefer "return=minimal" | Out-Null
}

# Snapshot the ids of jobs already sitting in the printer queue, so we only ever
# count jobs that appear AFTER we start watching (this operator's print).
function Get-SpoolBaseline {
  param([string]$Printer)
  $ids = @{}
  try { foreach ($j in Get-PrintJob -PrinterName $Printer -ErrorAction SilentlyContinue) { $ids[[string]$j.Id] = $true } } catch {}
  return $ids
}

# Scan the queue and record every job that appeared after the baseline. $Seen maps
# jobId -> @{ pages; doc; ours }. 'ours' is true when the spool DocumentName carries
# our GUID token (best case) - but BarTender usually names the spool after the label's
# OWN document name, which does not contain our token, so we also keep every new job
# and fall back to that. Returns $true when a new job appeared this scan.
function Update-NewSpool {
  param([string]$Printer, [string]$DocToken, [hashtable]$Baseline, [hashtable]$Seen)
  $found = $false
  try {
    foreach ($j in Get-PrintJob -PrinterName $Printer -ErrorAction SilentlyContinue) {
      $id = [string]$j.Id
      if ($Baseline.ContainsKey($id)) { continue }                 # pre-existing -> ignore
      $doc = [string]$j.DocumentName
      $pages = [int]$j.TotalPages; if ($pages -lt 1) { $pages = 1 }
      $ours = [bool]($doc -and $DocToken -and $doc.Contains($DocToken))
      if (-not $Seen.ContainsKey($id)) {
        $Seen[$id] = @{ pages = $pages; doc = $doc; ours = $ours }
        $found = $true
        Write-Host "[print]   new spool job id=$id doc='$doc' pages=$pages ours=$ours"
      } elseif ($pages -gt $Seen[$id].pages) {
        $Seen[$id].pages = $pages
      }
    }
  } catch {}
  return $found
}

# Total labels: prefer jobs whose DocumentName matched our token; if none matched
# (the common case with BarTender), sum all new jobs seen since the baseline.
function Get-NewSpoolTotal {
  param([hashtable]$Seen)
  $ours = 0; $all = 0
  foreach ($v in $Seen.Values) { $all += $v.pages; if ($v.ours) { $ours += $v.pages } }
  if ($ours -gt 0) { return $ours }
  return $all
}

# Is BarTender still running (the operator may still be in the print dialog)?
function Test-BarTenderRunning {
  try { return [bool](Get-Process bartend -ErrorAction SilentlyContinue) } catch { return $false }
}

# Manual mode: the operator prints in BarTender; we watch the spooler and return the
# ACTUAL number of labels produced, counting only jobs that appear after we start
# watching. Ends when: printed then BarTender closed, printed then idle for a quiet
# period, BarTender closed without printing, or a hard time cap.
function Get-ManualPrintCount {
  param([string]$Printer, [string]$DocToken)
  $baseline = Get-SpoolBaseline $Printer
  $seen = @{}
  $started = Get-Date
  $lastNew = $null
  $maxSeconds = 600        # hard cap on the whole session
  $quietSeconds = 20       # finalize this long after the last new spool job
  $noPrintGiveup = 300     # give up if nothing is ever printed
  while (((Get-Date) - $started).TotalSeconds -lt $maxSeconds) {
    Start-Sleep -Milliseconds 400
    if (Update-NewSpool $Printer $DocToken $baseline $seen) { $lastNew = Get-Date }
    $btRunning = Test-BarTenderRunning
    if ($seen.Count -gt 0 -and $lastNew -and ((Get-Date) - $lastNew).TotalSeconds -gt $quietSeconds) { break }  # printed, then idle
    if ($seen.Count -gt 0 -and -not $btRunning) { break }                                                       # printed, then closed
    if ($seen.Count -eq 0 -and -not $btRunning -and ((Get-Date) - $started).TotalSeconds -gt 15) { break }      # closed without printing
    if ($seen.Count -eq 0 -and ((Get-Date) - $started).TotalSeconds -gt $noPrintGiveup) { break }               # never printed
  }
  Start-Sleep -Milliseconds 500
  Update-NewSpool $Printer $DocToken $baseline $seen | Out-Null
  return (Get-NewSpoolTotal $seen)
}

# Automation-edition path (headless): XML Script prints $Count labels; returns the
# actual pages spooled for OUR job. Throws on a BarTender error/warning dialog.
function Invoke-XmlScriptPrint {
  param([string]$WorkFile, [int]$Count)
  $printer = $cfg.printerName
  $docToken = [IO.Path]::GetFileNameWithoutExtension($WorkFile)
  $btxml = Join-Path $cfg.tempDir ("job-" + $docToken + ".btxml")
  $doc = @"
<?xml version="1.0" encoding="utf-8"?>
<XMLScript Version="2.0">
  <Command Name="Print">
    <Print>
      <Format CloseAtEndOfJob="true">$WorkFile</Format>
      <PrintSetup>
        <NumberSerializedLabels>$Count</NumberSerializedLabels>
        <IdenticalCopiesOfLabel>1</IdenticalCopiesOfLabel>
        <Printer>$printer</Printer>
      </PrintSetup>
    </Print>
  </Command>
</XMLScript>
"@
  [IO.File]::WriteAllText($btxml, $doc, (New-Object System.Text.UTF8Encoding($false)))
  $baseline = Get-SpoolBaseline $printer
  $seen = @{}
  $p = Start-Process -FilePath $cfg.bartendExe -ArgumentList "/XMLScript=`"$btxml`"" -PassThru
  $deadline = (Get-Date).AddSeconds([int]$cfg.printTimeoutSeconds)
  $errText = $null
  try {
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 500
      $errText = [BtWin]::FindError(); if ($errText) { break }
      Update-NewSpool $printer $docToken $baseline $seen | Out-Null
      if ($p.HasExited) { Start-Sleep -Milliseconds 800; Update-NewSpool $printer $docToken $baseline $seen | Out-Null; break }
      if ((Get-NewSpoolTotal $seen) -gt 0) { break }
    }
  } finally { Remove-Item $btxml -Force -ErrorAction SilentlyContinue }
  if ($errText) {
    try { $p | Stop-Process -Force } catch {}
    Get-Process bartend -ErrorAction SilentlyContinue | Stop-Process -Force
    throw "BarTender did not print (nothing counted): $errText"
  }
  return (Get-NewSpoolTotal $seen)
}

function Invoke-PrintJob {
  param($Job)
  if (-not $cfg.printerName) {
    Set-JobStatus -Id $Job.id -Status "error" -ErrorText "printerName is not set in config.json - required to read the actual printed count. Set it to the SATO printer's exact Windows name."
    Write-Host "[print] printerName not set; cannot read printed count"
    return
  }
  $safe = Get-SafeItemCode $Job.item_code
  $label = Join-Path (Join-Path $cfg.libraryDir $safe) "$safe.btw"
  if (-not (Test-Path $label)) {
    Set-JobStatus -Id $Job.id -Status "error" -ErrorText "No saved label for item code $($Job.item_code). Use 'Save Label' first."
    Write-Host "[print] no saved label for $($Job.item_code)"
    return
  }
  New-Item -ItemType Directory -Force -Path $cfg.tempDir | Out-Null
  $work = Join-Path $cfg.tempDir "$($Job.id).btw"
  Copy-Item -Path $label -Destination $work -Force
  $start = "$($Job.serial_start)"

  # Inject the starting serial; BarTender serializes upward from it as labels print.
  & $cfg.nodeExe $patchScript $work $start | Out-Null
  $code = $LASTEXITCODE
  if ($code -eq 2) { throw "The saved label has no 'Sr No' serial field to inject. Keep that field on the label." }
  elseif ($code -ne 0) { throw "Serial injection failed (exit $code)." }

  if ($cfg.autoPrint -and $Job.label_count) {
    # Automation-edition headless path (only used if a job carries a target count).
    $actual = Invoke-XmlScriptPrint $work ([int]$Job.label_count)
    Remove-Item $work -Force -ErrorAction SilentlyContinue
  } else {
    # Manual mode: open the label; the operator sets the quantity and prints. We then
    # read the ACTUAL number of labels the printer produced from the spooler.
    Open-InBarTender $work
    Set-JobStatus -Id $Job.id -Status "opened"
    Write-Host "[print] $($Job.item_code) opened in BarTender (start=$start) - watching '$($cfg.printerName)' for actual count..."
    $actual = Get-ManualPrintCount $cfg.printerName ([IO.Path]::GetFileNameWithoutExtension($work))
    Remove-Item $work -Force -ErrorAction SilentlyContinue
  }

  if ($actual -gt 0) {
    Set-JobResult -Id $Job.id -Count $actual -Status "done"
    Write-Host "[print] $($Job.item_code) DONE - $actual label(s) actually printed (start=$start)"
  } else {
    Set-JobResult -Id $Job.id -Count 0 -Status "error" -ErrorText "No labels were printed to '$($cfg.printerName)'."
    Write-Host "[print] $($Job.item_code) - nothing printed"
  }
}

function Remove-StaleTempFiles {
  if (-not (Test-Path $cfg.tempDir)) { return }
  $cutoff = (Get-Date).AddMinutes(-1 * [double]$cfg.tempMaxAgeMinutes)
  Get-ChildItem -Path $cfg.tempDir -Filter *.btw -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object { try { Remove-Item $_.FullName -Force } catch {} }
}

# A print session left 'opened' can only be a leftover from a previous agent run
# (this is the single print PC). Clear them so begin_print's in-progress guard
# doesn't block the TI forever. The count for those sessions is unknown -> operator
# reprints if needed; admin can unlock.
function Clear-StaleOpenJobs {
  try {
    $stale = Invoke-Rest -Method Get -Path "ct_print_jobs?action=eq.print&status=eq.opened&select=id"
    foreach ($j in $stale) {
      Set-JobStatus -Id $j.id -Status "error" -ErrorText "Agent restarted while this print session was open; printed count was not recorded. Reprint if needed."
      Write-Host "[startup] cleared stale open print session $($j.id)"
    }
  } catch { Write-Warning "stale-job cleanup failed: $($_.Exception.Message)" }
}

Write-Host "CT-TI print agent starting. Library: $($cfg.libraryDir)  Poll: $($cfg.pollSeconds)s"
# Initial sign-in, but a transient network/auth blip must NOT kill the agent -
# Invoke-Rest re-authenticates lazily inside the loop, so just log and keep going.
try { Get-AuthToken; Clear-StaleOpenJobs } catch { Write-Warning "initial sign-in failed: $($_.Exception.Message) - will retry while polling." }

while ($true) {
  try {
    $jobs = Invoke-Rest -Method Get -Path "ct_print_jobs?status=eq.pending&order=created_at.asc&limit=5"
    foreach ($job in $jobs) {
      try {
        if ($job.action -eq "save" -or $job.action -eq "edit") { Invoke-OpenLabelJob $job }
        elseif ($job.action -eq "print") { Invoke-PrintJob $job }
        else { Set-JobStatus -Id $job.id -Status "error" -ErrorText "Unknown action $($job.action)" }
      } catch {
        Write-Warning "job $($job.id) failed: $($_.Exception.Message)"
        try { Set-JobStatus -Id $job.id -Status "error" -ErrorText $_.Exception.Message } catch {}
      }
    }
    Remove-StaleTempFiles
  } catch {
    Write-Warning "poll failed: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds ([int]$cfg.pollSeconds)
}
