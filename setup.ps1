# PTaaS - One-Shot Setup & Self-Healing Installer (Windows)
#
# Single-command usage:
#   powershell -ExecutionPolicy Bypass -File setup.ps1
#
# Re-run any time to repair a broken install - every step is idempotent and
# skips work that's already done. To ONLY diagnose/fix an existing install
# without changing config:
#   powershell -ExecutionPolicy Bypass -File setup.ps1 -Diagnose
#
# Requires: Windows 10/11, PowerShell 5.1+
# Installs: Chocolatey, Node.js 20, PostgreSQL 16, InfluxDB v2, Grafana, K6
# Configures: backend/.env, agent/.env, Grafana datasource + anonymous
#             embedding, Grafana dashboard sync, admin user, local agent,
#             optional Coralogix log/trace shipping.

param(
    [switch]$Diagnose,
    [switch]$SkipPrompts
)

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir
$LogFile = Join-Path $ScriptDir "setup.log"
"=== PTaaS setup run: $(Get-Date) ===" | Out-File -FilePath $LogFile -Append -Encoding UTF8

$script:Failures = @()
$script:Warnings = @()

# Grafana is deliberately kept off its 3000 default (that port is commonly
# claimed by other local dev servers) and pinned to 9999 instead, matching
# setup.sh's Mac/Linux behavior. Every Grafana URL/port in this script must
# go through these two so they can never drift out of sync with each other
# or with the GRAFANA_URL written into backend\.env.
$script:GrafanaPort = 9999
$script:GrafanaUrl  = "http://localhost:$script:GrafanaPort"

function Write-Log($msg) { $msg | Out-File -FilePath $LogFile -Append -Encoding UTF8 }
function Info    { param([string]$msg) Write-Host "[PTaaS] $msg" -ForegroundColor Cyan;    Write-Log "INFO  $msg" }
function Success { param([string]$msg) Write-Host "[PTaaS] $msg" -ForegroundColor Green;   Write-Log "OK    $msg" }
function Warn    { param([string]$msg) Write-Host "[PTaaS] WARNING: $msg" -ForegroundColor Yellow; Write-Log "WARN  $msg"; $script:Warnings += $msg }
function Fail    { param([string]$msg) Write-Host "[PTaaS] FAILED: $msg" -ForegroundColor Red; Write-Log "FAIL  $msg"; $script:Failures += $msg }
function Die     { param([string]$msg) Write-Host "[PTaaS] ERROR: $msg" -ForegroundColor Red; Write-Log "DIE   $msg"; exit 1 }

# Runs $Action up to $Retries times, logging clear remediation guidance on
# failure instead of aborting the whole install - most steps are independent,
# so one broken dependency shouldn't block the rest from being set up.
function Step {
    param(
        [string]$Name,
        [scriptblock]$Action,
        [int]$Retries = 1,
        [string]$Remedy = ""
    )
    for ($attempt = 1; $attempt -le $Retries; $attempt++) {
        try {
            & $Action
            return $true
        } catch {
            if ($attempt -lt $Retries) {
                Warn "$Name failed (attempt $attempt/$Retries): $($_.Exception.Message) - retrying..."
                Start-Sleep -Seconds 2
            } else {
                Fail "$Name failed: $($_.Exception.Message)"
                if ($Remedy) { Write-Host "         -> $Remedy" -ForegroundColor DarkYellow }
                return $false
            }
        }
    }
}

function Refresh-Path {
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
}

function Wait-ForHttp {
    param([string]$Url, [int]$TimeoutSec = 30)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try { Invoke-RestMethod -Uri $Url -TimeoutSec 3 -ErrorAction Stop | Out-Null; return $true }
        catch { Start-Sleep -Seconds 1 }
    }
    return $false
}

function Test-TcpPort {
    param([string]$ComputerName = "localhost", [int]$Port)
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $task = $client.ConnectAsync($ComputerName, $Port)
        $ok = $task.Wait(1500) -and $client.Connected
        $client.Close()
        return $ok
    } catch { return $false }
}

# Identifies what's holding a port (so a real conflict gets a concrete fix
# suggestion instead of a generic "address in use" failure).
function Get-PortOwner {
    param([int]$Port)
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn) {
            $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($proc) { return "$($proc.ProcessName) (PID $($proc.Id))" }
        }
    } catch {}
    return $null
}

