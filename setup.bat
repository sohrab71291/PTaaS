@echo off
REM PTaaS — single-click Windows installer.
REM Double-click this file (or run `setup.bat` from cmd) — it self-elevates
REM to Administrator and runs setup.ps1 for you. No PowerShell knowledge needed.

whoami /groups | find "S-1-16-12288" >nul 2>&1
if %errorlevel% == 0 goto :run

echo Requesting Administrator privileges...
powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b

:run
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
pause
