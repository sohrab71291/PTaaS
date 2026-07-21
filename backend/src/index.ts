import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env'), override: true });

import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';

import { requireAuth } from './middleware/auth';
import { evaluateSlos, SloDefinition } from './lib/slo';
import authRouter from './routes/auth';
import agentsRouter from './routes/agents';
import dashboardRouter from './routes/dashboard';
import testSpecsRouter from './routes/testSpecs';
import executionsRouter from './routes/executions';
import environmentsRouter from './routes/environments';
import secretsRouter from './routes/secrets';
import reportsRouter from './routes/reports';
import uploadRouter from './routes/upload';
import executorRouter from './routes/executor';
import aiGenerateRouter from './routes/aiGenerate';
import harGenerateRouter from './routes/harGenerate';

import { agentRegistry } from './services/agentRegistry';
import { getAutoFixRun, clearAutoFixRun, attemptAutoFix } from './services/autoFixRunner';
import { pushExecutionMetrics } from './services/influxdb';
import { coralogix } from './services/coralogix';
import { requestLogger } from './middleware/requestLogger';
import configRouter, { testConnections } from './routes/config';
import { selfHealConnections } from './lib/selfHeal';
import grafanaProxyRouter from './routes/grafanaProxy';
import grafanaSyncRouter from './routes/grafanaSync';
import schedulesRouter from './routes/schedules';
import notificationsRouter from './routes/notifications';
import coralogixRouter from './routes/coralogix';
import { schedulerService } from './services/schedulerService';
import prisma from './lib/prisma';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(requestLogger);

// Public routes (no JWT required)
app.use('/api/auth', authRouter);
app.use('/api', agentsRouter);   // POST /agents/register is public; GET /agents checks auth internally

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

app.use('/api/config', configRouter);         // public — exposes Grafana URL for frontend embedding
app.use('/api', grafanaProxyRouter);          // public — proxies Grafana dashboard, strips X-Frame-Options
app.use('/api', grafanaSyncRouter);           // public — sync PTaaS dashboard layout to Grafana

// All remaining routes require JWT
app.use(requireAuth as any);

app.use('/api/dashboard', dashboardRouter);
app.use('/api/test-specs', testSpecsRouter);
app.use('/api/executions', executionsRouter);
app.use('/api/environments', environmentsRouter);
app.use('/api/secrets', secretsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api', uploadRouter);
app.use('/api', executorRouter);
app.use('/api', aiGenerateRouter);
app.use('/api', harGenerateRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api', coralogixRouter);

// Safety net: an uncaught throw inside an async route handler rejects a
// promise Express never awaits, so without this it propagates to the
// process and crashes the entire server for every user from one bad
// request (e.g. a malformed TestSpec triggering a null-deref in a script
// generator). Routes should still catch+next(err) themselves where
// practical, but this guarantees a 500 instead of a full crash either way.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Unhandled route error]', err);
  if (res.headersSent) return;
  res.status(500).json({ error: err?.message ?? 'Internal server error' });
});

// Map of frontend WebSocket clients waiting for execution results
// key: executionId, value: WebSocket
export const frontendClients = new Map<string, WebSocket>();

// Buffers every message sent to an execution's frontend WS, keyed by executionId.
// The frontend only opens its WebSocket *after* POST /api/executor/run resolves —
// for scripts that fail almost instantly (e.g. an unresolvable import), the agent
// can send job_error/job_complete before that socket exists, so frontendClients.get()
// finds nothing and the real error text is silently dropped with no way to recover
// it. This buffer lets a late-connecting client replay everything it missed instead
// of only seeing the generic "Execution complete. Exit code: N" replay message.
// Cleared ~10 minutes after the execution finishes to bound memory.
const executionLogBuffers = new Map<string, any[]>();
const EXECUTION_BUFFER_MAX = 500;

function sendToExecution(executionId: string, payload: any): void {
  const buf = executionLogBuffers.get(executionId) ?? [];
  buf.push(payload);
  if (buf.length > EXECUTION_BUFFER_MAX) buf.shift();
  executionLogBuffers.set(executionId, buf);

  const clientWs = frontendClients.get(executionId);
  if (clientWs?.readyState === WebSocket.OPEN) {
    clientWs.send(JSON.stringify(payload));
  }
}

function scheduleExecutionBufferCleanup(executionId: string): void {
  setTimeout(() => executionLogBuffers.delete(executionId), 10 * 60 * 1000).unref();
}