function Find-GrafanaConfDir {
    $candidates = @(
        "C:\Program Files\GrafanaLabs\grafana\conf",
        "C:\ProgramData\chocolatey\lib\grafana\tools\grafana-*\conf"
    )
    foreach ($c in $candidates) {
        $hit = Get-Item $c -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

function Find-InfluxdPath {
    $cmd = Get-Command influxd -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    # The chocolatey influxdb2 package's nupkg places influxd.exe in
    # chocolatey\lib\influxdb2\tools on some versions, but the actual
    # installer it runs unzips the release archive to C:\influxdata\<version>\
    # instead - check both locations rather than assuming either one.
    $found = Get-ChildItem "C:\ProgramData\chocolatey\lib\influxdb2\tools" -Filter "influxd.exe" -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
    if ($found) { return $found }

    return Get-ChildItem "C:\influxdata" -Filter "influxd.exe" -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}

function Find-GrafanaHomePath {
    $confDir = Find-GrafanaConfDir
    if ($confDir) { return (Split-Path $confDir -Parent) }
    return $null
}

function Test-GrafanaService {
    return [bool](Get-Service -Name "Grafana" -ErrorAction SilentlyContinue)
}

# The community chocolatey "grafana" package (as of v13.0.2) only unzips the
# release archive - bin\grafana.exe, conf\, public\ - it does NOT register a
# Windows Service. Get-Service/Start-Service/Restart-Service against "Grafana"
# are therefore silent no-ops on a fresh install, and Grafana never actually
# starts. Fall back to launching grafana.exe directly as a background process
# whenever no "Grafana" service exists (kept as the preferred path in case a
# future package version, or a manually-installed NSSM service, does provide
# one).
function Start-GrafanaProcess {
    if (Test-TcpPort -Port $script:GrafanaPort) { return $true }
    if (Test-GrafanaService) {
        Restart-Service Grafana -ErrorAction SilentlyContinue
        return (Wait-ForHttp -Url "$script:GrafanaUrl/api/health" -TimeoutSec 30)
    }
    $homePath = Find-GrafanaHomePath
    if (-not $homePath) { return $false }
    $exePath = Join-Path $homePath "bin\grafana.exe"
    if (-not (Test-Path $exePath)) { return $false }
    # Any existing grafana.exe process is, by definition, not the one we want
    # if it's not already answering on $script:GrafanaPort above - most often
    # a stale process still bound to Grafana's built-in 3000 default from
    # before custom.ini set http_port. Kill it so the relaunch below picks up
    # the current config instead of silently doing nothing.
    Get-Process grafana -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Process -FilePath $exePath -ArgumentList @("server", "--homepath", $homePath) -WorkingDirectory $homePath -WindowStyle Hidden
    # First-ever start runs ~700 one-time DB migrations (~20-30s); subsequent
    # starts are much faster, but give it the same generous budget either way.
    return (Wait-ForHttp -Url "$script:GrafanaUrl/api/health" -TimeoutSec 45)
}

# Re-applies config file changes (custom.ini, provisioning/) - works whether
# Grafana is running as a service or as a directly-launched process.
function Restart-Grafana {
    if (Test-GrafanaService) {
        Restart-Service Grafana -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        return
    }
    Get-Process grafana -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Start-GrafanaProcess | Out-Null
}

# Adds or replaces a KEY="value" line in a .env-style file. Used to patch
# generated credentials (Grafana API key, dashboard UID) into backend\.env
# whether the file is being created fresh or already existed from a prior
# install.
function Set-EnvVar {
    param([string]$Path, [string]$Key, [string]$Value)
    $line = "$Key=`"$Value`""
    if (-not (Test-Path $Path)) {
        $line | Set-Content $Path -Encoding UTF8
        return
    }
    $content = Get-Content $Path
    if ($content | Where-Object { $_ -match "^$Key=" }) {
        ($content | ForEach-Object { if ($_ -match "^$Key=") { $line } else { $_ } }) | Set-Content $Path -Encoding UTF8
    } else {
        $content + $line | Set-Content $Path -Encoding UTF8
    }
}

function Get-EnvVar {
    param([string]$Path, [string]$Key)
    if (-not (Test-Path $Path)) { return $null }
    $val = (Get-Content $Path | Where-Object { $_ -match "^$Key=" }) -replace '.*="(.*)"', '$1'
    if (-not $val) { return $null }
    return $val
}

# The dashboard resource's name (= its UID) comes from Grafana_Dashboard.json
# itself, so GRAFANA_DASHBOARD_UID always matches whatever's actually in the
# committed file rather than drifting out of sync with it.
function Get-DashboardUidFromFile {
    $path = Join-Path $ScriptDir "Grafana_Dashboard.json"
    if (-not (Test-Path $path)) { return $null }
    try {
        $json = Get-Content $path -Raw | ConvertFrom-Json
        return $json.metadata.name
    } catch {
        return $null
    }
}

function Test-GrafanaApiKey {
    param([string]$GrafanaUrl, [string]$ApiKey)
    if (-not $ApiKey -or $ApiKey -eq "CHANGE_ME") { return $false }
    try {
        # /api/org (and several other GET endpoints) silently fall back to
        # the anonymous Viewer session when the Bearer token is garbage
        # instead of rejecting it - any endpoint anonymous can already read
        # is useless for validation. /api/serviceaccounts/search requires
        # Admin and correctly 403s for anonymous/invalid tokens.
        Invoke-RestMethod -Uri "$GrafanaUrl/api/serviceaccounts/search" -Headers @{ Authorization = "Bearer $ApiKey" } -TimeoutSec 5 -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

# Dashboards can only be pushed/updated via the API with a write-capable
# credential - Grafana's anonymous access is intentionally Viewer-only.
# Creates (or reuses) a "ptaas-sync" Admin-role service account and mints a
# token for it, authenticating as the Grafana admin user. Only works while
# the admin password is still the Grafana-generated default for a fresh
# instance (admin/admin) - if it's been changed, this fails gracefully and
# the caller falls back to telling the user to set GRAFANA_API_KEY by hand.
function New-GrafanaApiKey {
    param([string]$GrafanaUrl, [string]$AdminUser = "admin", [string]$AdminPass = "admin")
    try {
        $cred = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${AdminUser}:${AdminPass}"))
        $headers = @{ Authorization = "Basic $cred" }

        $existing = Invoke-RestMethod -Uri "$GrafanaUrl/api/serviceaccounts/search?query=ptaas-sync" -Headers $headers -TimeoutSec 5 -ErrorAction Stop
        $sa = $existing.serviceAccounts | Where-Object { $_.name -eq "ptaas-sync" } | Select-Object -First 1
        if (-not $sa) {
            $sa = Invoke-RestMethod -Uri "$GrafanaUrl/api/serviceaccounts" -Method POST -Headers $headers -Body '{"name":"ptaas-sync","role":"Admin"}' -ContentType "application/json" -TimeoutSec 5 -ErrorAction Stop
        }

        $tokenName = "ptaas-sync-token-$(Get-Date -Format yyyyMMddHHmmss)"
        $tokenResp = Invoke-RestMethod -Uri "$GrafanaUrl/api/serviceaccounts/$($sa.id)/tokens" -Method POST -Headers $headers `
            -Body (@{ name = $tokenName } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 5 -ErrorAction Stop
        return $tokenResp.key
    } catch {
        return $null
    }
}

# Self-healing entry point: returns a working GRAFANA_API_KEY, reusing the
# one already in backend\.env if it still authenticates, otherwise minting a
# fresh one and patching it into the file. Mirrors the InfluxDB-token-drift
# and agent-credential self-heal patterns used elsewhere in this script.
function Ensure-GrafanaApiKey {
    param([string]$GrafanaUrl, [string]$EnvPath)
    $existing = Get-EnvVar -Path $EnvPath -Key "GRAFANA_API_KEY"
    if (Test-GrafanaApiKey -GrafanaUrl $GrafanaUrl -ApiKey $existing) { return $existing }

    $newKey = New-GrafanaApiKey -GrafanaUrl $GrafanaUrl
    if ($newKey) {
        Set-EnvVar -Path $EnvPath -Key "GRAFANA_API_KEY" -Value $newKey
        return $newKey
    }
    return $null
}

# influxd (both the chocolatey package and the plain-zip install under
# C:\influxdata) stores its bolt/sqlite metadata under the current user's
# profile by default - same location Find-InfluxdPath's caller starts the
# daemon from.
function Find-InfluxDataPath {
    $path = Join-Path $env:USERPROFILE ".influxdbv2"
    if (Test-Path $path) { return $path }
    return $null
}

# Verifies a token actually authenticates against the *currently running*
# InfluxDB instance - a token in backend\.env can drift out of sync with the
# instance for the same reason GRAFANA_URL can: it was copied from another
# machine, or the local instance's storage was reset/reinstalled without the
# .env file being touched.
function Test-InfluxToken {
    param([string]$Token, [string]$Org)
    if (-not $Token -or $Token -eq "CHANGE_ME" -or -not $Org) { return $false }
    try {
        Invoke-RestMethod -Uri "http://localhost:8086/api/v2/buckets?org=$Org&limit=1" `
            -Headers @{ Authorization = "Token $Token" } -TimeoutSec 5 -ErrorAction Stop | Out-Null
        return $true
    } catch { return $false }
}

# Self-heals a broken InfluxDB auth token with zero manual steps. The old
# behavior here was to warn and leave connectivity broken until someone
# logged into the InfluxDB UI by hand - but on an already-provisioned
# instance /api/v2/setup refuses to run again, and there's no way to mint a
# new token without a credential nothing on the box still has. Instead: stop
# influxd, move its local data store aside (nothing is deleted - a
# timestamped backup is kept alongside it), restart fresh, and re-run
# onboarding. Safe for the local single-user dev/test instance this script
# manages; historical metrics in the old store are preserved in the backup
# folder, not lost, and Postgres data (executions, reports, etc.) is
# untouched since it lives in a separate database entirely.
function Reset-InfluxDB {
    param([string]$Org, [string]$Bucket)
    Info "Resetting local InfluxDB store to recover from a missing/invalid token..."
    Get-Process influxd -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2

    $dataPath = Find-InfluxDataPath
    if ($dataPath) {
        $backupName = "$(Split-Path $dataPath -Leaf).bak-$(Get-Date -Format yyyyMMddHHmmss)"
        Rename-Item -Path $dataPath -NewName $backupName -ErrorAction SilentlyContinue
        Info "Backed up previous InfluxDB store to $(Join-Path (Split-Path $dataPath -Parent) $backupName)"
    }

    $influxdPath = Find-InfluxdPath
    if (-not $influxdPath) { throw "influxd.exe not found - cannot reset InfluxDB" }
    Start-Process $influxdPath -WindowStyle Hidden
    if (-not (Wait-ForHttp -Url "http://localhost:8086/health" -TimeoutSec 20)) { throw "InfluxDB did not come back up after reset" }

    $setupBody = @{
        username = "admin"
        password = -join ((1..20) | ForEach-Object { [char](Get-Random -Minimum 33 -Maximum 126) })
        org      = $Org
        bucket   = $Bucket
    } | ConvertTo-Json
    $setupResp = Invoke-RestMethod -Uri "http://localhost:8086/api/v2/setup" -Method POST -Body $setupBody -ContentType "application/json"
    if (-not $setupResp.auth.token) { throw "InfluxDB reset but /api/v2/setup returned no token" }
    Success "InfluxDB re-provisioned (org: $Org, bucket: $Bucket) - new token captured automatically."
    return $setupResp.auth.token
}

# Writes/refreshes the Grafana provisioning file that lets the dashboard's
# own panels query InfluxDB directly (separate from the backend's queries,
# which go through INFLUXDB_TOKEN in backend\.env). Called both on first
# install and whenever InfluxDB's token has just been (re)issued, so the two
# never drift apart the way they had on this box before.
function Set-GrafanaInfluxDatasource {
    param([string]$Org, [string]$Bucket, [string]$Token)
    if (-not $Token -or $Token -eq "CHANGE_ME") { return }
    $confDir = Find-GrafanaConfDir
    if (-not $confDir) { return }
    $dsDir = Join-Path $confDir "provisioning\datasources"
    New-Item -ItemType Directory -Path $dsDir -Force | Out-Null
    $dsFile = Join-Path $dsDir "influxdb-ptaas.yaml"
    @"
apiVersion: 1
datasources:
  - name: InfluxDB PTaaS
    type: influxdb
    access: proxy
    url: http://localhost:8086
    jsonData:
      version: Flux
      organization: $Org
      defaultBucket: $Bucket
      httpMode: POST
    secureJsonData:
      token: $Token
    isDefault: true
    editable: true
"@ | Set-Content $dsFile -Encoding UTF8
    Restart-Grafana
}

function Find-PgBin {
    $dir = Get-Item "C:\Program Files\PostgreSQL\*\bin" -ErrorAction SilentlyContinue | Sort-Object -Descending | Select-Object -First 1
    if ($dir) { return $dir.FullName }
    return $null
}

# Verifies the AGENT_ID/AGENT_API_KEY in agent\.env actually exist in the
# Agent table in Postgres. agent\.env is only ever written when the agent is
# registered via POST /api/agents/register - the credential lives in the DB,
# not in any seed file. If the DB is later reset/reseeded, or agent\.env is
# copied from another machine, the cached credential goes stale and the
# agent's WebSocket gets closed with 1008 Unauthorized on every connection
# attempt, causing an infinite reconnect loop. Returns $true only if the
# stored agentId+apiKey pair is confirmed present in the database right now -
# never trust a cached credential without checking it live (same principle
# as the InfluxDB token drift check above).
function Test-AgentRegistered {
    if (-not (Test-Path "agent\.env")) { return $false }
    if (-not (Test-Path "backend\.env")) { return $false }
    # "pg" is a dependency of backend\package.json but npm workspaces hoist it
    # to the repo root node_modules, not backend\node_modules - check both,
    # since node's own require() resolution walks up parent dirs regardless.
    if (-not (Test-Path "backend\node_modules\pg") -and -not (Test-Path "node_modules\pg")) { return $false }

    $agentEnvLines = Get-Content "agent\.env"
    $agentId  = ($agentEnvLines | Where-Object { $_ -match '^AGENT_ID=' })      -replace '.*="(.*)"', '$1'
    $agentKey = ($agentEnvLines | Where-Object { $_ -match '^AGENT_API_KEY=' }) -replace '.*="(.*)"', '$1'
    if (-not $agentId -or $agentId -eq "CHANGE_ME" -or -not $agentKey) { return $false }

    $dbUrl = (Get-Content "backend\.env" | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '.*="(.*)"', '$1'
    if (-not $dbUrl) { return $false }

    $checkScript = @'
const { Client } = require("pg");
const c = new Client({ connectionString: process.argv[2] });
c.connect().then(async () => {
  try {
    const r = await c.query('SELECT "apiKey" FROM "Agent" WHERE id = $1', [process.argv[3]]);
    console.log(r.rows.length && r.rows[0].apiKey === process.argv[4] ? "VALID" : "INVALID");
  } catch (e) {
    console.log("INVALID");
  } finally {
    await c.end();
  }
}).catch(() => console.log("INVALID"));
'@
    # Written inside backend\ (not $env:TEMP) - node resolves node_modules
    # relative to the script's own path, so the "pg" require only succeeds
    # if the script lives alongside backend\node_modules.
    $tmpScript = "backend\.ptaas_agent_check.tmp.js"
    $checkScript | Set-Content $tmpScript -Encoding UTF8
    try {
        $checkResult = (& node $tmpScript $dbUrl $agentId $agentKey 2>$null) -join ""
        return $checkResult -eq "VALID"
    } catch {
        return $false
    } finally {
        Remove-Item $tmpScript -ErrorAction SilentlyContinue
    }
}

# Registers a fresh agent against the running backend and (re)writes
# agent\.env. Used both on first install and whenever Test-AgentRegistered
# reports the cached credential is stale.
function Register-Agent {
    Step -Name "Agent registration" -Remedy 'Register manually: POST http://localhost:3001/api/agents/register with body {"name":"local-agent"}' -Action {
        $agentResp = Invoke-RestMethod -Uri "http://localhost:3001/api/agents/register" -Method POST -Body '{"name":"local-agent"}' -ContentType "application/json"
        if (-not $agentResp.agentId -or -not $agentResp.apiKey) { throw "Empty agent registration response" }
        @"
CONTROL_PLANE_URL="http://localhost:3001"
AGENT_ID="$($agentResp.agentId)"
AGENT_API_KEY="$($agentResp.apiKey)"
"@ | Set-Content "agent\.env" -Encoding UTF8
        Success "agent\.env written (ID: $($agentResp.agentId))."
    }
    if (-not (Test-Path "agent\.env")) {
        @"
CONTROL_PLANE_URL="http://localhost:3001"
AGENT_ID="CHANGE_ME"
AGENT_API_KEY="CHANGE_ME"
"@ | Set-Content "agent\.env" -Encoding UTF8
    }
}

# -----------------------------------------------------------------------------
#  DIAGNOSTICS - health-checks every dependency and self-heals what it can.
#  Runs both as `-Diagnose` (standalone) and automatically at the end of a
#  fresh install, so failures are caught and explained either way.
# -----------------------------------------------------------------------------
function Invoke-Diagnostics {
    Write-Host ""
    Write-Host "======================================================" -ForegroundColor Cyan
    Write-Host "  PTaaS Diagnostics"                                     -ForegroundColor Cyan
    Write-Host "======================================================" -ForegroundColor Cyan
    Write-Host ""

    $results = @()

    # PostgreSQL
    $pgOk = Test-TcpPort -Port 5432
    if (-not $pgOk) {
        Warn "PostgreSQL not reachable on port 5432 - attempting to start the service..."
        Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Start-Service -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
        $pgOk = Test-TcpPort -Port 5432
    }
    $results += [PSCustomObject]@{ Component = "PostgreSQL"; Status = $(if ($pgOk) {"OK"} else {"FAIL"}) }

    # InfluxDB
    $influxOk = Wait-ForHttp -Url "http://localhost:8086/health" -TimeoutSec 5
    if (-not $influxOk) {
        Warn "InfluxDB not responding on :8086 - attempting to start influxd..."
        $influxdPath = Find-InfluxdPath
        if ($influxdPath -and -not (Get-Process influxd -ErrorAction SilentlyContinue)) {
            Start-Process $influxdPath -WindowStyle Hidden
            $influxOk = Wait-ForHttp -Url "http://localhost:8086/health" -TimeoutSec 15
        }
    }
    $results += [PSCustomObject]@{ Component = "InfluxDB"; Status = $(if ($influxOk) {"OK"} else {"FAIL"}) }

    # InfluxDB token validity (the most common recurring failure: token in
    # backend/.env drifts from what the running influxd instance actually
    # has). Unlike a first-time install, an already-provisioned instance
    # can't be re-onboarded via /api/v2/setup, and there's no saved
    # credential on the box to mint a fresh token through by hand - so
    # instead of just warning, self-heal via Reset-InfluxDB the same way the
    # main provisioning step does.
    if ($influxOk -and (Test-Path "backend\.env")) {
        $token  = Get-EnvVar -Path "backend\.env" -Key "INFLUXDB_TOKEN"
        $org    = Get-EnvVar -Path "backend\.env" -Key "INFLUXDB_ORG"
        $bucket = Get-EnvVar -Path "backend\.env" -Key "INFLUXDB_BUCKET"
        if (Test-InfluxToken -Token $token -Org $org) {
            $results += [PSCustomObject]@{ Component = "InfluxDB token"; Status = "OK" }
        } elseif (-not $token -or $token -eq "CHANGE_ME") {
            $results += [PSCustomObject]@{ Component = "InfluxDB token"; Status = "NOT SET" }
        } else {
            Warn "INFLUXDB_TOKEN in backend\.env is rejected by the running InfluxDB (HTTP 401) - self-healing..."
            try {
                $newToken = Reset-InfluxDB -Org $org -Bucket $bucket
                Set-EnvVar -Path "backend\.env" -Key "INFLUXDB_TOKEN" -Value $newToken
                Set-GrafanaInfluxDatasource -Org $org -Bucket $bucket -Token $newToken
                $results += [PSCustomObject]@{ Component = "InfluxDB token"; Status = "FIXED" }
                Warn "Reset InfluxDB and wrote a fresh token to backend\.env - restart the backend to pick it up."
            } catch {
                $results += [PSCustomObject]@{ Component = "InfluxDB token"; Status = "FAIL" }
                Write-Host "         -> Fix: $($_.Exception.Message)" -ForegroundColor DarkYellow
            }
        }
    }

    # Grafana
    $grafanaOk = Wait-ForHttp -Url "$script:GrafanaUrl/api/health" -TimeoutSec 5
    if (-not $grafanaOk) {
        Warn "Grafana not responding on :$script:GrafanaPort - attempting to start it..."
        $grafanaOk = Start-GrafanaProcess
        if (-not $grafanaOk) {
            Write-Host "         -> Fix: could not find/launch grafana.exe. Verify it's installed (choco install grafana -y)," -ForegroundColor DarkYellow
            Write-Host "           or check for a port $script:GrafanaPort conflict: $(Get-PortOwner -Port $script:GrafanaPort)" -ForegroundColor DarkYellow
        }
    }
    $results += [PSCustomObject]@{ Component = "Grafana"; Status = $(if ($grafanaOk) {"OK"} else {"FAIL"}) }

    # GRAFANA_URL in backend\.env - the other half of the same drift that
    # breaks the InfluxDB token above: a copied/older .env can point at a
    # different port than the Grafana instance this script actually manages
    # (pinned to $script:GrafanaPort), silently breaking every Grafana route
    # (dashboard embed, sync) even while Grafana itself reports healthy.
    $grafanaUrlStatus = "N/A"
    if (Test-Path "backend\.env") {
        if ((Get-EnvVar -Path "backend\.env" -Key "GRAFANA_URL") -eq $script:GrafanaUrl) {
            $grafanaUrlStatus = "OK"
        } else {
            Set-EnvVar -Path "backend\.env" -Key "GRAFANA_URL" -Value $script:GrafanaUrl
            $grafanaUrlStatus = "FIXED"
            Warn "GRAFANA_URL in backend\.env didn't match the running Grafana instance ($script:GrafanaUrl) - corrected it. Restart the backend to pick it up."
        }
    }
    $results += [PSCustomObject]@{ Component = "GRAFANA_URL"; Status = $grafanaUrlStatus }

    # k6 binary
    $k6Ok = [bool](Get-Command k6 -ErrorAction SilentlyContinue)
    $results += [PSCustomObject]@{ Component = "k6 binary"; Status = $(if ($k6Ok) {"OK"} else {"FAIL"}) }
    if (-not $k6Ok) {
        Warn "k6 not found on PATH - execution will fail with K6_NOT_FOUND."
        Write-Host "         -> Fix: choco install k6 -y, then open a new terminal." -ForegroundColor DarkYellow
    }

    # Node deps installed
    $depsOk = (Test-Path "node_modules") -and (Test-Path "backend\node_modules") -and (Test-Path "frontend\node_modules")
    $results += [PSCustomObject]@{ Component = "npm dependencies"; Status = $(if ($depsOk) {"OK"} else {"MISSING"}) }
    if (-not $depsOk) {
        Warn "Node dependencies missing - running npm install..."
        Step -Name "npm install" -Action { npm install } -Retries 2 `
            -Remedy "Run 'npm install' manually from the project root and check the error above."
    }

    # backend/.env present
    $envOk = Test-Path "backend\.env"
    $results += [PSCustomObject]@{ Component = "backend\.env"; Status = $(if ($envOk) {"OK"} else {"MISSING"}) }

    # Prisma migrations applied (best-effort: DB reachable + at least one migration dir)
    $migOk = (Test-Path "backend\prisma\migrations") -and $pgOk
    $results += [PSCustomObject]@{ Component = "Database schema"; Status = $(if ($migOk) {"OK"} else {"CHECK"}) }

    # Backend reachable (only if something's already running it)
    $backendUp = Test-TcpPort -Port 3001
    $results += [PSCustomObject]@{ Component = "Backend (if running)"; Status = $(if ($backendUp) {"UP"} else {"down"}) }

    # Grafana API key - required for the backend to push/update the PTaaS
    # dashboard (anonymous access is Viewer-only and can't write). Self-heals
    # by minting a fresh service-account token the same way the installer
    # does, as long as Grafana's admin password is still the default.
    $grafanaKeyStatus = "N/A"
    if ($grafanaOk -and (Test-Path "backend\.env")) {
        $currentKey = Get-EnvVar -Path "backend\.env" -Key "GRAFANA_API_KEY"
        if (Test-GrafanaApiKey -GrafanaUrl $script:GrafanaUrl -ApiKey $currentKey) {
            $grafanaKeyStatus = "OK"
        } else {
            $newKey = New-GrafanaApiKey -GrafanaUrl $script:GrafanaUrl
            if ($newKey) {
                Set-EnvVar -Path "backend\.env" -Key "GRAFANA_API_KEY" -Value $newKey
                $grafanaKeyStatus = "FIXED"
                Warn "GRAFANA_API_KEY was missing/invalid - minted a new one. Restart the backend to pick it up."
            } else {
                $grafanaKeyStatus = "FAIL"
                Write-Host "         -> Fix: Grafana admin password isn't the default - create a service account token manually (Administration > Service accounts) and set GRAFANA_API_KEY in backend\.env." -ForegroundColor DarkYellow
            }
        }
    }
    $results += [PSCustomObject]@{ Component = "Grafana API key"; Status = $grafanaKeyStatus }

    # Grafana dashboard - confirms the PTaaS dashboard from Grafana_Dashboard.json
    # actually exists and is anonymously readable (the embedded iframe on the
    # Dashboard page loads with no auth). Self-heals by calling the same
    # sync endpoint the installer and the Dashboard page's "Sync to Grafana"
    # button use, which also re-grants the Viewer permission every time.
    $dashboardStatus = "N/A"
    if ($grafanaOk) {
        $dashboardUid = Get-DashboardUidFromFile
        if ($dashboardUid) {
            try {
                Invoke-RestMethod -Uri "$script:GrafanaUrl/api/dashboards/uid/$dashboardUid" -TimeoutSec 5 -ErrorAction Stop | Out-Null
                $dashboardStatus = "OK"
            } catch {
                if ($backendUp) {
                    try {
                        Invoke-RestMethod -Uri "http://localhost:3001/api/grafana/sync-dashboard" -Method POST -TimeoutSec 15 -ErrorAction Stop | Out-Null
                        Invoke-RestMethod -Uri "$script:GrafanaUrl/api/dashboards/uid/$dashboardUid" -TimeoutSec 5 -ErrorAction Stop | Out-Null
                        $dashboardStatus = "FIXED"
                        Success "Re-synced PTaaS dashboard to Grafana."
                    } catch {
                        $dashboardStatus = "FAIL"
                        Write-Host "         -> Fix: check GRAFANA_API_KEY in backend\.env, then retry POST /api/grafana/sync-dashboard." -ForegroundColor DarkYellow
                    }
                } else {
                    $dashboardStatus = "FAIL"
                    Write-Host "         -> Fix: start the backend, then re-run 'setup.ps1 -Diagnose' to auto-sync the dashboard." -ForegroundColor DarkYellow
                }
            }
        }
    }
    $results += [PSCustomObject]@{ Component = "Grafana dashboard"; Status = $dashboardStatus }

    # Agent registration validity - the most likely cause of an agent stuck
    # in a connect/1008-Unauthorized/reconnect loop: agent\.env holds an
    # AGENT_ID/AGENT_API_KEY pair that no longer exists in Postgres (DB was
    # reset/reseeded, or agent\.env was copied from another machine).
    if (-not (Test-Path "agent\.env")) {
        $agentRegStatus = "NOT SET"
    } elseif (Test-AgentRegistered) {
        $agentRegStatus = "OK"
    } else {
        $agentRegStatus = "FAIL"
        Warn "agent\.env references an AGENT_ID that is missing/stale in the database - this causes the agent to loop on 'Connected' -> '1008 Unauthorized' -> reconnect."
        if ($backendUp) {
            Info "Re-registering agent against the running backend..."
            Register-Agent
            if (Test-AgentRegistered) {
                $agentRegStatus = "FIXED"
                Success "Agent re-registered. Restart 'npm run agent:start' (or the agent process) to pick up the new credentials."
            }
        } else {
            Write-Host "         -> Fix: start the backend ('npm run dev' or 'npm run dev:backend'), then re-run 'setup.ps1 -Diagnose' to auto re-register." -ForegroundColor DarkYellow
        }
    }
    $results += [PSCustomObject]@{ Component = "Agent registration"; Status = $agentRegStatus }

    # Coralogix (optional - only flagged informationally)
    $coralogixConfigured = $false
    if (Test-Path "backend\.env") {
        $coralogixConfigured = (Get-Content "backend\.env" | Select-String "^CORALOGIX_API_KEY=" -Quiet)
    }
    $results += [PSCustomObject]@{ Component = "Coralogix (optional)"; Status = $(if ($coralogixConfigured) {"configured"} else {"not configured"}) }

    Write-Host ""
    $results | Format-Table -AutoSize | Out-String | Write-Host
    Write-Log ($results | Out-String)

    $hardFailures = @($results | Where-Object { $_.Status -eq "FAIL" })
    if ($hardFailures.Count -gt 0) {
        Write-Host "[PTaaS] $($hardFailures.Count) component(s) need attention - see remediation notes above." -ForegroundColor Red
        Write-Host "[PTaaS] Full log: $LogFile" -ForegroundColor Yellow
    } else {
        Write-Host "[PTaaS] All checked components are healthy." -ForegroundColor Green
    }
    return $results
}

if ($Diagnose) {
    Invoke-Diagnostics | Out-Null
    exit 0
}

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  PTaaS - Performance Testing as a Service"            -ForegroundColor Cyan
Write-Host "  One-Shot Installer (Windows)"                        -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# -- 1. Admin rights ---------------------------------------
$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")
if (-not $IsAdmin) {
    Die "Please run this script as Administrator (right-click PowerShell -> Run as Administrator), or just double-click setup.bat which elevates automatically."
}

# -- 2. Chocolatey -----------------------------------------
Step -Name "Chocolatey" -Retries 2 -Remedy "Install manually from https://chocolatey.org/install, then re-run this script." -Action {
    if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
        Info "Installing Chocolatey..."
        Set-ExecutionPolicy Bypass -Scope Process -Force
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
        Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
        Refresh-Path
        if (-not (Get-Command choco -ErrorAction SilentlyContinue)) { throw "choco still not on PATH after install" }
    } else {
        Info "Chocolatey already installed."
    }
}

# -- 3. Node.js 20 -----------------------------------------
Step -Name "Node.js" -Retries 2 -Remedy "Install Node 20 LTS manually from https://nodejs.org and re-run." -Action {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Info "Installing Node.js 20 LTS..."
        choco install nodejs-lts --version=20.19.0 -y
        Refresh-Path
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "node still not on PATH after install" }
    } else {
        $nodeVer = (node --version) -replace 'v','' -replace '\..*',''
        if ([int]$nodeVer -lt 18) {
            Info "Upgrading Node.js to 20 LTS..."
            choco upgrade nodejs-lts -y
            Refresh-Path
        } else {
            Info "Node.js $(node --version) already installed."
        }
    }
}

