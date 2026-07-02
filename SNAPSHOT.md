# PerfOps Control Plane — Compressed Snapshot v2
## For a Fresh AI Instance Reading Cold
---

## 1. What Was Built

**PerfOps Control Plane** — a full-stack Performance Testing as a Service (PTaaS) platform with hybrid architecture.

- **Path**: `/Users/sohrab/Documents/Claude Repo/PTaaS/`
- **Stack**: React 18 + TypeScript + Vite + Tailwind (frontend) · Node.js + Express + TypeScript + Prisma + PostgreSQL (backend) · standalone Node.js (agent)
- **Ports**: Frontend `5173` (Vite dev) · Backend `3001` (Express) · InfluxDB `8086` · Grafana `9999`
- **Start**: `cd "/Users/sohrab/Documents/Claude Repo/PTaaS" && npm run dev`
- **Agent start**: `cd agent && npm start` (requires `agent/.env` with credentials)

---

## 2. Architecture

```
Browser (React)
  │  HTTPS/WSS via Vite proxy
  ▼
Control Plane (Express + PostgreSQL)          ← port 3001
  │  /ws/agent/:agentId  (WebSocket, persistent)
  ▼
Execution Agent (Node.js)                     ← standalone process
  │  spawns
  ▼
K6 binary (local machine)
  │  writeInfluxLines() HTTP POST inside VU context
  ▼
InfluxDB v2                                   ← port 8086
  │  data source
  ▼
Grafana                                       ← port 9999
```

Frontend WS (`/ws/executor/:executionId`) receives fan-out of agent updates from control plane.

---

## 3. Directory Structure

```
PTaaS/
├── agent/
│   ├── src/
│   │   ├── index.ts          ← CLI entrypoint, reads agent/.env
│   │   ├── connection.ts     ← WS reconnect wrapper (5s backoff, 15s heartbeat)
│   │   ├── jobHandler.ts     ← receives dispatch_job, runs K6Runner, streams back
│   │   └── k6Runner.ts       ← K6 process spawn, metric parsing, injectLoadProfile
│   ├── .env                  ← CONTROL_PLANE_URL, AGENT_ID, AGENT_API_KEY
│   └── package.json
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma     ← User, TestSpec, Execution, Environment, Secret, Agent
│   │   └── seed.ts           ← imports JSON flat files → PostgreSQL
│   ├── prisma.config.ts      ← Prisma 7 config (datasource.url for migrations)
│   ├── src/
│   │   ├── index.ts          ← Express app, WS routing, job_complete handler
│   │   ├── lib/prisma.ts     ← singleton with pg.Pool + PrismaPg adapter
│   │   ├── middleware/auth.ts ← requireAuth, requireRole (JWT)
│   │   ├── routes/
│   │   │   ├── auth.ts       ← register/login/me (public)
│   │   │   ├── agents.ts     ← /agents/register (public), /agents (protected)
│   │   │   ├── config.ts     ← /config GET + /config/test-connections POST (public)
│   │   │   ├── grafanaProxy.ts ← strips X-Frame-Options, proxies to Grafana
│   │   │   ├── executor.ts   ← /executor/run → dispatchJob
│   │   │   ├── executions.ts ← CRUD + trigger via dispatchJob
│   │   │   ├── testSpecs.ts  ← CRUD + preview endpoints
│   │   │   ├── dashboard.ts  ← aggregated stats
│   │   │   ├── environments.ts, secrets.ts, reports.ts, upload.ts
│   │   │   └── aiGenerate.ts ← Claude SSE streaming with InfluxDB system prompt
│   │   └── services/
│   │       ├── agentRegistry.ts   ← in-memory Map of connected agent WebSockets
│   │       ├── jobDispatcher.ts   ← assigns jobs, injects INFLUX_V2_* env vars
│   │       ├── influxdb.ts        ← pushExecutionMetrics → k6_execution + k6_thresholds
│   │       ├── k6Generator.ts     ← TestSpec → K6 script with InfluxDB boilerplate
│   │       ├── k6FromTestCases.ts ← CSV/parsed test cases → K6 script
│   │       └── k6InfluxTemplate.ts ← shared InfluxDB boilerplate for all generators
│   ├── .env                  ← all credentials (see §8)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx           ← AuthProvider + ProtectedRoute + all routes
│   │   ├── contexts/AuthContext.tsx  ← JWT in localStorage, login/logout
│   │   ├── components/
│   │   │   ├── ProtectedRoute.tsx   ← redirects to /login if no token
│   │   │   └── Sidebar.tsx         ← shows user.name, logout button
│   │   ├── pages/
│   │   │   ├── Login.tsx           ← email/password form
│   │   │   ├── Dashboard.tsx       ← health score + Integration Connectivity card + Grafana iframe
│   │   │   └── Executor.tsx        ← ad-hoc K6 runner with live WS streaming
│   │   └── lib/api.ts        ← injects Bearer token, handles 401→redirect
│   └── vite.config.ts        ← proxies /api → :3001, /ws → ws://localhost:3001
├── package.json              ← workspaces: [frontend, backend, agent]
└── SNAPSHOT.md               ← this file
```

