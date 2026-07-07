# PTaaS — Performance Testing as a Service

A self-hosted platform for authoring, scheduling, and running k6 load tests,
with live execution streaming, InfluxDB/Grafana metrics, and Coralogix
log/trace observability — all behind a single control-plane UI.

**Stack**: React 18 + TypeScript + Vite + Tailwind (frontend) · Node.js +
Express + TypeScript + Prisma + PostgreSQL (backend) · standalone Node.js
load-test agent · k6 (test runner) · InfluxDB + Grafana (metrics).

---

## 1. Setup

**Windows — one command** (installs Node, PostgreSQL, InfluxDB, Grafana, k6,
and configures everything automatically):

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1
```

or just double-click `setup.bat` (self-elevates, no PowerShell knowledge needed).

**macOS / Linux:**

```bash
bash setup.sh
```

The installer is **idempotent** — safe to re-run any time to repair a broken
install. If something stops working later (after a reboot, port conflict,
etc.), run diagnostics instead of a full reinstall:

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1 -Diagnose
```

For the full breakdown of what the installer does, manual/step-by-step setup,
Coralogix configuration, and how to move an install to another machine, see
**[INSTALL.md](INSTALL.md)**.

### Environment variables

Copy `backend/.env.example` to `backend/.env` and fill in the values (the
installer does this for you). Key ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Signs login session tokens |
| `ANTHROPIC_API_KEY` | Enables AI-assisted k6 script generation |
| `INFLUXDB_*` / `GRAFANA_*` | Metrics storage + dashboard embedding |
| `SMTP_*` | Enables execution-alert emails and "forgot password" reset emails (optional — without it, alerts/reset emails just don't send) |
| `APP_URL` | Frontend origin used to build password-reset links (default `http://localhost:5173`) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` | Default admin/QA login created by `db:seed` (see below) |
| `CORALOGIX_*` | Optional log/trace shipping + Observability page |

---

## 2. Running it

```bash
# Terminal 1 — frontend (http://localhost:5173) + backend (http://localhost:3001)
npm run dev

# Terminal 2 — load-test agent (executes k6 scripts dispatched by the backend)
npm run agent:start
```

Other useful commands (run from `backend/`):

| Command | Purpose |
|---|---|
| `npx prisma migrate deploy` | Apply pending database migrations |
| `npm run db:seed` | Seed reference data (environments/secrets/test specs) **and** create/reset the default admin login (its password is reset to the seed value every run, even if the account already existed) |
| `npx prisma studio` | Browse/edit the database in a GUI |

### Logging in — first time on a new machine

Each machine has its own local PostgreSQL database, so a fresh clone starts
with **no user accounts** until you seed or register one:

```bash
cd backend
npm run db:seed
```

This creates (or resets) a default account — `admin@perfops.dev` / `Password`
unless overridden via `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` /
`SEED_ADMIN_NAME` in `backend/.env`. Log in with those credentials at
`http://localhost:5173`.

**Every time `db:seed` runs, the admin account's password is reset back to
the seed value** — even if it already exists and someone changed the
password since. This guarantees a known, working login on any machine at the
cost of clobbering manual password changes on that one account; if you don't
want that, log in with a different (non-seeded) account for day-to-day use,
or just avoid re-running `db:seed` on machines where the admin password has
been intentionally changed.

To create additional accounts, either use the **Admin** page once logged in,
or call the API directly:

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"qa2@example.com","password":"...","name":"QA Two"}'
```

### Forgot password

Click **Forgot password?** on the login page, enter the account's email, and
(if `SMTP_*` is configured in `backend/.env`) a reset link is emailed —
valid for 1 hour, single-use. Without SMTP configured, the reset token is
still generated but no email is sent; an admin can retrieve it directly from
the database (`User.resetTokenHash`/`resetTokenExpiresAt`) if needed.

---

## 3. Usage

| Page | Route | Purpose |
|---|---|---|
| Dashboard | `/` | Health score, integration connectivity, embedded Grafana overview |
| Test Author | `/tests/new`, `/tests/:id/edit` | Build a test spec manually, from a CSV/Excel upload, or via AI generation |
| Test Specs | `/tests` | Library of saved test specs |
| Test Suites | `/test-suites` | Group specs into suites |
| Preview | `/preview/:specId` | View the generated k6 script / request JSON before running |
| Environments | `/environments` | Target base URLs + variables per environment (dev/QA/staging/prod) |
| Secrets | `/secrets` | Manage credentials referenced by environments |
| Pipelines | `/pipelines` | CI/CD pipeline integration |
| Executor | `/executor` | Run a k6 script ad-hoc with live streaming output |
| Schedules | `/schedules` | Cron-based recurring test runs |
| Reports | `/reports`, `/report/:id` | Execution history + detailed per-run report |
| Notifications | `/notifications` | Email/Teams alerts on test pass/fail |
| Observability | `/observability` | Coralogix logs + traces (if configured) |
| Admin | `/admin` | User/agent management |

### Typical workflow

1. **Log in** (seeded admin account, or one you registered).
2. **Environments** → add the target(s) you're testing against.
3. **Test Author** → build a test spec (manual request builder, CSV/Excel
   import, or describe it in plain English for AI generation).
4. **Preview** the generated k6 script, then either:
   - run it immediately via **Executor** (ad-hoc, streamed live), or
   - save it and trigger/schedule it from **Test Specs** / **Schedules**.
5. **Reports** → review pass/fail, thresholds, response-time percentiles.
6. **Dashboard** / embedded Grafana → visualize trends across runs.
7. Optional: configure **Notifications** for pass/fail alerts, and
   **Observability** for Coralogix log/trace correlation during a run.

Load tests are executed by the standalone **agent** process (`npm run
agent:start`), which must be running (and registered — handled automatically
by the installer) for any Executor/scheduled run to actually execute.

---

## 4. Troubleshooting

- Run `powershell -ExecutionPolicy Bypass -File setup.ps1 -Diagnose` (or
  `diagnose.bat`) — it checks PostgreSQL, InfluxDB, Grafana, k6, and the
  backend, and auto-fixes what it safely can.
- Full setup log: `setup.log` in the project root.
- See **[INSTALL.md](INSTALL.md)** for detailed dependency info, Coralogix
  setup, and moving an install between machines.
