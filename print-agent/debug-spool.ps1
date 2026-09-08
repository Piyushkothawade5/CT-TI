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

# ---- enable the PrintService Operational log (reliable actual-page source) -------
$logName = 'Microsoft-Windows-PrintService/Operational'
$script:EventLogReady = $false
function Enable-PrintServiceLog {
  try {
    $ll = Get-WinEvent -ListLog $logName -ErrorAction Stop
    if ($ll.IsEnabled) { Log "PrintService/Operational log: already enabled."; $script:EventLogReady = $true; return }
    Log "PrintService/Operational log is DISABLED - enabling it now..."
    & wevtutil sl $logName /e:true 2>&1 | Out-Null
    $ll = Get-WinEvent -ListLog $logName -ErrorAction Stop
    if ($ll.IsEnabled) { Log "  enabled OK."; $script:EventLogReady = $true }
    else { Log "  STILL disabled - re-run this script in an ADMIN PowerShell (right-click > Run as administrator)." }
  } catch {
    Log "  could not enable the log: $($_.Exception.Message)"
    Log "  Run this in an ADMIN PowerShell:  wevtutil sl `"$logName`" /e:true"
  }
}
Enable-PrintServiceLog

# ---- recent 'document printed' events (actual pages) ----------------------------
function Show-RecentPrintEvents {
  param([switch]$Quiet)
  try {
    $events = @(Get-WinEvent -FilterHashtable @{ LogName = $logName; Id = 307 } -MaxEvents 15 -ErrorAction Stop)
    if (-not $Quiet -or $events.Count -gt 0) { Log "---- recent 'document printed' (Event 307) ----" }
    foreach ($e in ($events | Sort-Object TimeCreated)) {
      $p = $e.Properties
      $doc = if ($p.Count -gt 1) { [string]$p[1].Value } else { "" }
      $prn = if ($p.Count -gt 4) { [string]$p[4].Value } else { "" }
      $pages = if ($p.Count -gt 7) { [string]$p[7].Value } else { "?" }
      Log ("  {0}  doc='{1}' printer='{2}' pages={3}" -f $e.TimeCreated.ToString("HH:mm:ss"), $doc, $prn, $pages)
    }
  } catch {
    # "No events were found" just means the log is enabled but empty so far - not an error.
    if (-not $Quiet) { Log "---- 'document printed' events: none yet ----" }
  }
}
Show-RecentPrintEvents

# ---- live queue watch -----------------------------------------------------------
Log "----------------------------------------------------------------"
Log "Now do ONE print from BarTender. Watching the queue (Ctrl+C to stop)..."
Log "----------------------------------------------------------------"

$state = @{}
$eventCount = 0
$lastHeartbeat = Get-Date
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
  # Surface any brand-new 'document printed' events (catches jobs that cleared the
  # queue too fast to see live). Only logs when the count actually grows.
  if ($script:EventLogReady) {
    try {
      $n = @(Get-WinEvent -FilterHashtable @{ LogName = $logName; Id = 307 } -MaxEvents 30 -ErrorAction Stop).Count
      if ($n -gt $eventCount) { $eventCount = $n; Show-RecentPrintEvents -Quiet }
    } catch {}
  }
  # Quiet heartbeat every 30s so you know it's alive while you set up the print.
  if (((Get-Date) - $lastHeartbeat).TotalSeconds -gt 30) { Log "...watching '$Printer' (Ctrl+C to stop)"; $lastHeartbeat = Get-Date }
  Start-Sleep -Milliseconds 200
}