# -- 4. PostgreSQL 16 --------------------------------------
Step -Name "PostgreSQL" -Retries 2 -Remedy "Install manually: choco install postgresql16 --params '/Password:postgres' -y" -Action {
    $pgPortBusy = Test-TcpPort -Port 5432
    $pgService  = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue
    if (-not $pgService) {
        if ($pgPortBusy) {
            $owner = Get-PortOwner -Port 5432
            throw "Port 5432 is already in use by $owner - PostgreSQL service not found. Stop that process or set a different DATABASE_URL port."
        }
        Info "Installing PostgreSQL 16..."
        choco install postgresql16 --params '/Password:postgres' -y
        Refresh-Path
        Start-Sleep -Seconds 5
    } else {
        Info "PostgreSQL already installed."
        if ($pgService.Status -ne 'Running') { Start-Service $pgService.Name }
    }
    if (-not (Wait-ForHttp -Url "http://localhost:5432" -TimeoutSec 1)) {
        # HTTP probe will always "fail" against a non-HTTP port; use TCP check instead.
    }
    if (-not (Test-TcpPort -Port 5432)) { throw "PostgreSQL installed but port 5432 isn't accepting connections yet" }
}

# -- 5. InfluxDB v2 ----------------------------------------
Step -Name "InfluxDB" -Retries 2 -Remedy "Install manually: choco install influxdb2 -y, then run influxd." -Action {
    if (-not (Get-Command influxd -ErrorAction SilentlyContinue)) {
        Info "Installing InfluxDB v2..."
        choco install influxdb2 -y
        Refresh-Path
    } else {
        Info "InfluxDB already installed."
    }
    if (-not (Get-Process influxd -ErrorAction SilentlyContinue)) {
        Info "Starting InfluxDB..."
        $influxdPath = Find-InfluxdPath
        if (-not $influxdPath) { throw "influxd.exe not found after install" }
        if (Test-TcpPort -Port 8086) {
            $owner = Get-PortOwner -Port 8086
            Warn "Port 8086 already has a listener ($owner) - assuming it's an existing InfluxDB instance."
        } else {
            Start-Process $influxdPath -WindowStyle Hidden
        }
    }
    if (-not (Wait-ForHttp -Url "http://localhost:8086/health" -TimeoutSec 20)) { throw "InfluxDB did not become healthy on :8086 within 20s" }
}