---

## 4. Critical Technical Decisions & Bugs Fixed

### 4.1 Prisma 7 — `url` moved out of schema.prisma

**Problem**: Prisma 7 removed `url` from `datasource db {}` block. Two separate fixes needed:
- For **migrations**: `prisma.config.ts` must export `datasource.url`
- For **runtime client**: `pg.Pool` + `PrismaPg` adapter required; `new PrismaClient()` alone fails

**Fix — `backend/prisma.config.ts`**:
```typescript
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env'), override: true });
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join(__dirname, 'prisma/schema.prisma'),
  datasource: { url: process.env.DATABASE_URL! },
});
```

**Fix — `backend/src/lib/prisma.ts`**:
```typescript
import * as dotenv from 'dotenv';
import * as path from 'path';
// dotenv MUST be called here — static imports are hoisted before index.ts dotenv.config()
dotenv.config({ path: path.join(__dirname, '../../.env'), override: true });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);
export default prisma;
```

> ⚠️ If `dotenv` is not loaded in `prisma.ts` itself, `DATABASE_URL` is undefined at pool creation time (hoisting issue), and Prisma connects to a database named after the OS user.

### 4.2 WebSocket Routing — Two WSS instances, one `upgrade` handler

Both `/ws/executor/:id` (frontend) and `/ws/agent/:id` (agent) share the same HTTP server. A single `upgrade` listener routes them:

```typescript
const executorWss = new WebSocketServer({ noServer: true });
const agentWss    = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = req.url ?? '';
  if (url.startsWith('/ws/executor/'))   executorWss.handleUpgrade(req, socket as any, head, ws => executorWss.emit('connection', ws, req));
  else if (url.startsWith('/ws/agent/')) agentWss.handleUpgrade(req, socket as any, head, ws => agentWss.emit('connection', ws, req));
  else socket.destroy();
});
```

