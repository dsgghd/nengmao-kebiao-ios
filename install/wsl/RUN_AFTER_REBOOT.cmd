@echo off
REM Run after reboot: one click (self-elevates) to import Ubuntu and build with xtool.
REM Kept ASCII-only on purpose.
setlocal
cd /d "%~dp0\..\.."
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator rights...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_after_reboot.ps1"
echo.
echo Finished. Press any key to close.
pause >nul