# -- 5a. Auto-provision InfluxDB (org/bucket/token) --------
# Root cause of the recurring "401 - check token and org" connectivity failure:
# influxd starts fresh/unauthenticated and any manually-copied token from the
# browser onboarding wizard drifts out of sync with backend\.env. Drive the
# same /api/v2/setup onboarding the wizard would, so the token we persist is
# always the one the running instance actually has.
$InfluxOrg    = "PTaaS"
$InfluxBucket = "k6"
$InfluxToken  = $null

Step -Name "InfluxDB provisioning" -Remedy "Open http://localhost:8086 and complete the setup wizard manually, then paste the token into backend\.env." -Action {
    $setupStatus = Invoke-RestMethod "http://localhost:8086/api/v2/setup" -ErrorAction Stop
    if ($setupStatus.allowed) {
        Info "Provisioning InfluxDB (org: $InfluxOrg, bucket: $InfluxBucket)..."
        $setupBody = @{
            username = "admin"
            password = -join ((1..20) | ForEach-Object { [char](Get-Random -Minimum 33 -Maximum 126) })
            org      = $InfluxOrg
            bucket   = $InfluxBucket
        } | ConvertTo-Json
        $setupResp  = Invoke-RestMethod -Uri "http://localhost:8086/api/v2/setup" `
            -Method POST -Body $setupBody -ContentType "application/json"
        if (-not $setupResp.auth.token) { throw "/api/v2/setup returned no token" }
        $script:InfluxToken = $setupResp.auth.token
        Success "InfluxDB provisioned - token captured automatically."
    } else {
        # Already provisioned on this host - reuse the existing org/bucket
        # names from backend\.env so a repair doesn't silently rename what
        # the rest of the app (and the Grafana datasource below) expects.
        $existingToken = $null; $existingOrg = $null; $existingBucket = $null
        if (Test-Path "backend\.env") {
            $existingToken  = Get-EnvVar -Path "backend\.env" -Key "INFLUXDB_TOKEN"
            $existingOrg    = Get-EnvVar -Path "backend\.env" -Key "INFLUXDB_ORG"
            $existingBucket = Get-EnvVar -Path "backend\.env" -Key "INFLUXDB_BUCKET"
        }
        if ($existingOrg)    { $script:InfluxOrg    = $existingOrg }
        if ($existingBucket) { $script:InfluxBucket = $existingBucket }

        # A token that's present but no longer accepted by the running
        # instance (drifted from another machine, or the local store was
        # reset outside this script) is the #1 recurring cause of the
        # InfluxDB "401" connectivity failure - self-heal it here instead of
        # carrying a dead token into backend\.env.
        if (Test-InfluxToken -Token $existingToken -Org $script:InfluxOrg) {
            Info "InfluxDB already provisioned on this host - existing backend\.env token is valid."
            $script:InfluxToken = $existingToken
        } else {
            if ($existingToken) {
                Warn "InfluxDB already provisioned on this host, but its backend\.env token is rejected (HTTP 401) - self-healing..."
            } else {
                Info "InfluxDB already provisioned on this host with no usable backend\.env token - self-healing..."
            }
            $script:InfluxToken = Reset-InfluxDB -Org $script:InfluxOrg -Bucket $script:InfluxBucket
        }
    }
}
$InfluxOrg    = $script:InfluxOrg
$InfluxBucket = $script:InfluxBucket
if ($script:InfluxToken) { $InfluxToken = $script:InfluxToken }

# -- 6. Grafana --------------------------------------------
# Install only here - do NOT start Grafana yet. Its default port is 3000,
# and starting it before custom.ini below sets $script:GrafanaPort would
# mean the first boot claims 3000, requiring a kill+restart to actually move
# it. Configuring the port before the very first start avoids that entirely.
Step -Name "Grafana" -Retries 2 -Remedy "Install manually: choco install grafana -y" -Action {
    if (-not (Find-GrafanaHomePath) -and -not (Test-GrafanaService)) {
        Info "Installing Grafana..."
        choco install grafana -y
        Refresh-Path
        if (-not (Find-GrafanaHomePath)) { throw "grafana.exe not found after install" }
    } else {
        Info "Grafana already installed."
    }
}

# Rather than editing the fragile defaults.ini with regex, drop a custom.ini
# override (Grafana merges this automatically) pinning the port to
# $script:GrafanaPort and enabling anonymous viewer access + iframe embedding
# - the latter is what the PTaaS Dashboard page needs to embed Grafana panels
# without a login.
$GrafanaConfDir = Find-GrafanaConfDir
if ($GrafanaConfDir) {
    Step -Name "Grafana embedding config" -Action {
        $customIni = Join-Path $GrafanaConfDir "custom.ini"
        @"
[server]
http_port = $script:GrafanaPort

[security]
allow_embedding = true

[auth.anonymous]
enabled = true
org_name = Main Org.
org_role = Viewer
"@ | Set-Content $customIni -Encoding ASCII
    }
}

Step -Name "Grafana start" -Retries 2 -Remedy "Install manually: choco install grafana -y, then run bin\grafana.exe server --homepath <install dir>" -Action {
    # The chocolatey "grafana" package does not register a Windows Service -
    # it only unzips bin\grafana.exe. Start-GrafanaProcess prefers a real
    # service if one exists (Test-GrafanaService), otherwise launches the
    # exe directly. Either way this call is what actually brings Grafana up.
    if (-not (Start-GrafanaProcess)) { throw "Grafana did not come up on :$script:GrafanaPort after install" }
}

# Auto-provision the InfluxDB datasource so Grafana panels work with zero
# manual UI setup - this is the config that's manually redone most often
# whenever InfluxDB's token rotates, and now also self-heals whenever
# Reset-InfluxDB issues a new one above.
if ($GrafanaConfDir -and $InfluxToken -and $InfluxToken -ne "CHANGE_ME") {
    Step -Name "Grafana InfluxDB datasource" -Action {
        Set-GrafanaInfluxDatasource -Org $InfluxOrg -Bucket $InfluxBucket -Token $InfluxToken
    }
}
if (-not (Wait-ForHttp -Url "$script:GrafanaUrl/api/health" -TimeoutSec 30)) {
    Fail "Grafana did not respond on :$script:GrafanaPort after configuration - check $LogFile. If no 'Grafana' Windows service exists, check for a stuck grafana.exe process or a port $script:GrafanaPort conflict: $(Get-PortOwner -Port $script:GrafanaPort)"
}

# -- 6a. Grafana API key + dashboard UID --------------------
# Captured here (before backend\.env is written below) so a fresh install's
# .env template can include them directly. Self-healing for existing
# installs happens in -Diagnose instead, since patching an existing
# backend\.env still requires a backend restart to take effect.
$GrafanaApiKey = New-GrafanaApiKey -GrafanaUrl $script:GrafanaUrl
if (-not $GrafanaApiKey) {
    Warn "Could not auto-create a Grafana API key (admin password may have been changed from the default) - dashboard sync will be skipped until GRAFANA_API_KEY is set manually in backend\.env."
}
$DashboardUid = Get-DashboardUidFromFile
if (-not $DashboardUid) {
    Warn "Grafana_Dashboard.json not found or unreadable - GRAFANA_DASHBOARD_UID will not be auto-configured."
}

# -- 7. K6 -------------------------------------------------
Step -Name "K6" -Retries 2 -Remedy "Install manually: choco install k6 -y" -Action {
    if (-not (Get-Command k6 -ErrorAction SilentlyContinue)) {
        Info "Installing K6..."
        choco install k6 -y
        Refresh-Path
        if (-not (Get-Command k6 -ErrorAction SilentlyContinue)) { throw "k6 still not on PATH after install" }
    } else {
        Info "K6 already installed."
    }
}

# -- 8. npm install ----------------------------------------
Step -Name "npm install" -Retries 2 -Remedy "Run 'npm install' manually and inspect the error (often a locked file - close any running dev servers first)." -Action {
    Info "Installing Node dependencies..."
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install exited with code $LASTEXITCODE" }
}

# -- 9. Environment files ----------------------------------
Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Configuration"                                        -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path "backend\.env")) {
    Info "Creating backend\.env..."

    if ($SkipPrompts) {
        $PgUser = "postgres"; $PgPass = "postgres"; $PgHost = "localhost"; $PgDb = "ptaas"; $AnthropicKey = ""
        $CoralogixKey = ""; $CoralogixApp = "PTaaS"; $CoralogixQueryKey = ""; $CoralogixDomain = ""
    } else {
        $PgUser = Read-Host "  PostgreSQL user (default: postgres)"
        if (-not $PgUser) { $PgUser = "postgres" }

        $PgPassSec = Read-Host "  PostgreSQL password (default: postgres)" -AsSecureString
        $PgPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($PgPassSec))
        if (-not $PgPass) { $PgPass = "postgres" }

        $PgHost = Read-Host "  PostgreSQL host (default: localhost)"
        if (-not $PgHost) { $PgHost = "localhost" }

        $PgDb = Read-Host "  PostgreSQL database name (default: ptaas)"
        if (-not $PgDb) { $PgDb = "ptaas" }

        $AnthropicKey = Read-Host "  Anthropic API key (sk-ant-..., optional, Enter to skip)"

        Write-Host ""
        Write-Host "  Coralogix (optional - log shipping + Observability page). Press Enter to skip." -ForegroundColor DarkGray
        $CoralogixKey = Read-Host "  Coralogix ingestion API key (Data Flow > API Keys > Send Your Data)"
        $CoralogixApp = "PTaaS"
        $CoralogixQueryKey = ""
        $CoralogixDomain = ""
        if ($CoralogixKey) {
            $CoralogixAppInput = Read-Host "  Coralogix application name (default: PTaaS)"
            if ($CoralogixAppInput) { $CoralogixApp = $CoralogixAppInput }
            $CoralogixQueryKey = Read-Host "  Coralogix query API key (for Observability page, optional)"
            $CoralogixDomain   = Read-Host "  Coralogix team domain (e.g. eu2.coralogix.com, optional)"
        }
    }

    $JwtSecret = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })

    if (-not $InfluxToken) {
        Warn "InfluxDB was not auto-provisioned - connectivity will show 401 until INFLUXDB_TOKEN is fixed."
        $InfluxToken = "CHANGE_ME"
    } else {
        Info "Using auto-provisioned InfluxDB token (org: $InfluxOrg, bucket: $InfluxBucket)."
    }

    $envContent = @"
DATABASE_URL="postgresql://${PgUser}:${PgPass}@${PgHost}:5432/${PgDb}"
JWT_SECRET="${JwtSecret}"
JWT_EXPIRES_IN="7d"
ANTHROPIC_API_KEY="${AnthropicKey}"
INFLUXDB_URL="http://localhost:8086"
INFLUXDB_TOKEN="${InfluxToken}"
INFLUXDB_ORG="${InfluxOrg}"
INFLUXDB_BUCKET="${InfluxBucket}"
GRAFANA_URL="${script:GrafanaUrl}"
GRAFANA_DASHBOARD_UID="${DashboardUid}"
GRAFANA_API_KEY="$(if ($GrafanaApiKey) { $GrafanaApiKey } else { 'CHANGE_ME' })"
"@

    if ($CoralogixKey) {
        $envContent += @"

CORALOGIX_API_KEY="${CoralogixKey}"
CORALOGIX_APP_NAME="${CoralogixApp}"
"@
        if ($CoralogixQueryKey) { $envContent += "`nCORALOGIX_QUERY_API_KEY=`"${CoralogixQueryKey}`"" }
        if ($CoralogixDomain)   { $envContent += "`nCORALOGIX_DOMAIN=`"${CoralogixDomain}`"" }
    }

    $envContent | Set-Content "backend\.env" -Encoding UTF8
    Success "backend\.env created."
} else {
    Warn "backend\.env already exists - skipping (re-run with that file removed to reconfigure)."

    # Even on an existing install, keep the Grafana dashboard wiring healed -
    # these are narrow, additive patches (not a full reconfigure) so it's
    # safe to apply them even when the rest of the file is left alone.
    # GRAFANA_URL in particular drifts whenever a backend\.env is copied from
    # a machine that used a different port (or an older run of this script
    # wrote 3000 before Grafana was pinned to $script:GrafanaPort) - Grafana
    # itself is now always brought up on $script:GrafanaPort above, so the
    # .env must match or every Grafana-dependent route silently breaks.
    if ((Get-EnvVar -Path "backend\.env" -Key "GRAFANA_URL") -ne $script:GrafanaUrl) {
        Set-EnvVar -Path "backend\.env" -Key "GRAFANA_URL" -Value $script:GrafanaUrl
        Info "Corrected GRAFANA_URL in backend\.env to $script:GrafanaUrl."
    }
    if ($DashboardUid -and -not (Get-EnvVar -Path "backend\.env" -Key "GRAFANA_DASHBOARD_UID")) {
        Set-EnvVar -Path "backend\.env" -Key "GRAFANA_DASHBOARD_UID" -Value $DashboardUid
        Info "Added missing GRAFANA_DASHBOARD_UID to backend\.env."
    }
    if ($GrafanaApiKey -and -not (Test-GrafanaApiKey -GrafanaUrl $script:GrafanaUrl -ApiKey (Get-EnvVar -Path "backend\.env" -Key "GRAFANA_API_KEY"))) {
        Set-EnvVar -Path "backend\.env" -Key "GRAFANA_API_KEY" -Value $GrafanaApiKey
        Info "Added/refreshed GRAFANA_API_KEY in backend\.env."
    }
}

# -- 10. Create PostgreSQL database ------------------------
$DbUrl  = (Get-Content "backend\.env" | Where-Object { $_ -match 'DATABASE_URL' }) -replace '.*="(.*)"', '$1'
$DbName = ($DbUrl -split '/')[-1] -replace '"', ''
$PgBin  = Find-PgBin

Step -Name "PostgreSQL database '$DbName'" -Remedy "Create manually: createdb -U postgres $DbName" -Action {
    if (-not $PgBin) { throw "Could not find PostgreSQL bin directory under C:\Program Files\PostgreSQL" }
    $env:PGPASSWORD = "postgres"
    & "$PgBin\createdb.exe" -U postgres $DbName 2>$null
    # createdb exits non-zero if the DB already exists - verify it's actually reachable either way.
    $exists = & "$PgBin\psql.exe" -U postgres -lqt 2>$null | Select-String -Pattern "\b$DbName\b" -Quiet
    if (-not $exists) { throw "Database '$DbName' was not found after createdb" }
    Success "Database '$DbName' ready."
}

# -- 11. Prisma migrate ------------------------------------
Step -Name "Prisma migrations" -Retries 2 -Remedy "From backend\, run: npx prisma migrate deploy" -Action {
    Info "Running Prisma migrations..."
    Set-Location "backend"
    try {
        npx prisma migrate deploy
        if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy exited with $LASTEXITCODE" }
    } finally {
        Set-Location $ScriptDir
    }
}

Step -Name "Prisma client generation" -Action {
    Set-Location "backend"
    try { npx prisma generate } finally { Set-Location $ScriptDir }
}

# -- 12. Seed database -------------------------------------
Set-Location "backend"
try { npm run db:seed } catch { Warn "Seed skipped (no seed data or already seeded)." }
Set-Location $ScriptDir

# -- 13. Start backend temporarily to register user/agent/dashboard --
Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Create Admin User"                                    -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

if ($SkipPrompts) {
    $AdminEmail = "admin@perfops.dev"; $AdminName = "Admin User"; $AdminPass = "password123"
} else {
    $AdminEmail = Read-Host "  Admin email (default: admin@perfops.dev)"
    if (-not $AdminEmail) { $AdminEmail = "admin@perfops.dev" }

    $AdminName = Read-Host "  Admin name (default: Admin User)"
    if (-not $AdminName) { $AdminName = "Admin User" }

    $AdminPassSec = Read-Host "  Admin password (default: password123)" -AsSecureString
    $AdminPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($AdminPassSec))
    if (-not $AdminPass) { $AdminPass = "password123" }
}

if (Test-TcpPort -Port 3001) {
    Warn "Port 3001 is already in use ($(Get-PortOwner -Port 3001)) - assuming the backend is already running."
    $BackendProc = $null
} else {
    Info "Starting backend temporarily to register admin user..."
    Set-Location "backend"
    $BackendProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev" -PassThru -WindowStyle Hidden
    Set-Location $ScriptDir
}

if (-not (Wait-ForHttp -Url "http://localhost:3001/api/config" -TimeoutSec 30)) {
    Fail "Backend did not come up on :3001 within 30s - registration/dashboard sync steps below will be skipped."
    Write-Host "         -> Run 'npm run dev' manually from the project root and check the terminal output for errors." -ForegroundColor DarkYellow
} else {
    $registerBody = @{ email = $AdminEmail; password = $AdminPass; name = $AdminName } | ConvertTo-Json
    Step -Name "Admin user registration" -Action {
        Invoke-RestMethod -Uri "http://localhost:3001/api/auth/register" -Method POST -Body $registerBody -ContentType "application/json" | Out-Null
        Success "Admin user registered."
    } -Remedy "User may already exist - try logging in with the credentials you entered."

    # -- 14. Register agent -------------------------------------
    # Self-healing, not just "create if missing": an agent\.env left over
    # from a previous install (or copied from another machine per the
    # "Transferring to another machine" instructions in INSTALL.md) can
    # reference an AGENT_ID that no longer exists in a freshly-created
    # database. Always verify the cached credential against Postgres before
    # trusting it - re-register whenever it's missing, stale, or invalid.
    # This is what previously caused the agent to connect and immediately
    # get closed with "1008 Unauthorized" in an infinite reconnect loop.
    if (Test-AgentRegistered) {
        Info "agent\.env verified against the database - skipping re-registration."
    } else {
        if (Test-Path "agent\.env") {
            Warn "agent\.env exists but its AGENT_ID is not a valid, registered agent in the database - re-registering."
        }
        Register-Agent
    }

    # -- 15. Sync Grafana dashboard -----------------------------
    Step -Name "Grafana dashboard sync" -Remedy "Open the app and click 'Sync to Grafana' on the Dashboard page once logged in." -Action {
        $syncResp = Invoke-RestMethod -Uri "http://localhost:3001/api/grafana/sync-dashboard" -Method POST -TimeoutSec 15
        Success "Grafana dashboard synced: $($syncResp.grafanaUrl)"
    }
}

if ($BackendProc) { Stop-Process -Id $BackendProc.Id -Force -ErrorAction SilentlyContinue }

# -- 16. Final diagnostics ---------------------------------
$diagResults = Invoke-Diagnostics

# -- 17. Done -----------------------------------------------
Write-Host ""
if ($script:Failures.Count -eq 0) {
    Write-Host "======================================================" -ForegroundColor Green
    Write-Host "  PTaaS setup complete!"                               -ForegroundColor Green
    Write-Host "======================================================" -ForegroundColor Green
} else {
    Write-Host "======================================================" -ForegroundColor Yellow
    Write-Host "  PTaaS setup finished with $($script:Failures.Count) issue(s) - see above" -ForegroundColor Yellow
    Write-Host "======================================================" -ForegroundColor Yellow
    Write-Host "  Re-run any time to retry:  powershell -ExecutionPolicy Bypass -File setup.ps1" -ForegroundColor Yellow
    Write-Host "  Or just diagnose:          powershell -ExecutionPolicy Bypass -File setup.ps1 -Diagnose" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  Start the full stack:"
Write-Host "    npm run dev              (frontend + backend)"
Write-Host "    npm run agent:start      (in a separate terminal)"
Write-Host ""
Write-Host "  URLs:"
Write-Host "    Frontend   -> http://localhost:5173"
Write-Host "    Backend    -> http://localhost:3001"
Write-Host "    InfluxDB   -> http://localhost:8086  (org: $InfluxOrg / bucket: $InfluxBucket)"
Write-Host "    Grafana    -> $script:GrafanaUrl  (anonymous viewer access enabled)"
Write-Host ""
Write-Host "  Full log: $LogFile"
Write-Host ""
