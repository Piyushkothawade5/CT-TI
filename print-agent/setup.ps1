# CT-TI Print Agent — one-shot setup (invoked by setup.bat, elevated).
# Installs Node if needed, installs deps, writes config.json, and registers a
# scheduled task so the agent starts automatically at every logon.
#
# SECURITY: the agent Supabase login is embedded below for zero-touch setup.
# It is a low-privilege account (reads the print queue, updates job status).
# Keep this repository PRIVATE. config.json is git-ignored so it is never committed.

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host ""
Write-Host "==== CT-TI Print Agent setup ====" -ForegroundColor Cyan

# ---- fixed settings ----
$supabaseUrl     = "https://zsjmijuofklsybtynhrm.supabase.co"
$supabaseAnonKey = "sb_publishable_915Oeq1rcCOEHW2C6l1QPA_DE0I3Kwf"
$agentEmail      = "enggctpt@shubhadapolymers.com"
$agentPassword   = "ctpt@123"
$taskName        = "CT-TI Print Agent"

# ---- 1. Node.js ----
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js not found - installing..." -ForegroundColor Yellow
  $installed = $false
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    try {
      winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
      $installed = $true
    } catch { Write-Host "winget install failed, trying direct download..." }
  }
  if (-not $installed) {
    $msi = Join-Path $env:TEMP "node-lts-x64.msi"
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi" -OutFile $msi
    Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
  }
  $env:Path = "$env:ProgramFiles\nodejs;$env:Path"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is still not available. Install Node.js LTS from https://nodejs.org and re-run setup.bat."
}
Write-Host ("Node: " + (node -v))
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { $nodeExe = "node" }

# ---- 2. dependencies ----
Write-Host "Installing agent dependencies (npm install)..."
& npm install --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

# ---- 3. detect BarTender + SATO printer ----
$bartend = (Get-ChildItem -Path @($env:ProgramFiles, ${env:ProgramFiles(x86)}) -Filter "bartend.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
if (-not $bartend) { $bartend = "C:\Program Files (x86)\Seagull\BarTender UltraLite\BarTend.exe" }
# There can be several SATO entries (e.g. 'SATO SA408' and 'SATO SA408 SEPL' on
# different USB ports). We must watch the SAME printer the label actually prints to.
# Prefer the plain 'SATO SA408' (SBPL) over the 'SEPL' variant; if unsure, the value
# is easily corrected in config.json.
$satos = @(Get-Printer -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "SATO" } | Select-Object -ExpandProperty Name)
$printer = ($satos | Where-Object { $_ -notmatch "SEPL" } | Select-Object -First 1)
if (-not $printer) { $printer = ($satos | Select-Object -First 1) }
if (-not $printer) { $printer = "" }
Write-Host ("BarTender: " + $bartend)
if ($satos.Count -gt 1) {
  Write-Host ("Multiple SATO printers found: " + ($satos -join ", ")) -ForegroundColor Yellow
  Write-Host ("Using '$printer' - if the operator prints to a different one, edit printerName in config.json.") -ForegroundColor Yellow
}
Write-Host ("SATO printer: " + $(if ($printer) { $printer } else { "(none detected - will use the label's own printer)" }))

# ---- 3b. keep printed documents (retention) on the SATO. The agent identifies OUR
#          print by our temp file's GUID in the spool queue; retention keeps that job
#          visible long enough to catch even when a label prints in a fraction of a
#          second. The agent deletes its own job after counting. ----
if ($printer) {
  try {
    Set-Printer -Name $printer -KeepPrintedJobs $true -ErrorAction Stop
    Write-Host "Enabled 'keep printed documents' on '$printer' (needed to read printed counts)."
  } catch {
    Write-Host ("Could not enable retention on '$printer': " + $_.Exception.Message) -ForegroundColor Yellow
  }
}

# ---- 4. write config.json ----
$cfg = [ordered]@{
  supabaseUrl         = $supabaseUrl
  supabaseAnonKey     = $supabaseAnonKey
  agentEmail          = $agentEmail
  agentPassword       = $agentPassword
  bartendExe          = $bartend
  nodeExe             = $nodeExe
  libraryDir          = "C:\CTLabels"
  tempDir             = "C:\CTLabels\.work"
  printerName         = $printer
  autoPrint           = $true
  printTimeoutSeconds = 60
  pollSeconds         = 3
  tempMaxAgeMinutes   = 30
  printPageOffset     = 1
}
[IO.File]::WriteAllText((Join-Path $here "config.json"), ($cfg | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
New-Item -ItemType Directory -Force -Path "C:\CTLabels\.work" | Out-Null
Write-Host "Wrote config.json and created C:\CTLabels."

# ---- 5. scheduled task: auto-start at every logon ----
# CRITICAL: the task must run as the operator actually logged in AT THE MACHINE, on
# their interactive desktop - not whatever admin account approved the UAC prompt for
# setup.bat. Otherwise the task fires on the wrong account's logon and BarTender never
# opens on the operator's screen (while a manual run as the operator works fine).
$consoleUser = $null
try { $consoleUser = (Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).UserName } catch {}
if (-not $consoleUser) { $consoleUser = "$env:USERDOMAIN\$env:USERNAME" }
Write-Host ("Auto-start will run as the logged-in user: " + $consoleUser) -ForegroundColor Cyan

$psExe   = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$agentPs = Join-Path $here "print-agent.ps1"
$action    = New-ScheduledTaskAction -Execute $psExe -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$agentPs`"" -WorkingDirectory $here
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $consoleUser
$principal = New-ScheduledTaskPrincipal -UserId $consoleUser -LogonType Interactive -RunLevel Limited
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Registered scheduled task '$taskName' for $consoleUser - starts automatically at that user's logon." -ForegroundColor Green

# ---- 6. start it now ----
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $taskName
Start-Sleep 2
Write-Host ""
Write-Host "Setup complete. The agent is running now and will auto-start on every boot/login." -ForegroundColor Green
Write-Host "To see it: Task Scheduler -> '$taskName'.  Logs: run print-agent.ps1 in a console to watch output."
Write-Host ""
Read-Host "Press Enter to close"
