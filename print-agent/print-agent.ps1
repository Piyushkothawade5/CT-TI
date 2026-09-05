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
  Start-Process -FilePath $cfg.bartendExe -ArgumentList "/F=`"$FilePath`"" | Out-Null
}

function Invoke-SaveJob {
  param($Job)
  $safe = Get-SafeItemCode $Job.item_code
  $dir = Join-Path $cfg.libraryDir $safe
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $target = Join-Path $dir "$safe.btw"
  if (-not $Job.btw_base64) { throw "save job has no btw_base64 payload" }
  [IO.File]::WriteAllBytes($target, [Convert]::FromBase64String($Job.btw_base64))
  Open-InBarTender $target
  Set-JobStatus -Id $Job.id -Status "saved"
  Write-Host "[save] $($Job.item_code) -> $target (opened in BarTender)"
}

# Headless print via BarTender XML Script: opens the work file and prints one job of
# `Count` serialized labels (BarTender increments the serial across them). Detects and
# reports a BarTender error dialog instead of hanging.
function Get-SpoolJobIds {
  param([string]$Printer)
  try { return @(Get-PrintJob -PrinterName $Printer -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) } catch { return @() }
}

# Print via XML Script and CONFIRM it before returning: a print counts only if a
# job actually reached the target printer's spooler (or BarTender raised an error,
# in which case we throw so the caller releases the reservation). No printer / no
# spooled job / an error dialog => throw => nothing is counted.
function Invoke-XmlScriptPrint {
  param([string]$WorkFile, [int]$Count)
  if (-not $cfg.printerName) {
    throw "printerName is not set in config.json. It is required to confirm a print before counting it - set it to the SATO printer's exact Windows name."
  }
  $printer = $cfg.printerName
  $btxml = Join-Path $cfg.tempDir ("job-" + [IO.Path]::GetFileNameWithoutExtension($WorkFile) + ".btxml")
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

  $before = Get-SpoolJobIds $printer
  $p = Start-Process -FilePath $cfg.bartendExe -ArgumentList "/XMLScript=`"$btxml`"" -PassThru
  $deadline = (Get-Date).AddSeconds([int]$cfg.printTimeoutSeconds)
  $spooled = $false
  $errText = $null
  try {
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 500
      $errText = [BtWin]::FindError()
      if ($errText) { break }
      if ((Get-SpoolJobIds $printer | Where-Object { $before -notcontains $_ }).Count -gt 0) { $spooled = $true; break }
      if ($p.HasExited) {
        if ((Get-SpoolJobIds $printer | Where-Object { $before -notcontains $_ }).Count -gt 0) { $spooled = $true }
        break
      }
    }
  } finally {
    Remove-Item $btxml -Force -ErrorAction SilentlyContinue
  }

  if ($errText) {
    try { $p | Stop-Process -Force } catch {}
    Get-Process bartend -ErrorAction SilentlyContinue | Stop-Process -Force
    throw "BarTender did not print (nothing counted): $errText"
  }
  if (-not $spooled) {
    try { if (-not $p.HasExited) { $p | Stop-Process -Force } } catch {}
    throw "Print not confirmed - no job reached printer '$printer' within $($cfg.printTimeoutSeconds)s. Nothing counted."
  }
}

function Invoke-PrintJob {
  param($Job)
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

  $count = [int]$Job.label_count; if ($count -lt 1) { $count = 1 }
  $start = "$($Job.serial_start)"

  # Inject the starting serial into the working copy. The batch quantity is applied
  # at print time via XML Script (NumberSerializedLabels), not baked into the file.
  & $cfg.nodeExe $patchScript $work $start | Out-Null
  $code = $LASTEXITCODE
  if ($code -eq 2) { throw "The saved label has no 'Sr No' serial field to inject. Keep that field on the label." }
  elseif ($code -ne 0) { throw "Serial injection failed (exit $code)." }

  if ($cfg.autoPrint) {
    # One XML Script job prints all `count` serialized labels headlessly.
    Invoke-XmlScriptPrint $work $count
    Remove-Item $work -Force -ErrorAction SilentlyContinue
    Set-JobStatus -Id $Job.id -Status "done"
    Write-Host "[print] $($Job.item_code) DONE x$count start=$start (single XML Script job)"
  } else {
    # Manual mode: open in BarTender with the serial injected; operator sets qty and prints.
    Open-InBarTender $work
    Set-JobStatus -Id $Job.id -Status "opened"
    Write-Host "[print] $($Job.item_code) x$count start=$start (opened in BarTender - manual mode)"
  }
}

function Remove-StaleTempFiles {
  if (-not (Test-Path $cfg.tempDir)) { return }
  $cutoff = (Get-Date).AddMinutes(-1 * [double]$cfg.tempMaxAgeMinutes)
  Get-ChildItem -Path $cfg.tempDir -Filter *.btw -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object { try { Remove-Item $_.FullName -Force } catch {} }
}

Write-Host "CT-TI print agent starting. Library: $($cfg.libraryDir)  Poll: $($cfg.pollSeconds)s"
# Initial sign-in, but a transient network/auth blip must NOT kill the agent -
# Invoke-Rest re-authenticates lazily inside the loop, so just log and keep going.
try { Get-AuthToken } catch { Write-Warning "initial sign-in failed: $($_.Exception.Message) - will retry while polling." }

while ($true) {
  try {
    $jobs = Invoke-Rest -Method Get -Path "ct_print_jobs?status=eq.pending&order=created_at.asc&limit=5"
    foreach ($job in $jobs) {
      try {
        if ($job.action -eq "save") { Invoke-SaveJob $job }
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
