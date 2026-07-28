@echo off
REM PTaaS — single-click dev launcher.
REM Double-click this file: it runs `npm run dev` (backend + frontend + agent)
REM in its own window and opens http://localhost:5173 once the frontend is up.

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