> ⚠️ Vite dev server does NOT proxy WebSockets by default. `vite.config.ts` MUST have `'/ws': { target: 'ws://localhost:3001', ws: true }`. Additionally, the Executor page connects **directly** to `ws://localhost:3001` in dev (bypasses proxy entirely) to avoid Vite WS proxy flakiness:
> ```typescript
> const wsUrl = import.meta.env.DEV
>   ? `ws://localhost:3001/ws/executor/${data.executionId}`
>   : `${wsProto}//${wsHost}/ws/executor/${data.executionId}`;
> ```

### 4.3 Agent Authentication — apiKey query param, not JWT

Browser WebSocket connections cannot set `Authorization` headers. Agent auth uses `apiKey` in the query string:

```
wss://control-plane/ws/agent/:agentId?apiKey=<token>
```

Backend validates on upgrade:
```typescript
const parsedUrl = new URL(urlPath, 'http://localhost');
const apiKey = parsedUrl.searchParams.get('apiKey');
const agentRecord = await prisma.agent.findUnique({ where: { id: agentId } });
if (!agentRecord || agentRecord.apiKey !== apiKey) { ws.close(1008, 'Unauthorized'); return; }
```

### 4.4 InfluxDB ENV Var Name Mismatch — INFLUXDB_* vs INFLUX_V2_*

The backend uses `INFLUXDB_*` naming. K6 scripts use `__ENV.INFLUX_V2_*`. These MUST be mapped at dispatch time or `INFLUX_V2_ENABLED = false` in every VU → all `writeInfluxLines()` calls silently no-op.

**Fix — `backend/src/services/jobDispatcher.ts`**:
```typescript
function buildInfluxEnvVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  if (process.env.INFLUXDB_URL)    vars['INFLUX_V2_URL']    = process.env.INFLUXDB_URL;
  if (process.env.INFLUXDB_TOKEN)  vars['INFLUX_V2_TOKEN']  = process.env.INFLUXDB_TOKEN;
  if (process.env.INFLUXDB_ORG)    vars['INFLUX_V2_ORG']    = process.env.INFLUXDB_ORG;
  if (process.env.INFLUXDB_BUCKET) vars['INFLUX_V2_BUCKET'] = process.env.INFLUXDB_BUCKET;
  return vars;
}
// In dispatchJob():
const enrichedConfig = {
  ...config,
  envVars: { ...buildInfluxEnvVars(), ...(config.envVars ?? {}) }, // user overrides win
};
```

### 4.5 K6 CLI Flags Override `options.scenarios`

**Problem**: Passing `--vus 10 --duration 1m` to K6 COMPLETELY overrides `options.scenarios`. The script's `exec: 'customerLifecycle'` is ignored; the empty auto-injected `export default function() {}` runs at CPU speed (1.4M iterations/2s). K6 output shows `default [ 3% ]` instead of the scenario name.

**Fix — `agent/src/k6Runner.ts`**: Only pass CLI flags when the script has no `scenarios` block:
```typescript
const scriptHasScenarios = /export\s+const\s+options\s*=[\s\S]*?scenarios\s*:/.test(scriptContent);
if (!scriptHasScenarios && config.vus && config.profileType === 'constant') {
  args.push('--vus', String(config.vus));
  args.push('--duration', config.duration || '1m');
}
```

### 4.6 `injectLoadProfile` Regex Was Non-Greedy

**Problem**: The regex `/stages:\s*\[[\s\S]*?\]/m` stopped at the **first** `]`, corrupting multi-stage arrays:
```javascript
// Original script
stages: [
  { duration: '2m', target: 20 },  // regex stopped here
  { duration: '8m', target: 20 },  // ← now orphaned = syntax error
  { duration: '2m', target: 0  },
]
// After broken replacement
stages: [{"target":5,"duration":"1m"}],
  { duration: '8m', target: 20 },  // INVALID JS → K6 setup() runs, VUs crash, teardown() runs
```

K6 symptom: `testStartEnd started` and `finished` written to InfluxDB (different `runId` because each lifecycle phase re-evaluates `Date.now()`), but zero `requestsRaw` / `virtualUsers` written.

**Fix — bracket-counting + scenarios skip**:
```typescript
private injectLoadProfile(config: RunnerConfig): string {
  if (!config.stages || config.stages.length === 0) return config.script;

  // Skip injection if script owns its own scenarios configuration
  if (/export\s+const\s+options\s*=[\s\S]*?scenarios\s*:/.test(config.script)) return config.script;

  const stagesJson = JSON.stringify(config.stages);
  const stagesKeyIdx = config.script.indexOf('stages:');
  if (stagesKeyIdx === -1) return `// PerfOps injected stages: ${stagesJson}\n${config.script}`;

  const bracketOpen = config.script.indexOf('[', stagesKeyIdx);
  if (bracketOpen === -1) return config.script;

  let depth = 0, bracketClose = -1;
  for (let i = bracketOpen; i < config.script.length; i++) {
    if (config.script[i] === '[') depth++;
    else if (config.script[i] === ']') { if (--depth === 0) { bracketClose = i; break; } }
  }
  if (bracketClose === -1) return config.script;

  return config.script.slice(0, stagesKeyIdx) + `stages: ${stagesJson}` + config.script.slice(bracketClose + 1);
}
```

### 4.7 `--out json=file` Blocked Completion Signal

**Problem**: K6's `--out json=summaryPath` writes every single data point (including all in-band InfluxDB HTTP calls) to a file. For a 1-minute test with InfluxDB integration active, this file grows to 50-100 MB. Reading it synchronously in the `close` handler blocked the `complete` signal by many seconds → frontend stuck at 100%/running.

**Fix**: Removed `--out json` entirely. K6 args are now just `['run', scriptPath]`. Real-time metrics captured via `tryParseMetricLine()` from stdout.

### 4.8 `job_complete` → Status Never Updates (Race Condition)

Frontend WS completes message can be dropped if agent reconnects mid-run. Added DB-polling fallback in `Executor.tsx`:
```typescript
useEffect(() => {
  if (status !== 'running') return;
  const interval = setInterval(async () => {
    const res = await fetch(`/api/executions/${executionIdRef.current}`, { headers: { Authorization: `Bearer ${token}` } });
    const exec = await res.json();
    if (exec.status === 'pass' || exec.status === 'fail') {
      setStatus('complete');
      clearInterval(interval);
    }
  }, 4000);
  return () => clearInterval(interval);
}, [status]);
```

### 4.9 Grafana Iframe Blocked by X-Frame-Options

**Problem**: Grafana sends `X-Frame-Options: SAMEORIGIN` + CSP blocking iframe embeds from different origins.

**Fix — `backend/src/routes/grafanaProxy.ts`**: Backend proxies Grafana HTML, strips the blocking headers. Frontend iframe loads `/api/grafana-proxy?path=/d/uid&orgId=1&kiosk` (same-origin) instead of `http://localhost:9999/d/...` (cross-origin):
```typescript
response.headers.forEach((value, key) => {
  const lower = key.toLowerCase();
  if (lower === 'x-frame-options') return;         // blocks iframe
  if (lower === 'content-security-policy') return; // blocks iframe
  if (lower === 'transfer-encoding') return;
  res.setHeader(key, value);
});
```

