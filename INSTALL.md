# PTaaS — Installation Guide

## What gets installed automatically

| Dependency | Version | Purpose |
|---|---|---|
| Node.js | 20 LTS | Runtime for backend, frontend, agent |
| PostgreSQL | 16 | Primary database (Prisma ORM) |
| InfluxDB | v2 | Time-series metrics from K6 |
| Grafana | Latest | Metrics dashboard (port 3000, anonymous viewer + embedding enabled) |
| K6 | Latest | Load test runner binary |
| Coralogix | — (SaaS, optional) | Log/trace shipping + the Observability page — you supply an API key, nothing to install locally |

---

## Windows — Single Command

**Easiest: double-click `setup.bat`** in the project root. It self-elevates to
Administrator (one UAC prompt) and runs the full installer — no PowerShell
knowledge needed.

Or from a terminal:

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1
```

Or, once Node is already installed:

```bash
npm run setup
```

> The script uses **Chocolatey** to install all dependencies, and is
> **idempotent** — re-run it any time; every step skips work that's already
> done and only fixes what's broken.

---

## macOS / Linux — Single Command

```bash
bash setup.sh
```

> Uses **Homebrew** on macOS and **apt** on Ubuntu/Debian.

---

## Troubleshooting an existing install (Windows)

Something stopped working after a reboot, a Windows update, or a port
conflict? Run diagnostics without touching any configuration:

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1 -Diagnose
```

or double-click **`diagnose.bat`**, or `npm run setup:diagnose`.

This checks PostgreSQL, InfluxDB (including whether the token in
`backend/.env` still matches what InfluxDB actually has — the most common
recurring failure), Grafana, the k6 binary, npm dependencies, the database
schema, and whether the backend is reachable. It **auto-fixes** what it
safely can:

- Restarts stopped PostgreSQL/Grafana services
- Restarts `influxd` if it's not running
- Re-installs missing `npm` dependencies

For anything it can't fix automatically (e.g. an invalid InfluxDB token, a
port held by an unrelated process, k6 missing from PATH), it prints the exact
command or UI steps to resolve it. A full timestamped log of every run is
written to `setup.log` in the project root — attach it if you need help.

Re-running the full installer (`setup.ps1` without `-Diagnose`) is also safe
at any time and will repair a partially-broken install (it skips steps that
are already correct).

---

## What the script does

1. Installs system dependencies (Node, PostgreSQL, InfluxDB, Grafana, K6) via Chocolatey — each step retries on transient failure and reports a concrete fix if it can't recover
2. Auto-provisions InfluxDB (org/bucket/token) via its setup API — no manual wizard
3. Configures Grafana: anonymous viewer access + iframe embedding (`custom.ini`) and an InfluxDB datasource pointed at the auto-provisioned org/bucket/token (`provisioning/datasources/`) — zero manual Grafana UI setup
4. Runs `npm install` across all workspaces (frontend, backend, agent)
5. Prompts for configuration: DB credentials, Anthropic API key, and optional Coralogix keys (ingestion + query)
6. Creates `backend/.env` and `agent/.env`
7. Creates the PostgreSQL database and runs Prisma migrations
8. Seeds the database
9. Registers an admin user
10. Registers the local agent and writes `agent/.env`
11. Syncs the PTaaS dashboard into Grafana automatically
12. Runs full diagnostics and prints a pass/fail summary before finishing

---

## Coralogix (optional)

Enables log shipping for API calls/k6 execution events, and the
**Observability** nav page (Logs + Traces).

- **Ingestion key** (required for log shipping): Coralogix > Data Flow > API Keys > "Send Your Data"
- **Query key** (optional, for the Observability page): a separate API key scoped for "Query Logs/DataPrime" — Coralogix often issues this as a distinct key from the ingestion one
- **Domain** (optional, for querying): your team's domain, e.g. `eu2.coralogix.com`, `coralogix.com`, `cx498.coralogix.com`

The installer prompts for all three (press Enter to skip any/all — the rest
of the app works fine without Coralogix). To add it later, edit
`backend/.env` directly:

```
CORALOGIX_API_KEY="your-private-key"
CORALOGIX_APP_NAME="PTaaS"
CORALOGIX_QUERY_API_KEY="your-query-scoped-api-key"
CORALOGIX_DOMAIN="eu2.coralogix.com"
```

---

## After installation

### Start the app

```bash
# Terminal 1 — frontend + backend
npm run dev

# Terminal 2 — load-test agent
npm run agent:start
```

### URLs

| Service | URL | Credentials |
|---|---|---|
| Frontend | http://localhost:5173 | Your admin credentials |
| Backend API | http://localhost:3001 | — |
| InfluxDB | http://localhost:8086 | Auto-provisioned during setup |
| Grafana | http://localhost:3000 | Anonymous viewer access (no login needed for embedded dashboards) |

---

## Transferring to another machine

Copy the entire project folder, then run `setup.bat` (or `setup.ps1`) on the
new machine — it detects what's already installed/configured and only fills
in what's missing.

**Exclude when copying** (optional, re-created by setup):
```
node_modules/
frontend/node_modules/
backend/node_modules/
agent/node_modules/
frontend/dist/
backend/dist/
```

**Must copy** (contain your configuration):
```
backend/.env
agent/.env
```
