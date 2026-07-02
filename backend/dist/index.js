"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.frontendClients = void 0;
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
dotenv.config({ path: path.join(__dirname, '../.env'), override: true });
const http_1 = __importDefault(require("http"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const ws_1 = require("ws");
const url_1 = require("url");
const auth_1 = require("./middleware/auth");
const slo_1 = require("./lib/slo");
const auth_2 = __importDefault(require("./routes/auth"));
const agents_1 = __importDefault(require("./routes/agents"));
const dashboard_1 = __importDefault(require("./routes/dashboard"));
const testSpecs_1 = __importDefault(require("./routes/testSpecs"));
const executions_1 = __importDefault(require("./routes/executions"));
const environments_1 = __importDefault(require("./routes/environments"));
const secrets_1 = __importDefault(require("./routes/secrets"));
const reports_1 = __importDefault(require("./routes/reports"));
const upload_1 = __importDefault(require("./routes/upload"));
const executor_1 = __importDefault(require("./routes/executor"));
const aiGenerate_1 = __importDefault(require("./routes/aiGenerate"));
const agentRegistry_1 = require("./services/agentRegistry");
const influxdb_1 = require("./services/influxdb");
const config_1 = __importDefault(require("./routes/config"));
const grafanaProxy_1 = __importDefault(require("./routes/grafanaProxy"));
const users_1 = __importDefault(require("./routes/users"));
const schedules_1 = __importDefault(require("./routes/schedules"));
const notifications_1 = __importDefault(require("./routes/notifications"));
const schedulerService_1 = require("./services/schedulerService");
const prisma_1 = __importDefault(require("./lib/prisma"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '5mb' }));
// Public routes (no JWT required)
app.use('/api/auth', auth_2.default);
app.use('/api', agents_1.default); // POST /agents/register is public; GET /agents checks auth internally
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '1.0.0' });
});
app.use('/api/config', config_1.default); // public — exposes Grafana URL for frontend embedding
app.use('/api', grafanaProxy_1.default); // public — proxies Grafana dashboard, strips X-Frame-Options
// Serve built frontend (production mode)
const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express_1.default.static(frontendDist));
// All remaining routes require JWT
app.use(auth_1.requireAuth);
app.use('/api/dashboard', dashboard_1.default);
app.use('/api/test-specs', testSpecs_1.default);
app.use('/api/executions', executions_1.default);
app.use('/api/environments', environments_1.default);
app.use('/api/secrets', secrets_1.default);
app.use('/api/reports', reports_1.default);
app.use('/api', upload_1.default);
app.use('/api', executor_1.default);
app.use('/api', aiGenerate_1.default);
app.use('/api/users', users_1.default);
app.use('/api/schedules', schedules_1.default);
app.use('/api/notifications', notifications_1.default);
// Map of frontend WebSocket clients waiting for execution results
// key: executionId, value: WebSocket
exports.frontendClients = new Map();
// Rolling metrics accumulated from job_update events — used as fallback
// when the agent sends summary:null in job_complete
const rollingMetrics = new Map();
const server = http_1.default.createServer(app);
// Two separate WS servers — one for browser clients, one for agents
const executorWss = new ws_1.WebSocketServer({ noServer: true });
const agentWss = new ws_1.WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    if (url.startsWith('/ws/executor/')) {
        executorWss.handleUpgrade(req, socket, head, ws => {
            executorWss.emit('connection', ws, req);
        });
    }
    else if (url.startsWith('/ws/agent/')) {
        agentWss.handleUpgrade(req, socket, head, ws => {
            agentWss.emit('connection', ws, req);
        });
    }
    else {
        socket.destroy();
    }
});
// ── Frontend executor WebSocket (/ws/executor/:executionId) ──────────────────
executorWss.on('connection', async (ws, req) => {
    const executionId = req.url?.split('/').filter(Boolean).pop();
    if (!executionId) {
        ws.close();
        return;
    }
    // Validate execution exists
    const exec = await prisma_1.default.execution.findUnique({ where: { id: executionId } }).catch(() => null);
    if (!exec) {
        ws.send(JSON.stringify({ type: 'error', timestamp: Date.now(), data: { message: 'Execution not found' } }));
        ws.close();
        return;
    }
    // Race condition guard: if the job already finished before the WS connected, replay the final state
    if (exec.status === 'pass' || exec.status === 'fail' || exec.status === 'complete') {
        ws.send(JSON.stringify({
            type: 'complete',
            timestamp: Date.now(),
            data: { exitCode: exec.status === 'pass' ? 0 : 1, summary: null },
        }));
        ws.close();
        return;
    }
    if (exec.status === 'failed') {
        ws.send(JSON.stringify({
            type: 'error',
            timestamp: Date.now(),
            data: { message: 'Execution failed before connection was established' },
        }));
        ws.close();
        return;
    }
    exports.frontendClients.set(executionId, ws);
    ws.on('message', async (msg) => {
        try {
            const { action } = JSON.parse(msg.toString());
            if (action === 'stop') {
                // Find which agent is running this execution and forward cancel
                const execution = await prisma_1.default.execution.findUnique({ where: { id: executionId } });
                if (execution?.agentId) {
                    agentRegistry_1.agentRegistry.dispatch(execution.agentId, { type: 'cancel_job', executionId });
                }
            }
        }
        catch { }
    });
    ws.on('close', () => {
        exports.frontendClients.delete(executionId);
    });
});
// ── Agent WebSocket (/ws/agent/:agentId) ────────────────────────────────────
agentWss.on('connection', async (ws, req) => {
    const urlPath = req.url ?? '';
    const agentId = urlPath.split('/').filter(Boolean).pop()?.split('?')[0];
    if (!agentId) {
        ws.close();
        return;
    }
    // Authenticate via apiKey query param
    const parsedUrl = new url_1.URL(urlPath, 'http://localhost');
    const apiKey = parsedUrl.searchParams.get('apiKey');
    const agentRecord = await prisma_1.default.agent.findUnique({ where: { id: agentId } }).catch(() => null);
    if (!agentRecord || agentRecord.apiKey !== apiKey) {
        ws.close(1008, 'Unauthorized');
        return;
    }
    // Register agent
    agentRegistry_1.agentRegistry.register(agentId, ws);
    await prisma_1.default.agent.update({
        where: { id: agentId },
        data: { status: 'online', lastSeen: new Date() },
    }).catch(() => { });
    console.log(`[Agent] ${agentRecord.name} (${agentId}) connected`);
    ws.on('message', async (msg) => {
        let payload;
        try {
            payload = JSON.parse(msg.toString());
        }
        catch {
            return;
        }
        switch (payload.type) {
            case 'register':
                await prisma_1.default.agent.update({
                    where: { id: agentId },
                    data: {
                        hostname: payload.hostname ?? null,
                        k6Version: payload.k6Version ?? null,
                        lastSeen: new Date(),
                    },
                }).catch(() => { });
                break;
            case 'heartbeat':
                agentRegistry_1.agentRegistry.updateLastSeen(agentId);
                await prisma_1.default.agent.update({
                    where: { id: agentId },
                    data: { lastSeen: new Date() },
                }).catch(() => { });
                break;
            case 'job_accepted':
                // Agent confirmed receipt — nothing extra needed
                break;
            case 'job_update': {
                const clientWs = exports.frontendClients.get(payload.executionId);
                if (clientWs?.readyState === ws_1.WebSocket.OPEN) {
                    clientWs.send(JSON.stringify(payload.update));
                }
                // Accumulate rolling metrics from the live stream
                if (payload.update?.type === 'metric' && payload.update.data) {
                    const d = payload.update.data;
                    const cur = rollingMetrics.get(payload.executionId) ?? {
                        p50: 0, p90: 0, p95: 0, p99: 0, avg: 0,
                        rps: 0, errorRate: 0, vus: 0, totalRequests: 0, maxVUs: 0,
                    };
                    if (d.p50 != null)
                        cur.p50 = d.p50;
                    if (d.p95 != null)
                        cur.p95 = d.p95;
                    if (d.avg != null)
                        cur.avg = d.avg;
                    if (d.rps != null)
                        cur.rps = d.rps;
                    if (d.totalRequests != null)
                        cur.totalRequests = d.totalRequests; // exact count from JSON stream
                    if (d.errorRate != null)
                        cur.errorRate = d.errorRate;
                    if (d.vus != null) {
                        cur.vus = d.vus;
                        cur.maxVUs = Math.max(cur.maxVUs, d.vus);
                    }
                    rollingMetrics.set(payload.executionId, cur);
                }
                break;
            }
            case 'job_complete': {
                const { executionId, exitCode, summary } = payload;
                const clientWs = exports.frontendClients.get(executionId);
                // Helper: send a log line to the executor console
                const sendLog = (text) => {
                    if (clientWs?.readyState === ws_1.WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({ type: 'log', timestamp: Date.now(), data: { line: text } }));
                    }
                };
                // ── 1. Persist to PostgreSQL ───────────────────────────────────────────
                // Prefer k6 end-of-test summary; fall back to rolling metrics accumulated
                // from job_update events (agent sends summary:null when using --out json mode)
                const rolling = rollingMetrics.get(executionId);
                const metrics = summary ? extractMetrics(summary) : (rolling ? {
                    p50: rolling.p50,
                    p90: rolling.p90,
                    p95: rolling.p95,
                    p99: rolling.p99 || null,
                    avg: rolling.avg,
                    rps: rolling.rps,
                    errorRate: rolling.errorRate,
                    maxVUs: rolling.maxVUs,
                    totalRequests: rolling.totalRequests,
                } : null);
                rollingMetrics.delete(executionId);
                const status = exitCode === 0 ? 'pass' : 'fail';
                const execution = await prisma_1.default.execution.findUnique({ where: { id: executionId } }).catch(() => null);
                const duration = execution?.startedAt
                    ? Math.round((Date.now() - execution.startedAt.getTime()) / 1000)
                    : null;
                // Evaluate SLOs against final metrics
                const slosDefs = Array.isArray(execution?.slos) ? execution.slos : [];
                const sloResults = (0, slo_1.evaluateSlos)(slosDefs, metrics);
                await prisma_1.default.execution.update({
                    where: { id: executionId },
                    data: { status, finishedAt: new Date(), duration, metrics: metrics ?? undefined, sloResults: sloResults },
                }).catch(() => { });
                if (execution?.specId) {
                    await prisma_1.default.testSpec.update({
                        where: { id: execution.specId },
                        data: { lastRunStatus: status, lastRunAt: new Date() },
                    }).catch(() => { });
                }
                // Log: PostgreSQL save details
                const dbUrl = process.env.DATABASE_URL ?? '';
                const dbHost = dbUrl.replace(/^.*@/, '').replace(/\/.*$/, '') || 'localhost:5432';
                const dbName = dbUrl.replace(/^.*\//, '').split('?')[0] || 'ptaas';
                sendLog(`[PerfOps] ─────────────────────────────────────────────`);
                sendLog(`[PerfOps] ✓ Results saved to PostgreSQL`);
                sendLog(`[PerfOps]   → Host:     ${dbHost}  |  Database: ${dbName}`);
                sendLog(`[PerfOps]   → Exec ID:  ${executionId}`);
                sendLog(`[PerfOps]   → Status:   ${status.toUpperCase()}  |  Duration: ${duration ?? '?'}s  |  Exit code: ${exitCode}`);
                if (metrics) {
                    const m = metrics;
                    sendLog(`[PerfOps]   → p50: ${m.p50 ?? '-'}ms  p95: ${m.p95 ?? '-'}ms  p99: ${m.p99 ?? '-'}ms`);
                    sendLog(`[PerfOps]   → RPS: ${m.rps ?? '-'}  |  Error rate: ${m.errorRate != null ? (m.errorRate * 100).toFixed(2) + '%' : '-'}  |  Max VUs: ${m.maxVUs ?? '-'}`);
                }
                // Log SLO results
                if (sloResults.overall !== 'none') {
                    sendLog(`[PerfOps] ─────────────────────────────────────────────`);
                    const icon = sloResults.overall === 'pass' ? '✓' : '✗';
                    sendLog(`[PerfOps] ${icon} SLO/SLA Compliance: ${sloResults.overall.toUpperCase()} (${sloResults.results.filter(r => r.passed).length}/${sloResults.results.length} passed)`);
                    for (const r of sloResults.results) {
                        const op = r.operator === 'lte' ? '≤' : '≥';
                        const mark = r.passed ? '✓' : '✗';
                        sendLog(`[PerfOps]   ${mark} [${r.type.toUpperCase()}] ${r.label}: ${r.actual ?? '?'}${r.unit} ${op} ${r.target}${r.unit}`);
                    }
                }
                // ── 2. Push to InfluxDB ────────────────────────────────────────────────
                const finishedExecution = await prisma_1.default.execution
                    .findUnique({ where: { id: executionId } })
                    .catch(() => null);
                if (finishedExecution) {
                    const influxResult = await (0, influxdb_1.pushExecutionMetrics)(finishedExecution).catch((err) => ({
                        skipped: false, url: process.env.INFLUXDB_URL ?? '',
                        org: process.env.INFLUXDB_ORG ?? '', bucket: process.env.INFLUXDB_BUCKET ?? '',
                        pointsWritten: 0, error: err.message,
                    }));
                    sendLog(`[PerfOps] ─────────────────────────────────────────────`);
                    if (influxResult.skipped) {
                        sendLog(`[PerfOps] ⚠ InfluxDB not configured — metrics not pushed`);
                        sendLog(`[PerfOps]   → Set INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG, INFLUXDB_BUCKET in backend/.env`);
                    }
                    else if (influxResult.error) {
                        sendLog(`[PerfOps] ✗ InfluxDB push failed: ${influxResult.error}`);
                        sendLog(`[PerfOps]   → URL: ${influxResult.url}  |  Org: ${influxResult.org}  |  Bucket: ${influxResult.bucket}`);
                    }
                    else {
                        sendLog(`[PerfOps] ✓ Metrics pushed to InfluxDB`);
                        sendLog(`[PerfOps]   → URL:    ${influxResult.url}`);
                        sendLog(`[PerfOps]   → Org:    ${influxResult.org}  |  Bucket: ${influxResult.bucket}`);
                        sendLog(`[PerfOps]   → Points: ${influxResult.pointsWritten} written  (k6_execution + k6_thresholds)`);
                    }
                }
                sendLog(`[PerfOps] ─────────────────────────────────────────────`);
                // Dispatch notifications for completed execution (includes full metrics for report email)
                if (finishedExecution) {
                    const { notificationService } = await Promise.resolve().then(() => __importStar(require('./services/notificationService')));
                    const execMetrics = finishedExecution.metrics;
                    notificationService.dispatchForExecution({
                        id: finishedExecution.id,
                        specName: finishedExecution.specName,
                        environment: finishedExecution.environment,
                        status: finishedExecution.status,
                        triggeredBy: finishedExecution.triggeredBy,
                        completedAt: finishedExecution.finishedAt?.toISOString(),
                        duration: finishedExecution.duration,
                        metrics: execMetrics ? {
                            p50: execMetrics.p50,
                            p90: execMetrics.p90,
                            p95: execMetrics.p95,
                            p99: execMetrics.p99,
                            avg: execMetrics.avg,
                            rps: execMetrics.rps,
                            errorRate: execMetrics.errorRate,
                            totalRequests: execMetrics.totalRequests,
                            maxVUs: execMetrics.maxVUs,
                        } : null,
                    }).catch((err) => console.warn('[Notifications] dispatch error:', err.message));
                }
                // ── 3. Signal completion to frontend ──────────────────────────────────
                if (clientWs?.readyState === ws_1.WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                        type: 'complete',
                        timestamp: Date.now(),
                        data: { exitCode, summary },
                    }));
                }
                agentRegistry_1.agentRegistry.setStatus(agentId, 'online');
                await prisma_1.default.agent.update({ where: { id: agentId }, data: { status: 'online' } }).catch(() => { });
                break;
            }
            case 'job_error': {
                const { executionId, message } = payload;
                const clientWs = exports.frontendClients.get(executionId);
                if (clientWs?.readyState === ws_1.WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                        type: 'error',
                        timestamp: Date.now(),
                        data: { message },
                    }));
                }
                await prisma_1.default.execution.update({
                    where: { id: executionId },
                    data: { status: 'fail', finishedAt: new Date() },
                }).catch(() => { });
                agentRegistry_1.agentRegistry.setStatus(agentId, 'online');
                await prisma_1.default.agent.update({ where: { id: agentId }, data: { status: 'online' } }).catch(() => { });
                break;
            }
        }
    });
    ws.on('close', async () => {
        agentRegistry_1.agentRegistry.unregister(agentId);
        await prisma_1.default.agent.update({
            where: { id: agentId },
            data: { status: 'offline' },
        }).catch(() => { });
        console.log(`[Agent] ${agentRecord.name} (${agentId}) disconnected`);
    });
});
function extractMetrics(summary) {
    try {
        const d = summary?.metrics?.http_req_duration?.values;
        if (!d)
            return null;
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
    }
    catch {
        return null;
    }
}
// SPA fallback — must be after all API routes
app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
});
const HOST = '0.0.0.0';
schedulerService_1.schedulerService.init();
server.listen(Number(PORT), HOST, () => {
    const ifaces = require('os').networkInterfaces();
    const lan = Object.values(ifaces)
        .flat()
        .find((i) => i.family === 'IPv4' && !i.internal);
    console.log(`PerfOps running on:`);
    console.log(`  Local:   http://localhost:${PORT}`);
    if (lan)
        console.log(`  Network: http://${lan.address}:${PORT}`);
});
// Graceful shutdown — prevents EADDRINUSE on restart
function shutdown() {
    server.close(() => {
        prisma_1.default.$disconnect().then(() => process.exit(0));
    });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
exports.default = app;