### 4.10 K6 `export default function` Required Even With Named `exec`

K6 always requires `export default function` even when all scenarios specify `exec: 'namedFunction'`. Without it, K6 exits 104 with "function 'default' not found in exports".

**Fix — `agent/src/k6Runner.ts`**: Auto-inject if missing (safe — K6 ignores it when scenarios have explicit `exec`):
```typescript
private validateScript(script: string): string {
  const hasDefault = script.includes('export default function') ||
                     script.includes('export default async function');
  if (!hasDefault) {
    console.warn('[K6Runner] Auto-injecting missing export default function');
    return script + '\n\nexport default function() {}\n';
  }
  return script;
}
```

### 4.11 InfluxDB K6 Script Variables (Checklist)

The K6 script uses `__ENV.INFLUX_V2_*` naming. The gate is:
```javascript
const INFLUX_V2_ENABLED = !!(INFLUX_V2_ORG && INFLUX_V2_BUCKET && INFLUX_V2_TOKEN);
```
All three must be non-empty or **every `writeInfluxLines()` call returns early** (silent no-op).

**Measurements written by the K6 script** (require `INFLUX_V2_ENABLED=true`):
| Measurement | Written in | Grafana use |
|---|---|---|
| `requestsRaw` | `recordCustomMetrics()` in VU | Response time, error rate per endpoint |
| `virtualUsers` | `influxIterationTracking()` in VU | VU concurrency panel |
| `testStartEnd` | `setup()` / `teardown()` | Annotations, `$runId` Grafana variable |
| `k6_http_reqs_total` | `recordCustomMetrics()` | Throughput |
| `k6_http_req_duration_seconds` | `recordCustomMetrics()` | Durations (in **seconds**) |

**`requestsRaw` is written TWICE per request**: `samplerType=request` and `samplerType=transaction`. Always filter `samplerType=request` in Grafana or metrics are doubled.

**`requestsRaw.responseTime` is in ms**; `k6_http_req_duration_seconds.value` is in seconds (÷1000 from `response.timings.duration`).

**`RUN_ID = __ENV.RUN_ID || ('PerfOps-' + Date.now())`**: `Date.now()` is re-evaluated independently in setup, VU, and teardown contexts → different `runId` per lifecycle phase unless `RUN_ID` env var is explicitly passed. Set `RUN_ID=my-run-name` in Executor env vars for consistent Grafana filtering.

### 4.12 Backend InfluxDB Push (Separate from K6 In-Band Writes)

After each test execution, the **backend** also pushes aggregated metrics to InfluxDB via `@influxdata/influxdb-client`:
- **`k6_execution`** — one point: p50/p90/p95/p99/avg/rps/error_rate/max_vus/total_requests/duration/threshold_breaches
- **`k6_thresholds`** — one point per threshold result

This is separate from (and supplementary to) the K6 in-band writes. These points use `INFLUXDB_*` naming (not `INFLUX_V2_*`) read directly from `process.env`.

