@echo off
REM CT-TI Print Agent - one-click setup for the shop-floor PC.
REM Double-click this file. It will ask for admin, then set up everything and
REM make the agent start automatically at every logon. No other steps needed.

cd /d "%~dp0"

REM --- ensure we are running as administrator ---
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator permission...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
  exit /b
)

REM --- run the setup (elevated) ---
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
