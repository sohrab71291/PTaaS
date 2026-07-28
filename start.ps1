# PTaaS — one-click dev launcher.
# Starts `npm run dev` (backend + frontend + agent, see package.json) in its
# own window so its logs stay visible, then waits for the frontend dev server
# to come up and opens it in the default browser.

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$frontendUrl = 'http://localhost:5173'

Write-Host "Starting PTaaS (backend + frontend + agent) ..." -ForegroundColor Cyan

# Launch in a new window so this launcher can exit immediately while dev
# servers keep running and stay visible/inspectable in their own console.
Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', 'npm run dev' -WorkingDirectory $PSScriptRoot

Write-Host "Waiting for frontend at $frontendUrl ..." -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds(120)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        $response = Invoke-WebRequest -Uri $frontendUrl -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { $ready = $true; break }
    } catch {
        # Not up yet — keep polling.
    }
    Start-Sleep -Seconds 2
}

if ($ready) {
    Write-Host "Frontend is up — opening $frontendUrl" -ForegroundColor Green
} else {
    Write-Host "Frontend didn't respond within 120s — opening $frontendUrl anyway (check the dev server window for errors)." -ForegroundColor Yellow
}

Start-Process $frontendUrl