### 4.13 Graceful Shutdown Prevents EADDRINUSE

`--vus/--duration` and `K6_GRACEFUL_STOP` affect test duration. Generated scripts now use `gracefulRampDown: '5s'` and `gracefulStop: '5s'` to prevent hanging at 100%.

Backend has explicit SIGTERM/SIGINT handlers to close the HTTP server + disconnect Prisma before exit:
```typescript
function shutdown() {
  server.close(() => { prisma.$disconnect().then(() => process.exit(0)); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
```

---

## 5. Navigation Routes

```
/                   → Dashboard (health score + Integration Connectivity + Grafana iframe)
/login              → Login (public, JWT)
/tests/new          → Test Authoring
/tests/:id/edit     → Test Authoring
/tests              → Test Specs Library
/preview/:specId    → JSON + K6 Preview
/environments       → Environments
/secrets            → Secrets
/pipelines          → CI/CD Pipelines
/executor           → K6 Executor (ad-hoc live execution)
/reports            → Reports
/admin              → Admin
```

---

## 6. Backend `.env` (current)

```bash
# /Users/sohrab/Documents/Claude Repo/PTaaS/backend/.env
ANTHROPIC_API_KEY=sk-ant-api03-...          # required for AI script generation
DATABASE_URL="postgresql://sohrab@localhost:5432/ptaas"
JWT_SECRET="b9f3e2a1d4c6b8f0e2a4c6d8f0b2e4a6c8d0f2a4b6e8c0d2f4a6b8c0d2e4f6"
JWT_EXPIRES_IN="7d"
INFLUXDB_URL="http://localhost:8086"
INFLUXDB_TOKEN="xLnNaWeycochIV0sD8q_..."   # full token in file
INFLUXDB_ORG="Trantor"
INFLUXDB_BUCKET="k6"
GRAFANA_URL="http://localhost:9999"
GRAFANA_DASHBOARD_UID="adwnc6t"
```

## 7. Agent `.env`

```bash
# /Users/sohrab/Documents/Claude Repo/PTaaS/agent/.env
CONTROL_PLANE_URL="http://localhost:3001"
AGENT_ID="<cuid from POST /api/agents/register>"
AGENT_API_KEY="<64-char hex from POST /api/agents/register>"
```

---

## 8. Key API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Create user |
| POST | `/api/auth/login` | Public | Returns JWT |
| GET | `/api/auth/me` | JWT | Current user |
| POST | `/api/agents/register` | Public | Create agent, returns `{agentId, apiKey}` |
| GET | `/api/agents` | JWT | List agents with live status |
| GET | `/api/config` | Public | Returns Grafana + InfluxDB config for UI |
| POST | `/api/config/test-connections` | Public | Live health check InfluxDB + Grafana |
| GET | `/api/grafana-proxy` | Public | Proxies Grafana, strips X-Frame-Options |
| POST | `/api/executor/run` | JWT | Dispatch ad-hoc K6 script to agent |
| POST | `/api/executions` | JWT | Trigger test spec run |
| WS | `/ws/executor/:executionId` | — | Frontend receives live K6 output |
| WS | `/ws/agent/:agentId?apiKey=` | apiKey | Agent persistent connection |

---

## 9. Agent WebSocket Protocol

```
Agent → Control Plane:
  { type: 'register',    agentId, name, hostname, k6Version }
  { type: 'heartbeat' }
  { type: 'job_accepted', executionId }
  { type: 'job_update',  executionId, update: {type, timestamp, data} }
  { type: 'job_complete', executionId, exitCode, summary }
  { type: 'job_error',   executionId, message }

Control Plane → Agent:
  { type: 'dispatch_job', executionId, script, config }
  { type: 'cancel_job',   executionId }
```

---

## 10. Prisma Schema (summary)

```prisma
// backend/prisma/schema.prisma
model User        { id, email (unique), passwordHash, name, role: ADMIN|TESTER|VIEWER }
model TestSpec    { id, name, request(Json), loadProfile(Json), thresholds(Json), checks[], environmentId, lastRunStatus, executions[] }
model Execution   { id, specId, specName, environment, status, triggeredBy, metrics(Json?), thresholdResults(Json), checkResults(Json), agentId }
model Environment { id, name, baseUrl, variables(Json), secrets[], requiresApproval }
model Secret      { id, name, backend, backendPath, environments[], lastRotated, expiresAt }
model Agent       { id, name, apiKey(unique), status: online|offline|busy, hostname, lastSeen, k6Version, executions[] }
```

