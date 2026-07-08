<#
.SYNOPSIS
    Registers this machine as a PTaaS execution agent against a control plane
    (backend) and writes agent\.env with a fresh, valid credential.

.DESCRIPTION
    Run this on any machine that will host a k6 execution agent - whether it's
    co-located with the backend or a separate box entirely. It replaces the
    manual "copy agent\.env from another machine" step from INSTALL.md, which
    carries over a stale AGENT_ID/AGENT_API_KEY (tied to the ORIGINAL machine's
    Postgres Agent table) and a CONTROL_PLANE_URL hardcoded to localhost - the
    two most common causes of the agent looping on
    "Connected -> 1008 Unauthorized -> reconnect" or plain ECONNREFUSED.

    This script instead calls POST /api/agents/register directly against the
    control plane you specify, so agent\.env always ends up with:
      - a CONTROL_PLANE_URL that actually points at the backend (not localhost,
        unless the agent truly is co-located with it)
      - an AGENT_ID/AGENT_API_KEY pair that is guaranteed to exist in that
        backend's database, because it was just created there

.PARAMETER ControlPlaneUrl
    Base URL of the backend the agent should connect to, e.g.
    "http://192.168.1.50:3001" for a remote backend. Defaults to
    "http://localhost:3001" for a co-located deployment.

.PARAMETER Name
    Display name for this agent in the PTaaS Admin > Agents view. Defaults to
    "<hostname>-agent".

.PARAMETER Force
    Re-register even if agent\.env already has what looks like a valid
    (non-CHANGE_ME) credential. Without this switch, an existing credential is
    left untouched and the script just reports it.

.EXAMPLE
    .\register-agent.ps1 -ControlPlaneUrl "http://backend.internal:3001"

.EXAMPLE
    .\register-agent.ps1 -ControlPlaneUrl "http://10.0.0.12:3001" -Name "worker-1" -Force
#>
param(
    [string]$ControlPlaneUrl = "http://localhost:3001",
    [string]$Name = "$($env:COMPUTERNAME)-agent",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ControlPlaneUrl = $ControlPlaneUrl.TrimEnd('/')
$agentEnvPath = Join-Path $PSScriptRoot "agent\.env"

function Info    { param([string]$msg) Write-Host "[register-agent] $msg" -ForegroundColor Cyan }
function Success { param([string]$msg) Write-Host "[register-agent] $msg" -ForegroundColor Green }
function ErrOut  { param([string]$msg) Write-Host "[register-agent] $msg" -ForegroundColor Red }

if (-not (Test-Path (Join-Path $PSScriptRoot "agent"))) {
    ErrOut "No 'agent' directory found next to this script ($PSScriptRoot). Run this from the repo root, or copy the whole repo here first."
    exit 1
}

if ((Test-Path $agentEnvPath) -and -not $Force) {
    $existing = Get-Content $agentEnvPath
    $existingId = ($existing | Where-Object { $_ -match '^AGENT_ID=' }) -replace '.*="(.*)"', '$1'
    if ($existingId -and $existingId -ne "CHANGE_ME") {
        Info "agent\.env already has a credential (AGENT_ID: $existingId)."
        Info "Re-run with -Force to overwrite it, e.g. if the backend's database was reset or this file was copied from another machine."
        exit 0
    }
}

Info "Registering against $ControlPlaneUrl as '$Name'..."

try {
    $body = @{ name = $Name; hostname = $env:COMPUTERNAME } | ConvertTo-Json
    $resp = Invoke-RestMethod -Uri "$ControlPlaneUrl/api/agents/register" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 15
} catch {
    ErrOut "Could not reach $ControlPlaneUrl/api/agents/register."
    ErrOut "Check that: the backend is running, this machine can reach that host/port (firewall/security group), and the URL/port are correct."
    ErrOut "Underlying error: $($_.Exception.Message)"
    exit 1
}

if (-not $resp.agentId -or -not $resp.apiKey) {
    ErrOut "Backend responded but didn't return an agentId/apiKey. Response: $($resp | ConvertTo-Json -Compress)"
    exit 1
}

@"
CONTROL_PLANE_URL="$ControlPlaneUrl"
AGENT_ID="$($resp.agentId)"
AGENT_API_KEY="$($resp.apiKey)"
"@ | Set-Content $agentEnvPath -Encoding UTF8

Success "agent\.env written (ID: $($resp.agentId), control plane: $ControlPlaneUrl)."
Info "Start (or restart) the agent to pick this up: cd agent; npm start"
