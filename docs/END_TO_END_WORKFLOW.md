# PerfOps Control Plane — End-to-End Workflow

This document describes the complete lifecycle of a performance test in the PerfOps Control Plane (PTaaS) platform — from platform setup, through test authoring and execution, to live monitoring and reporting.

---

## 1. What the Platform Does

PerfOps Control Plane is a **Performance Testing as a Service** platform. Users author load tests in a web UI (or generate them with AI), the control plane converts them into [k6](https://k6.io) scripts, dispatches them over WebSocket to a remote **execution agent**, streams live results back to the browser, and persists metrics to **InfluxDB** for visualization in **Grafana**.

### Components

| Component | Tech | Port | Role |
|---|---|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind | 5173 | Web UI: authoring, execution, dashboards, reports |
| Backend (control plane) | Node.js + Express + Prisma + PostgreSQL | 3001 | REST API, auth, job dispatch, WebSocket hub, metrics push |
| Agent | Standalone Node.js process | — | Connects to control plane via WS, spawns the k6 binary |
| k6 | Native binary (`~/bin/k6` or Homebrew path) | — | Runs the actual load test |
| InfluxDB v2 | Time-series database | 8086 | Stores per-request and aggregated test metrics |
| Grafana | Dashboards | 9999 | Visualizes InfluxDB data, embedded in the UI via proxy |

### Architecture

```
Browser (React, port 5173)
  │  HTTP /api/* + WS /ws/executor/:executionId   (via Vite proxy)
  ▼
Control Plane (Express + PostgreSQL, port 3001)
  │  WS /ws/agent/:agentId?apiKey=...   (persistent, agent-initiated)
  ▼
Execution Agent (Node.js, runs anywhere with network access)
  │  spawns
  ▼
k6 binary
  │  writeInfluxLines() — HTTP POST from inside the test script
  ▼
InfluxDB v2 (port 8086)
  │  data source
  ▼
Grafana (port 9999) ──► embedded in Dashboard via /api/grafana-proxy
```

Two data paths feed InfluxDB:
1. **In-band**: the generated k6 script writes raw measurements (`requestsRaw`, `virtualUsers`, `testStartEnd`, …) during the run via `writeInfluxLines()`.
2. **Post-run**: the backend pushes aggregated results (`k6_execution`, `k6_thresholds`) after the agent reports completion.

---

## 2. Phase 0 — One-Time Setup

### 2.1 Infrastructure prerequisites

- PostgreSQL running locally with a `ptaas` database (`createdb ptaas`)
- InfluxDB v2 on `:8086` with org/bucket/token configured
- Grafana on `:9999` with InfluxDB as a data source
- k6 binary installed (agent resolves `~/bin/k6`, `/usr/local/bin/k6`, or `/opt/homebrew/bin/k6`)

### 2.2 Backend configuration

`backend/.env` must define: `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `ANTHROPIC_API_KEY` (for AI script generation), `INFLUXDB_URL/TOKEN/ORG/BUCKET`, `GRAFANA_URL`, `GRAFANA_DASHBOARD_UID`. See `backend/.env.example`.

```bash
cd backend
npx prisma migrate dev --name init   # create schema
npm run db:seed                      # seed from backend/data/*.json
```

### 2.3 Create the first user

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@perfops.dev","password":"password123","name":"Admin User"}'
```

### 2.4 Register an execution agent

```bash
curl -X POST http://localhost:3001/api/agents/register \
  -H "Content-Type: application/json" \
  -d '{"name":"local-agent"}'
# → returns { agentId, apiKey }
```

Copy the returned credentials into `agent/.env`:

```bash
CONTROL_PLANE_URL="http://localhost:3001"
AGENT_ID="<agentId>"
AGENT_API_KEY="<apiKey>"
```

### 2.5 Start everything

```bash
# Terminal 1 — control plane + frontend
npm run dev          # runs backend (:3001) and frontend (:5173) concurrently

# Terminal 2 — execution agent
cd agent && npm start
```

On startup the agent opens a persistent WebSocket to `/ws/agent/:agentId?apiKey=...`, sends a `register` message (name, hostname, k6 version), and heartbeats every 15 seconds. The backend validates the `apiKey` against the `Agent` table on upgrade and marks the agent **online** in the in-memory `agentRegistry`. If the connection drops, the agent reconnects with 5-second backoff.

---

## 3. Phase 1 — Login & Authentication

1. User opens `http://localhost:5173` → `ProtectedRoute` finds no `auth_token` in localStorage → redirects to `/login`.
2. User submits email/password → `POST /api/auth/login` → backend verifies the bcrypt hash and returns `{ token, user }` (JWT, default 7-day expiry).
3. Token is stored in localStorage; every subsequent API call injects `Authorization: Bearer <token>`. A 401 response clears the token and redirects to `/login`.

Roles: `ADMIN`, `TESTER`, `VIEWER` (enforced by `requireRole` middleware on protected routes).

---

## 4. Phase 2 — Authoring a Test

Navigate to **Tests → New** (`/tests/new`, page: `TestAuthor.tsx`). Three authoring paths converge on the same artifact — a **TestSpec** record and a generated **k6 script**:

### Path A — Form builder (structured spec)
Fill out the request definition (method, URL, headers via `HeadersTable`, body), load profile (stages via `StagesTable` — ramp-up / steady / ramp-down), thresholds (e.g. `p95 < 500ms`, error rate), and checks. Saving calls `POST /api/test-specs` (or `PUT /api/test-specs/:id` on edit). At run time, `k6Generator.ts` converts the spec into a k6 script.

### Path B — CSV test-case upload
Upload a CSV of test cases (sample at `frontend/public/sample-test-cases.csv`) → `POST /api/upload/test-cases` parses and validates rows (warnings surfaced in the UI) → `k6FromTestCases.ts` generates a k6 script with **weighted scenarios** across the parsed cases.

### Path C — AI generation (Claude)
Describe the test in natural language (optionally attaching a file) → `POST /api/ai-generate` streams a complete k6 script back over SSE. The system prompt mandates the full InfluxDB instrumentation pattern, so AI-generated scripts are observability-complete out of the box. The generated script is editable in the page before running.

### Common to all generated scripts (`k6InfluxTemplate.ts`)
Every generator injects the same InfluxDB boilerplate:
- `__ENV.INFLUX_V2_*` env-var reads with an enable gate (org + bucket + token must all be set)
- `writeInfluxLines()` called after every HTTP request → writes `requestsRaw`, `k6_http_reqs_total`, `k6_http_req_duration_seconds`
- `setup()`/`teardown()` write `testStartEnd` events (used for Grafana annotations and the `$runId` variable)
- Per-iteration VU tracking (`virtualUsers`, `k6_iterations_total`, `k6_vus`)
- `gracefulRampDown: '5s'` + `gracefulStop: '5s'` on all scenarios

### Preview
Before running, the author can inspect the artifact at `/preview/:specId` or in the inline preview modal:
- `GET /api/test-specs/:id/preview/json` — the structured spec
- `GET /api/test-specs/:id/preview/k6` — the exact k6 script that will be dispatched

---

## 5. Phase 3 — Environments & Secrets (optional)

- **Environments** (`/environments`): named targets with a `baseUrl`, variables, and an optional approval gate (`requiresApproval`). A TestSpec references an environment so the same test can run against dev/staging/prod.
- **Secrets** (`/secrets`): named credentials with a backend path and rotation/expiry metadata, scoped to environments.

---

## 6. Phase 4 — Execution

There are two ways to run a test:

### 6.1 Run a saved TestSpec
From the Test Library (`/tests`) or the authoring page's Run modal → `POST /api/executions` with the spec id and target environment. The backend:
1. Creates an `Execution` row (`status: running`, `triggeredBy`, `specName`, `environment`).
2. Generates the k6 script from the spec (`k6Generator.ts`).
3. Hands off to the **job dispatcher**.

### 6.2 Ad-hoc run via Executor
The Executor page (`/executor`) accepts a raw k6 script plus run config (VUs, duration, stages, env vars) → `POST /api/executor/run` → same dispatcher path. This is the fastest loop for iterating on a script.

### 6.3 Job dispatch (`jobDispatcher.ts`)
1. Selects an **online** agent from the in-memory `agentRegistry`.
2. Enriches the run config: maps backend `INFLUXDB_*` env vars to the `INFLUX_V2_*` names the k6 script expects (user-supplied env vars override). Without this mapping, all in-band InfluxDB writes silently no-op.
3. Sends `{ type: 'dispatch_job', executionId, script, config }` over the agent's WebSocket.

### 6.4 Agent-side execution (`jobHandler.ts` → `k6Runner.ts`)
1. Agent replies `job_accepted`.
2. `k6Runner` prepares the script:
   - **Validates** it has an `export default function` (auto-injects an empty one if missing — k6 requires it even when scenarios use named `exec`).
   - **Injects the load profile**: if the run config carries `stages` and the script does *not* define its own `scenarios` block, the runner replaces the script's `stages: [...]` array using bracket-counting (not regex) so multi-stage arrays survive intact. Scripts that own a `scenarios` block are left untouched.
   - **CLI flags**: `--vus/--duration` are passed only when the script has no `scenarios` block, because k6 CLI flags completely override script scenarios.
3. Spawns `k6 run <script>` with the enriched env vars.
4. Parses k6 stdout line-by-line (`tryParseMetricLine`) and streams progress back as `job_update` messages (no `--out json` file — that was removed because the file grew to 50–100 MB and blocked completion).
5. On process exit, sends `job_complete` with exit code and summary (or `job_error` on failure). The control plane can also send `cancel_job` to abort.

### Agent WebSocket protocol (reference)

```
Agent → Control Plane:                      Control Plane → Agent:
  register     (agentId, name, hostname,      dispatch_job (executionId, script, config)
                k6Version)                    cancel_job   (executionId)
  heartbeat
  job_accepted (executionId)
  job_update   (executionId, update)
  job_complete (executionId, exitCode, summary)
  job_error    (executionId, message)
```

---

## 7. Phase 5 — Live Monitoring

While the test runs:

1. The frontend opens `WS /ws/executor/:executionId`. The control plane **fans out** every `job_update` from the agent to all browser sockets watching that execution — live VU counts, request rates, response times, raw k6 output.
2. In parallel, the k6 script writes raw measurements to InfluxDB **during the run**, so Grafana dashboards update in near-real-time.
3. As a safety net against dropped WS messages (e.g. agent reconnect mid-run), the Executor page also **polls** `GET /api/executions/:id` every 4 seconds while status is `running` and flips to complete when the DB shows `pass`/`fail`.

> **Tip:** set `RUN_ID=<name>` in the Executor env-vars panel. Otherwise each k6 lifecycle phase (setup / VU / teardown) computes its own `Date.now()`-based run id, which fragments Grafana `$runId` filtering.

---

## 8. Phase 6 — Completion & Results

When the agent sends `job_complete`, the control plane:

1. Evaluates **thresholds** and **checks** against the summary.
2. Updates the `Execution` row: `status` → `pass` or `fail`, plus `metrics` (p50/p90/p95/p99, avg, RPS, error rate, max VUs, total requests, duration), `thresholdResults`, and `checkResults`.
3. Pushes aggregated metrics to InfluxDB (`influxdb.ts`): one `k6_execution` point per run and one `k6_thresholds` point per threshold result.
4. Updates the TestSpec's `lastRunStatus`.

---

## 9. Phase 7 — Reporting & Dashboards

- **Reports** (`/reports`, `/reports/:executionId` via `GET /api/reports/:executionId`): per-execution report with metrics, threshold pass/fail breakdown, and check results, backed by the `Execution` record.
- **Dashboard** (`/`): health score, integration-connectivity card (live checks of InfluxDB and Grafana via `POST /api/config/test-connections`), and an **embedded Grafana dashboard**. The iframe loads through `GET /api/grafana-proxy`, which strips `X-Frame-Options`/CSP headers so Grafana renders same-origin.
- **Grafana** (direct at `:9999`): full drill-down on raw measurements. When querying `requestsRaw`, filter `samplerType=request` — each request is written twice (`request` and `transaction`) and metrics double otherwise. Note `requestsRaw.responseTime` is in **ms** while `k6_http_req_duration_seconds.value` is in **seconds**.
- **Executions list** (`GET /api/executions`): run history across all specs.

---

## 10. Full Sequence Diagram

```
User          Frontend          Control Plane          Agent            k6           InfluxDB      Grafana
 │  login        │                    │                  │               │               │             │
 │──────────────►│── POST /auth/login►│                  │               │               │             │
 │               │◄── JWT ────────────│                  │               │               │             │
 │  author test  │                    │                  │               │               │             │
 │──────────────►│── POST /test-specs►│ (save spec)      │               │               │             │
 │  run test     │                    │                  │               │               │             │
 │──────────────►│── POST /executions►│ create Execution │               │               │             │
 │               │                    │ generate k6 script               │               │             │
 │               │                    │── dispatch_job ─►│               │               │             │
 │               │                    │◄─ job_accepted ──│── spawn ─────►│               │             │
 │               │◄═ WS /ws/executor ═│◄═ job_update ════│◄═ stdout ═════│── writeInflux►│             │
 │   (live UI)   │      (fan-out)     │                  │               │   (in-band)   │◄─ queries ──│
 │               │                    │◄─ job_complete ──│◄── exit ──────│               │             │
 │               │                    │ eval thresholds, update DB       │               │             │
 │               │                    │── push k6_execution / k6_thresholds ────────────►│             │
 │  view report  │                    │                  │               │               │             │
 │──────────────►│── GET /reports/:id►│                  │               │               │             │
 │  dashboards   │── GET /api/grafana-proxy ──────────────────────────────────────────────────────────►│
```

---

## 11. Key API Reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Create user |
| POST | `/api/auth/login` | Public | Returns JWT |
| GET | `/api/auth/me` | JWT | Current user |
| POST | `/api/agents/register` | Public | Register agent → `{agentId, apiKey}` |
| GET | `/api/agents` | JWT | List agents with live status |
| GET/POST/PUT/DELETE | `/api/test-specs[/:id]` | JWT | TestSpec CRUD |
| GET | `/api/test-specs/:id/preview/{json,k6}` | JWT | Spec / script preview |
| POST | `/api/upload/test-cases` | JWT | Parse CSV test cases |
| POST | `/api/ai-generate` | JWT | Claude-generated k6 script (SSE stream) |
| POST | `/api/executions` | JWT | Run a saved TestSpec |
| GET | `/api/executions[/:id]` | JWT | Run history / status polling |
| POST | `/api/executor/run` | JWT | Dispatch ad-hoc k6 script |
| GET | `/api/reports/:executionId` | JWT | Execution report |
| GET | `/api/config` | Public | Grafana + InfluxDB config for UI |
| POST | `/api/config/test-connections` | Public | Live InfluxDB/Grafana health check |
| GET | `/api/grafana-proxy` | Public | Same-origin Grafana proxy |
| WS | `/ws/executor/:executionId` | — | Live run output to browser |
| WS | `/ws/agent/:agentId?apiKey=` | apiKey | Persistent agent connection |

---

## 12. Verifying a Run Landed in InfluxDB

```bash
curl -s -X POST "http://localhost:8086/api/v2/query?org=Trantor" \
  -H "Authorization: Token <token>" \
  -H "Content-Type: application/vnd.flux" \
  -d 'from(bucket:"k6") |> range(start:-1h) |> filter(fn:(r) => r._measurement == "requestsRaw") |> limit(n:5)'
```

A healthy run shows `requestsRaw`, `virtualUsers`, and `testStartEnd` sharing the same `runId`, plus one `k6_execution` point pushed by the backend.

---

## 13. Known Limitations (MVP)

- Agent `apiKey` is stored in plaintext in the DB (hashing is a TODO).
- The frontend executor WebSocket is unauthenticated; the cuid `executionId` acts as a nonce.
- No multi-tenant/org isolation yet.
- Grafana embedding relies on the header-stripping proxy (alternative: `allow_embedding = true` in Grafana config).

For deeper implementation history (Prisma 7 adapter setup, WS routing, k6 injection bugs and fixes), see [SNAPSHOT.md](../SNAPSHOT.md).
