<#
  CT-TI print spooler debugger.

  Purpose: capture EXACTLY what the Windows print spooler and the print-service
  event log report when the operator prints from BarTender, so we can build the
  printed-count logic from real data instead of guessing what BarTender names its
  jobs or how fast the SATO clears them.

  What it does:
    1. Prints the installed printers and the target printer name (from config.json).
    2. Dumps the most recent "document printed" events (Event ID 307) from
       Microsoft-Windows-PrintService/Operational - the most reliable source of the
       ACTUAL pages printed, and independent of catching the job mid-flight.
    3. Live-watches the target printer's queue and logs every job the moment it
       appears and every time it changes (id, DocumentName, TotalPages,
       PagesPrinted, JobStatus, Size, times).

  Usage (on the print PC, in the print-agent folder):
    powershell -ExecutionPolicy Bypass -File .\debug-spool.ps1
    powershell -ExecutionPolicy Bypass -File .\debug-spool.ps1 -Printer "SATO SA408"

  Then do ONE real print from BarTender and watch the output. Press Ctrl+C to stop.
  Everything is also saved to C:\CTLabels\spool-debug.log - send me that file.

  This script only READS; it never prints, changes the queue, or touches the app.
#>
param([string]$Printer)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Printer) {
  $cfgPath = Join-Path $scriptDir "config.json"
  if (Test-Path $cfgPath) {
    try { $Printer = (Get-Content $cfgPath -Raw | ConvertFrom-Json).printerName } catch {}
  }
}

$logPath = "C:\CTLabels\spool-debug.log"
try { New-Item -ItemType Directory -Force -Path (Split-Path $logPath) | Out-Null } catch { $logPath = Join-Path $scriptDir "spool-debug.log" }

function Log {
  param([string]$Message)
  $line = "{0} {1}" -f (Get-Date -Format "HH:mm:ss.fff"), $Message
  Write-Host $line
  try { Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8 } catch {}
}

Log "==================== spool debug start ===================="
Log ("PowerShell: " + $PSVersionTable.PSVersion.ToString() + "  User: $env:USERDOMAIN\$env:USERNAME")

Log "Installed printers:"
try { Get-Printer -ErrorAction Stop | ForEach-Object { Log ("  - '" + $_.Name + "'  (driver: " + $_.DriverName + ", port: " + $_.PortName + ")") } }
catch { Log "  Get-Printer failed: $($_.Exception.Message)" }

if (-not $Printer) {
  Log "No printer name found in config.json. Re-run with:  -Printer '<exact name from the list above>'"
  return
}
Log "Target printer: '$Printer'"

# ---- recent 'document printed' events (actual pages) ----------------------------
function Show-RecentPrintEvents {
  Log "---- recent PrintService 'document printed' (Event 307) events ----"
  try {
    $events = Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-PrintService/Operational'; Id = 307 } -MaxEvents 15 -ErrorAction Stop
    if (-not $events) { Log "  (none found yet)"; return }
    foreach ($e in ($events | Sort-Object TimeCreated)) {
      $p = $e.Properties
      $doc = if ($p.Count -gt 1) { [string]$p[1].Value } else { "" }
      $prn = if ($p.Count -gt 4) { [string]$p[4].Value } else { "" }
      $pages = if ($p.Count -gt 7) { [string]$p[7].Value } else { "?" }
      Log ("  {0}  doc='{1}' printer='{2}' pages={3}" -f $e.TimeCreated.ToString("HH:mm:ss"), $doc, $prn, $pages)
    }
  } catch {
    Log "  Could not read Microsoft-Windows-PrintService/Operational: $($_.Exception.Message)"
    Log "  If it says the log is disabled, enable it once: Event Viewer > Applications and Services Logs >"
    Log "  Microsoft > Windows > PrintService > Operational > (right-click) Enable Log. Then re-run and print."
  }
}
Show-RecentPrintEvents

# ---- live queue watch -----------------------------------------------------------
Log "----------------------------------------------------------------"
Log "Now do ONE print from BarTender. Watching the queue (Ctrl+C to stop)..."
Log "----------------------------------------------------------------"

$state = @{}
$lastEventDump = Get-Date
while ($true) {
  try {
    foreach ($j in @(Get-PrintJob -PrinterName $Printer -ErrorAction Stop)) {
      $id = [string]$j.Id
      $snap = "doc='$($j.DocumentName)' status='$($j.JobStatus)' total=$($j.TotalPages) printed=$($j.PagesPrinted) size=$($j.Size) submitted='$($j.SubmittedTime)'"
      if (-not $state.ContainsKey($id)) { Log "NEW  id=$id $snap"; $state[$id] = $snap }
      elseif ($state[$id] -ne $snap) { Log "CHG  id=$id $snap"; $state[$id] = $snap }
    }
  } catch {
    Log "Get-PrintJob error: $($_.Exception.Message)"
    Start-Sleep -Seconds 2
  }
  # Every ~10s, also re-dump completed-print events so we still capture jobs that
  # cleared the queue between polls (too fast to catch live).
  if (((Get-Date) - $lastEventDump).TotalSeconds -gt 10) { Show-RecentPrintEvents; $lastEventDump = Get-Date }
  Start-Sleep -Milliseconds 200
}
