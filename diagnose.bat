@echo off
REM PTaaS — single-click troubleshooter. Checks every dependency
REM (Postgres/InfluxDB/Grafana/k6/backend/Coralogix) and auto-fixes what it can
REM (restarting stopped services, re-starting influxd) without touching config.

whoami /groups | find "S-1-16-12288" >nul 2>&1
if %errorlevel% == 0 goto :run

echo Requesting Administrator privileges...
powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b

:run
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" -Diagnose
pause