Run migrations: `cd backend && npx prisma migrate dev --name init`
Seed from JSON files: `npm run db:seed`

---

## 11. K6 Script Generation Pipeline

Three generators all inject the same InfluxDB boilerplate from `k6InfluxTemplate.ts`:

1. **`k6Generator.ts`** — TestSpec (struct) → K6 script. Called when test spec is triggered via `/api/executions`.
2. **`k6FromTestCases.ts`** — CSV/parsed test cases → K6 script with weighted scenarios. Called from upload endpoint.
3. **`aiGenerate.ts` (Claude)** — Claude Opus streams JS directly. System prompt now mandates the full InfluxDB boilerplate pattern including `writeInfluxLines()` after every HTTP request.

All generated scripts include:
- `INFLUX_V2_*` env var declarations (reads from `__ENV.*`)
- `writeInfluxLines()` + helpers injected at module level
- `setup()` / `teardown()` writing `testStartEnd` events
- Per-iteration VU tracking (`virtualUsers`, `k6_iterations_total`, `k6_vus`)
- `recordCustomMetrics()` called after every HTTP request (writes `requestsRaw` + `k6_http_req_*`)
- `gracefulRampDown: '5s'` + `gracefulStop: '5s'` on all scenarios

---

## 12. Frontend Auth Flow

```
User visits any route → AuthContext checks localStorage('auth_token')
  No token → <Navigate to="/login" replace />
  POST /api/auth/login → { token, user } → localStorage + state
  All api.ts requests inject: Authorization: Bearer <token>
  401 response → clear localStorage → redirect /login
```

`api.ts` also adds auth token to raw `fetch()` calls (AIGeneratePanel, Executor, TestAuthor) that can't go through the api wrapper.

---

## 13. Open Issues / Current State

| Issue | Status |
|---|---|
| `RUN_ID` differs between K6 lifecycle phases | By design (Date.now() per context). Pass `RUN_ID=name` via Executor env vars panel for consistent Grafana `$runId` filtering |
| No authentication on frontend WS `/ws/executor/:id` | executionId is a cuid nonce — acceptable for MVP |
| Agent apiKey stored plaintext in DB | TODO: bcrypt hash before storing |
| No PostgreSQL for multi-tenant | Current schema supports it, no org isolation yet |
| K6 binary at `~/bin/k6` (arm64 macOS) | Installed manually; agent resolves from `~/bin/k6`, `/usr/local/bin/k6`, `/opt/homebrew/bin/k6` |
| Grafana requires `allow_embedding = true` | OR use `/api/grafana-proxy` (currently active — strips headers server-side) |
| `requestsRaw` has different `runId` from `testStartEnd` | Fixed by §4.6. Verify by running a test and checking both measurements share same `runId` in InfluxDB |

---

## 14. Database Setup Commands

```bash
# First time
createdb ptaas
cd "/Users/sohrab/Documents/Claude Repo/PTaaS/backend"
npx prisma migrate dev --name init
npm run db:seed              # imports backend/data/*.json into PostgreSQL

# Register first user (after backend is running)
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@perfops.dev","password":"password123","name":"Admin User"}'

# Register an agent
curl -X POST http://localhost:3001/api/agents/register \
  -H "Content-Type: application/json" \
  -d '{"name":"local-agent"}'
# → copy agentId and apiKey into agent/.env
```

---

## 15. InfluxDB Query: Verify K6 Data After a Run

```bash
# Correct shell quoting — URL must be quoted, ? is a shell glob wildcard
curl -s -X POST "http://localhost:8086/api/v2/query?org=Trantor" \
  -H "Authorization: Token <token>" \
  -H "Content-Type: application/vnd.flux" \
  -d 'from(bucket:"k6") |> range(start:-1h) |> filter(fn:(r) => r._measurement == "requestsRaw") |> limit(n:5)'

# Check all measurements in bucket
curl -s -X POST "http://localhost:8086/api/v2/query?org=Trantor" \
  -H "Authorization: Token <token>" \
  -H "Content-Type: application/vnd.flux" \
  -d 'import "influxdata/influxdb/schema"
schema.measurements(bucket: "k6")'
```