// Rolling metrics accumulated from job_update events — used as fallback
// when the agent sends summary:null in job_complete
const rollingMetrics = new Map<string, {
  p50: number; p90: number; p95: number; p99: number; avg: number;
  rps: number; errorRate: number; vus: number;
  totalRequests: number; maxVUs: number;
}>();

const server = http.createServer(app);

// Two separate WS servers — one for browser clients, one for agents
const executorWss = new WebSocketServer({ noServer: true });
const agentWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = req.url ?? '';
  if (url.startsWith('/ws/executor/')) {
    executorWss.handleUpgrade(req, socket as any, head, ws => {
      executorWss.emit('connection', ws, req);
    });
  } else if (url.startsWith('/ws/agent/')) {
    agentWss.handleUpgrade(req, socket as any, head, ws => {
      agentWss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

// ── Frontend executor WebSocket (/ws/executor/:executionId) ──────────────────
executorWss.on('connection', async (ws: WebSocket, req) => {
  const executionId = req.url?.split('/').filter(Boolean).pop();
  if (!executionId) { ws.close(); return; }

  // Validate execution exists
  const exec = await prisma.execution.findUnique({ where: { id: executionId } }).catch(() => null);
  if (!exec) {
    ws.send(JSON.stringify({ type: 'error', timestamp: Date.now(), data: { message: 'Execution not found' } }));
    ws.close();
    return;
  }

  // Race condition guard: if the job already finished before the WS connected, replay
  // everything that was buffered (the real log lines/error text included) instead of
  // just a generic synthetic message — see executionLogBuffers above for why this matters.
  if (exec.status === 'pass' || exec.status === 'fail' || exec.status === 'complete') {
    const buffered = executionLogBuffers.get(executionId);
    if (buffered?.length) {
      for (const payload of buffered) ws.send(JSON.stringify(payload));
    } else {
      ws.send(JSON.stringify({
        type: 'complete',
        timestamp: Date.now(),
        data: { exitCode: exec.status === 'pass' ? 0 : 1, summary: null },
      }));
    }
    ws.close();
    return;
  }
  if (exec.status === 'failed') {
    const buffered = executionLogBuffers.get(executionId);
    if (buffered?.length) {
      for (const payload of buffered) ws.send(JSON.stringify(payload));
    } else {
      ws.send(JSON.stringify({
        type: 'error',
        timestamp: Date.now(),
        data: { message: 'Execution failed before connection was established' },
      }));
    }
    ws.close();
    return;
  }

  // The job may already be running with some log lines buffered from before this
  // socket connected (same race as above, just not yet terminal) — replay those too.
  const alreadyBuffered = executionLogBuffers.get(executionId);
  if (alreadyBuffered?.length) {
    for (const payload of alreadyBuffered) ws.send(JSON.stringify(payload));
  }

  frontendClients.set(executionId, ws);

  ws.on('message', async (msg: Buffer) => {
    try {
      const { action } = JSON.parse(msg.toString());
      if (action === 'stop') {
        // Find which agent is running this execution and forward cancel
        const execution = await prisma.execution.findUnique({ where: { id: executionId } });
        if (execution?.agentId) {
          agentRegistry.dispatch(execution.agentId, { type: 'cancel_job', executionId });
        }
      }
    } catch {}
  });

  ws.on('close', () => {
    frontendClients.delete(executionId);
  });
});

// ── Agent WebSocket (/ws/agent/:agentId) ────────────────────────────────────
agentWss.on('connection', async (ws: WebSocket, req) => {
  const urlPath = req.url ?? '';
  const agentId = urlPath.split('/').filter(Boolean).pop()?.split('?')[0];
  if (!agentId) { ws.close(); return; }

  // Authenticate via apiKey query param
  const parsedUrl = new URL(urlPath, 'http://localhost');
  const apiKey = parsedUrl.searchParams.get('apiKey');

  const agentRecord = await prisma.agent.findUnique({ where: { id: agentId } }).catch(() => null);
  if (!agentRecord || agentRecord.apiKey !== apiKey) {
    ws.close(1008, 'Unauthorized');
    return;
  }

  // Register agent
  agentRegistry.register(agentId, ws);
  await prisma.agent.update({
    where: { id: agentId },
    data: { status: 'online', lastSeen: new Date() },
  }).catch(() => {});

  console.log(`[Agent] ${agentRecord.name} (${agentId}) connected`);
  coralogix.info('agent', { event: 'agent_connected', agentId, agentName: agentRecord.name });

  ws.on('message', async (msg: Buffer) => {
    let payload: any;
    try { payload = JSON.parse(msg.toString()); } catch { return; }

    switch (payload.type) {
      case 'register':
        await prisma.agent.update({
          where: { id: agentId },
          data: {
            hostname: payload.hostname ?? null,
            k6Version: payload.k6Version ?? null,
            lastSeen: new Date(),
          },
        }).catch(() => {});
        break;

      case 'heartbeat':
        agentRegistry.updateLastSeen(agentId);
        await prisma.agent.update({
          where: { id: agentId },
          data: { lastSeen: new Date() },
        }).catch(() => {});
        break;

      case 'job_accepted':
        coralogix.info('k6_execution', {
          event:       'execution_accepted',
          executionId: payload.executionId,
          agentId,
          agentName:   agentRecord.name,
        });
        break;

      case 'job_update': {
        sendToExecution(payload.executionId, payload.update);
        // Accumulate rolling metrics from the live stream
        if (payload.update?.type === 'metric' && payload.update.data) {
          const d   = payload.update.data;
          const cur = rollingMetrics.get(payload.executionId) ?? {
            p50: 0, p90: 0, p95: 0, p99: 0, avg: 0,
            rps: 0, errorRate: 0, vus: 0, totalRequests: 0, maxVUs: 0,
          };
          if (d.p50           != null) cur.p50           = d.p50;
          if (d.p95           != null) cur.p95           = d.p95;
          if (d.avg           != null) cur.avg           = d.avg;
          if (d.rps           != null) cur.rps           = d.rps;
          if (d.totalRequests != null) cur.totalRequests = d.totalRequests;  // exact count from JSON stream
          if (d.errorRate     != null) cur.errorRate     = d.errorRate;
          if (d.vus           != null) { cur.vus = d.vus; cur.maxVUs = Math.max(cur.maxVUs, d.vus); }
          rollingMetrics.set(payload.executionId, cur);
        }
        break;
      }

      case 'job_complete': {
        const { executionId, exitCode, summary, thresholdResults = [], checkResults = [] } = payload;

        // Helper: send a log line to the executor console
        const sendLog = (text: string) => {
          sendToExecution(executionId, { type: 'log', timestamp: Date.now(), data: { line: text } });
        };

        // Helper: notify the frontend which pipeline stage just changed, so
        // the test-suite card can render a live progress bar (Script Generation >
        // Script Execution > PostgreSQL Updated > InfluxDB Updated > Published to Grafana).
        const sendStage = (stage: string, status: 'done' | 'error' | 'skipped') => {
          sendToExecution(executionId, { type: 'stage', timestamp: Date.now(), data: { stage, status } });
        };
        sendStage('script_execution', 'done');

        // ── 1. Persist to PostgreSQL ───────────────────────────────────────────
        // Prefer k6 end-of-test summary; fall back to rolling metrics accumulated
        // from job_update events (agent sends summary:null when using --out json mode)
        const rolling = rollingMetrics.get(executionId);
        const metrics = summary ? extractMetrics(summary) : (rolling ? {
          p50:           rolling.p50,
          p90:           rolling.p90,
          p95:           rolling.p95,
          p99:           rolling.p99 || null,
          avg:           rolling.avg,
          rps:           rolling.rps,
          errorRate:     rolling.errorRate,
          maxVUs:        rolling.maxVUs,
          totalRequests: rolling.totalRequests,
        } : null);
        rollingMetrics.delete(executionId);
        const execution = await prisma.execution.findUnique({ where: { id: executionId } }).catch(() => null);
        const duration = execution?.startedAt
          ? Math.round((Date.now() - execution.startedAt.getTime()) / 1000)
          : null;

        // Evaluate SLOs against final metrics
        const slosDefs = Array.isArray((execution as any)?.slos) ? (execution as any).slos as SloDefinition[] : [];
        const sloResults = evaluateSlos(slosDefs, metrics as any);

        // A run only passes if: k6 itself exited cleanly (all API calls succeeded
        // and k6 thresholds were met), AND any defined SLA/SLO checks also passed.
        // A breach in either dimension marks the report as failed.
        const apiCallsOk     = exitCode === 0;
        const sloSlaOk        = sloResults.overall !== 'fail';
        const status: 'pass' | 'fail' = apiCallsOk && sloSlaOk ? 'pass' : 'fail';

        // Compute threshold/check aggregate counts for the report summary row
        const thresholdBreaches = (thresholdResults as any[]).filter((t: any) => !t.passed).length;
        const checksPassed      = (checkResults as any[]).filter((c: any) =>  c.passed).length;
        const checksFailed      = (checkResults as any[]).filter((c: any) => !c.passed).length;

        await prisma.execution.update({
          where: { id: executionId },
          data: {
            status,
            finishedAt:        new Date(),
            duration,
            metrics:           metrics ?? undefined,
            sloResults:        sloResults as any,
            thresholdBreaches,
            thresholdResults:  thresholdResults as any,
            checksPassed,
            checksFailed,
            checkResults:      checkResults as any,
          },
        }).catch(() => {});

        coralogix[status === 'pass' ? 'info' : 'warn']('k6_execution', {
          event:        'execution_complete',
          executionId,
          agentId,
          status,
          exitCode,
          durationSecs: duration,
          specName:     execution?.specName,
          ...(metrics as any ?? {}),
          sloOverall:   sloResults.overall,
        });

        if (execution?.specId) {
          await prisma.testSpec.update({
            where: { id: execution.specId },
            data: { lastRunStatus: status, lastRunAt: new Date() },
          }).catch(() => {});
        }

        sendStage('postgres', 'done');

        // Log: PostgreSQL save details
        const dbUrl   = process.env.DATABASE_URL ?? '';
        const dbHost  = dbUrl.replace(/^.*@/, '').replace(/\/.*$/, '') || 'localhost:5432';
        const dbName  = dbUrl.replace(/^.*\//, '').split('?')[0] || 'ptaas';
        sendLog(`[PerfOps] ─────────────────────────────────────────────`);
        sendLog(`[PerfOps] ✓ Results saved to PostgreSQL`);
        sendLog(`[PerfOps]   → Host:     ${dbHost}  |  Database: ${dbName}`);
        sendLog(`[PerfOps]   → Exec ID:  ${executionId}`);
        sendLog(`[PerfOps]   → Status:   ${status.toUpperCase()}  |  Duration: ${duration ?? '?'}s  |  Exit code: ${exitCode}`);
        if (metrics) {
          const m = metrics as any;
          sendLog(`[PerfOps]   → p50: ${m.p50 ?? '-'}ms  p95: ${m.p95 ?? '-'}ms  p99: ${m.p99 ?? '-'}ms`);
          sendLog(`[PerfOps]   → RPS: ${m.rps ?? '-'}  |  Error rate: ${m.errorRate != null ? (m.errorRate * 100).toFixed(2) + '%' : '-'}  |  Max VUs: ${m.maxVUs ?? '-'}`);
        }

        // Log SLO results
        if (sloResults.overall !== 'none') {
          sendLog(`[PerfOps] ─────────────────────────────────────────────`);
          const icon = sloResults.overall === 'pass' ? '✓' : '✗';
          sendLog(`[PerfOps] ${icon} SLO/SLA Compliance: ${sloResults.overall.toUpperCase()} (${sloResults.results.filter(r => r.passed).length}/${sloResults.results.length} passed)`);
          for (const r of sloResults.results) {
            const op   = r.operator === 'lte' ? '≤' : '≥';
            const mark = r.passed ? '✓' : '✗';
            sendLog(`[PerfOps]   ${mark} [${r.type.toUpperCase()}] ${r.label}: ${r.actual ?? '?'}${r.unit} ${op} ${r.target}${r.unit}`);
          }
        }

        // Log threshold breach results (populated from k6 handleSummary data)
        if ((thresholdResults as any[]).length > 0) {
          sendLog(`[PerfOps] ─────────────────────────────────────────────`);
          const tPass = (thresholdResults as any[]).filter((t: any) =>  t.passed).length;
          const tTotal = (thresholdResults as any[]).length;
          const tIcon = thresholdBreaches === 0 ? '✓' : '✗';
          sendLog(`[PerfOps] ${tIcon} k6 Thresholds: ${tPass}/${tTotal} passed${thresholdBreaches > 0 ? ` — ${thresholdBreaches} BREACH${thresholdBreaches > 1 ? 'ES' : ''}` : ''}`);
          for (const t of thresholdResults as any[]) {
            const mark = t.passed ? '✓' : '✗';
            sendLog(`[PerfOps]   ${mark} ${t.metric}: ${t.condition}`);
          }
        }

        // Log check results (populated from k6 handleSummary data)
        if ((checkResults as any[]).length > 0) {
          sendLog(`[PerfOps] ─────────────────────────────────────────────`);
          sendLog(`[PerfOps] ${checksFailed === 0 ? '✓' : '✗'} k6 Checks: ${checksPassed}/${checksPassed + checksFailed} passed`);
          for (const c of checkResults as any[]) {
            const mark  = c.passed ? '✓' : '✗';
            const total = (c.passes ?? 0) + (c.fails ?? 0);
            const pct   = total > 0 ? `${((c.passes / total) * 100).toFixed(1)}%` : '—';
            sendLog(`[PerfOps]   ${mark} ${c.name}: ${c.passes ?? 0} pass / ${c.fails ?? 0} fail (${pct})`);
          }
        }

        // ── Auto-fix & retry ───────────────────────────────────────────────────
        // If this run was started with auto-fix enabled and it failed, ask Claude
        // to diagnose the failure (thresholds/checks/console output) and rewrite
        // the script, then redispatch the SAME executionId. Skip the rest of the
        // finalize flow below (InfluxDB push, notifications, 'complete' signal) —
        // from the frontend's point of view the job is still in progress.
        const autoFixRun = getAutoFixRun(executionId);
        if (status === 'fail' && autoFixRun && autoFixRun.attempt < autoFixRun.maxAttempts) {
          sendLog(`[PerfOps] ─────────────────────────────────────────────`);
          sendLog(`[PerfOps] ↻ Auto-fix: attempt ${autoFixRun.attempt}/${autoFixRun.maxAttempts} failed — asking Claude to analyze and fix the script…`);
          const bufferedLogs = (executionLogBuffers.get(executionId) ?? [])
            .filter((p: any) => p.type === 'log')
            .map((p: any) => p.data?.line ?? '')
            .join('\n');
          const fixResult = await attemptAutoFix(
            executionId,
            { exitCode, summary, thresholdResults, checkResults, consoleTail: bufferedLogs },
            (line) => sendLog(`[AutoFix] ${line}`),
          );
          if (fixResult.ok) {
            sendLog(`[PerfOps] ✓ Auto-fix applied — re-running script (attempt ${fixResult.nextAttempt}/${autoFixRun.maxAttempts})…`);
            sendToExecution(executionId, { type: 'retry', timestamp: Date.now(), data: { attempt: fixResult.nextAttempt, maxAttempts: autoFixRun.maxAttempts } });
            agentRegistry.setStatus(agentId, 'online');
            await prisma.agent.update({ where: { id: agentId }, data: { status: 'online' } }).catch(() => {});
            break;
          }
          sendLog(`[PerfOps] ⚠ Auto-fix could not be applied (${fixResult.reason}) — reporting final result.`);
          clearAutoFixRun(executionId);
        } else if (autoFixRun) {
          clearAutoFixRun(executionId);
        }

        // ── 2. Push to InfluxDB ────────────────────────────────────────────────
        const finishedExecution = await prisma.execution
          .findUnique({ where: { id: executionId } })
          .catch(() => null);

        if (finishedExecution) {
          const influxResult = await pushExecutionMetrics(finishedExecution).catch((err: Error) => ({
            skipped: false, url: process.env.INFLUXDB_URL ?? '',
            org: process.env.INFLUXDB_ORG ?? '', bucket: process.env.INFLUXDB_BUCKET ?? '',
            pointsWritten: 0, error: err.message,
          }));

          sendLog(`[PerfOps] ─────────────────────────────────────────────`);
          if (influxResult.skipped) {
            sendLog(`[PerfOps] ⚠ InfluxDB not configured — metrics not pushed`);
            sendLog(`[PerfOps]   → Set INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG, INFLUXDB_BUCKET in backend/.env`);
            sendStage('influx', 'skipped');
            sendStage('grafana', 'skipped');
          } else if (influxResult.error) {
            sendLog(`[PerfOps] ✗ InfluxDB push failed: ${influxResult.error}`);
            sendLog(`[PerfOps]   → URL: ${influxResult.url}  |  Org: ${influxResult.org}  |  Bucket: ${influxResult.bucket}`);
            coralogix.error('influxdb', { event: 'influxdb_push_failed', executionId, error: influxResult.error, url: influxResult.url });
            sendStage('influx', 'error');
            sendStage('grafana', 'error');
          } else {
            sendLog(`[PerfOps] ✓ Metrics pushed to InfluxDB`);
            sendLog(`[PerfOps]   → URL:    ${influxResult.url}`);
            sendLog(`[PerfOps]   → Org:    ${influxResult.org}  |  Bucket: ${influxResult.bucket}`);
            sendLog(`[PerfOps]   → Points: ${influxResult.pointsWritten} written  (k6_execution + k6_thresholds)`);
            coralogix.info('influxdb', { event: 'influxdb_push_ok', executionId, pointsWritten: influxResult.pointsWritten });
            sendStage('influx', 'done');
            // Grafana reads live from InfluxDB — once the points land, the
            // dashboards are up to date, so mark this stage complete too.
            sendStage('grafana', 'done');
          }
        } else {
          sendStage('influx', 'error');
          sendStage('grafana', 'error');
        }

        sendLog(`[PerfOps] ─────────────────────────────────────────────`);

        // Dispatch notifications for completed execution (includes full metrics for report email)
        if (finishedExecution) {
          const { notificationService } = await import('./services/notificationService');
          const execMetrics = finishedExecution.metrics as any;
          notificationService.dispatchForExecution({
            id: finishedExecution.id,
            specName: finishedExecution.specName,
            environment: finishedExecution.environment,
            status: finishedExecution.status,
            triggeredBy: finishedExecution.triggeredBy,
            completedAt: finishedExecution.finishedAt?.toISOString(),
            duration: finishedExecution.duration,
            metrics: execMetrics ? {
              p50:           execMetrics.p50,
              p90:           execMetrics.p90,
              p95:           execMetrics.p95,
              p99:           execMetrics.p99,
              avg:           execMetrics.avg,
              rps:           execMetrics.rps,
              errorRate:     execMetrics.errorRate,
              totalRequests: execMetrics.totalRequests,
              maxVUs:        execMetrics.maxVUs,
            } : null,
          }).catch((err: Error) => console.warn('[Notifications] dispatch error:', err.message));
        }

        // ── 3. Signal completion to frontend ──────────────────────────────────
        sendToExecution(executionId, {
          type: 'complete',
          timestamp: Date.now(),
          data: { exitCode, summary },
        });
        scheduleExecutionBufferCleanup(executionId);

        agentRegistry.setStatus(agentId, 'online');
        await prisma.agent.update({ where: { id: agentId }, data: { status: 'online' } }).catch(() => {});
        // Credentials CSV cache (if any) is only needed for the duration of the
        // run — drop it now that the execution has reached a terminal state.
        await prisma.executionCredential.deleteMany({ where: { executionId } }).catch(() => {});
        break;
      }

      case 'job_error': {
        const { executionId, message } = payload;

        const autoFixRun = getAutoFixRun(executionId);
        if (autoFixRun && autoFixRun.attempt < autoFixRun.maxAttempts) {
          sendToExecution(executionId, { type: 'log', timestamp: Date.now(), data: { line: `[PerfOps] ✗ Execution error (attempt ${autoFixRun.attempt}/${autoFixRun.maxAttempts}): ${message}` } });
          sendToExecution(executionId, { type: 'log', timestamp: Date.now(), data: { line: `[PerfOps] ↻ Auto-fix: asking Claude to analyze and fix the script…` } });
          const bufferedLogs = (executionLogBuffers.get(executionId) ?? [])
            .filter((p: any) => p.type === 'log')
            .map((p: any) => p.data?.line ?? '')
            .join('\n');
          const fixResult = await attemptAutoFix(
            executionId,
            { message, consoleTail: bufferedLogs },
            (line) => sendToExecution(executionId, { type: 'log', timestamp: Date.now(), data: { line: `[AutoFix] ${line}` } }),
          );
          if (fixResult.ok) {
            sendToExecution(executionId, { type: 'log', timestamp: Date.now(), data: { line: `[PerfOps] ✓ Auto-fix applied — re-running script (attempt ${fixResult.nextAttempt}/${autoFixRun.maxAttempts})…` } });
            sendToExecution(executionId, { type: 'retry', timestamp: Date.now(), data: { attempt: fixResult.nextAttempt, maxAttempts: autoFixRun.maxAttempts } });
            agentRegistry.setStatus(agentId, 'online');
            await prisma.agent.update({ where: { id: agentId }, data: { status: 'online' } }).catch(() => {});
            break;
          }
          sendToExecution(executionId, { type: 'log', timestamp: Date.now(), data: { line: `[PerfOps] ⚠ Auto-fix could not be applied: ${fixResult.reason}` } });
          clearAutoFixRun(executionId);
        } else if (autoFixRun) {
          clearAutoFixRun(executionId);
        }

        sendToExecution(executionId, {
          type: 'error',
          timestamp: Date.now(),
          data: { message },
        });
        scheduleExecutionBufferCleanup(executionId);
        await prisma.execution.update({
          where: { id: executionId },
          data: { status: 'fail', finishedAt: new Date() },
        }).catch(() => {});
        coralogix.error('k6_execution', { event: 'execution_error', executionId, agentId, message });
        agentRegistry.setStatus(agentId, 'online');
        await prisma.agent.update({ where: { id: agentId }, data: { status: 'online' } }).catch(() => {});
        await prisma.executionCredential.deleteMany({ where: { executionId } }).catch(() => {});
        break;
      }
    }
  });

  ws.on('close', async () => {
    agentRegistry.unregister(agentId);
    await prisma.agent.update({
      where: { id: agentId },
      data: { status: 'offline' },
    }).catch(() => {});
    console.log(`[Agent] ${agentRecord.name} (${agentId}) disconnected`);
    coralogix.info('agent', { event: 'agent_disconnected', agentId, agentName: agentRecord.name });
  });
});

function extractMetrics(summary: any): object | null {
  try {
    const d = summary?.metrics?.http_req_duration?.values;
    if (!d) return null;
    return {
      p50: d['p(50)'] ?? null,
      p90: d['p(90)'] ?? null,
      p95: d['p(95)'] ?? null,
      p99: d['p(99)'] ?? null,
      avg: d.avg ?? null,
      rps: summary?.metrics?.http_reqs?.values?.rate ?? null,
      errorRate: summary?.metrics?.http_req_failed?.values?.rate ?? null,
      maxVUs: summary?.metrics?.vus_max?.values?.max ?? null,
      totalRequests: summary?.metrics?.http_reqs?.values?.count ?? null,
    };
  } catch {
    return null;
  }
}

schedulerService.init();

server.listen(PORT, () => {
  console.log(`PerfOps backend running on http://localhost:${PORT}`);

  // Auto-verify InfluxDB/Grafana connectivity on every dev startup.
  // If either service is down, self-heal attempts to start the Windows
  // service and polls until healthy (up to 60 s each), then re-checks.
  (async () => {
    try {
      const initial = await testConnections();
      const needsHeal = !initial.influxdb.connected || !initial.grafana.connected;

      if (!needsHeal) {
        console.log(`[InfluxDB] ✓ Connected${initial.influxdb.latencyMs != null ? ` (${initial.influxdb.latencyMs}ms)` : ''}`);
        console.log(`[Grafana]  ✓ Connected${initial.grafana.latencyMs != null ? ` (${initial.grafana.latencyMs}ms)` : ''}`);
        return;
      }

      // Log which services are down before attempting heal
      if (!initial.influxdb.connected) {
        console.warn(`[InfluxDB] ✗ ${initial.influxdb.message} — starting self-heal...`);
      }
      if (!initial.grafana.connected) {
        console.warn(`[Grafana]  ✗ ${initial.grafana.message} — starting self-heal...`);
      }

      await selfHealConnections();

      // Final check after heal
      const after = await testConnections();
      console.log(`[InfluxDB] ${after.influxdb.connected ? '✓ Connected' : '✗ ' + after.influxdb.message}${after.influxdb.latencyMs != null ? ` (${after.influxdb.latencyMs}ms)` : ''}`);
      console.log(`[Grafana]  ${after.grafana.connected  ? '✓ Connected' : '✗ ' + after.grafana.message}${after.grafana.latencyMs  != null ? ` (${after.grafana.latencyMs}ms)` : ''}`);
    } catch (err: any) {
      console.error('[Startup] Connectivity check failed:', err.message);
    }
  })();
});

// Graceful shutdown — prevents EADDRINUSE on restart
function shutdown() {
  server.close(() => {
    prisma.$disconnect().then(() => process.exit(0));
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

// Last-resort net for rejections outside the Express request cycle (e.g. a
// fire-and-forget async call with no .catch()) - logs instead of crashing
// the whole server, mirroring the error-handling middleware above.
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled rejection]', reason);
});

export default app;
