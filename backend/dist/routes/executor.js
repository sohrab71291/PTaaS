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
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const XLSX = __importStar(require("xlsx"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const jobDispatcher_1 = require("../services/jobDispatcher");
const autoFixRunner_1 = require("../services/autoFixRunner");
const agentRegistry_1 = require("../services/agentRegistry");
const k6PromptBlocks_1 = require("../services/k6PromptBlocks");
const scriptSource_1 = require("../services/scriptSource");
const anthropicClient_1 = require("../services/anthropicClient");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const uploadCsv = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ext = '.' + file.originalname.split('.').pop()?.toLowerCase();
        if (['.csv', '.xls', '.xlsx'].includes(ext))
            cb(null, true);
        else
            cb(new Error(`Unsupported file type: ${ext}. Allowed: .csv, .xls, .xlsx`));
    },
});
function resolveColumn(row, ...keys) {
    const normalized = {};
    for (const [k, v] of Object.entries(row))
        normalized[k.trim().toLowerCase().replace(/\s+/g, '_')] = v;
    for (const key of keys) {
        const v = normalized[key];
        if (v !== undefined && v !== '')
            return String(v);
    }
    return undefined;
}
// POST /api/executor/credentials — uploads a CSV of per-VU login credentials
// (columns: URL, Username, Password, InstanceName) ahead of an Executor run.
// Rows are cached in Postgres tagged with a fresh batchId; /executor/run
// re-tags them with the real executionId once the run starts, and they're
// deleted once the run reaches a terminal state (see job_complete/job_error
// in index.ts).
router.post('/executor/credentials', uploadCsv.single('file'), async (req, res) => {
    if (!req.file) {
        res.status(400).json({ error: 'No file uploaded. Use multipart/form-data with field name "file".' });
        return;
    }
    try {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        if (rows.length === 0) {
            res.status(422).json({ error: 'File is empty or has no data rows' });
            return;
        }
        const batchId = `cred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const data = [];
        const warnings = [];
        rows.forEach((row, i) => {
            const loginUrl = resolveColumn(row, 'url', 'loginurl', 'loginapi', 'login_url', 'login_api', 'api');
            const username = resolveColumn(row, 'username', 'user', 'login', 'email');
            const password = resolveColumn(row, 'password', 'pass', 'pwd');
            // Required by the login API — Archer IRM throws ArgumentNullException:
            // request.Credentials.InstanceName if this is missing/null, so a row
            // without it can never authenticate. Skip it like the other required columns.
            const instanceName = resolveColumn(row, 'instancename', 'instance_name', 'instance');
            if (!loginUrl || !username || !password || !instanceName) {
                warnings.push(`Row ${i + 1}: missing URL/Username/Password/InstanceName — skipped`);
                return;
            }
            data.push({ batchId, executionId: null, loginUrl, username, password, instanceName, rowIndex: i });
        });
        if (data.length === 0) {
            res.status(422).json({ error: 'No valid credential rows found. Expected columns (all required): URL, Username, Password, InstanceName.', warnings });
            return;
        }
        await prisma_1.default.executionCredential.createMany({ data });
        res.json({ batchId, count: data.length, warnings });
    }
    catch (err) {
        res.status(500).json({ error: err.message || 'Failed to process credentials file' });
    }
});
router.post('/executor/run', upload.single('script'), async (req, res) => {
    try {
        const { vus, duration, stages, profileType, envVars, testName, slos, credentialBatchId, autoFix, maxAttempts, specId } = req.body;
        let script;
        if (req.file) {
            script = req.file.buffer.toString('utf8');
        }
        else if (req.body.script) {
            script = req.body.script;
        }
        else {
            res.status(400).json({ error: 'No script provided' });
            return;
        }
        // A saved test suite's script is never trusted from the client (locally
        // cached/edited copy, session storage, DB snapshot) — the repo is the
        // source of truth, so pull the current file fresh right before dispatch.
        // Ad-hoc runs (paste/upload with no specId) are unaffected.
        let spec = null;
        if (typeof specId === 'string' && specId.trim()) {
            spec = await prisma_1.default.testSpec.findUnique({ where: { id: specId.trim() }, select: { id: true, name: true } });
            if (!spec) {
                res.status(404).json({ error: 'Test suite not found' });
                return;
            }
            try {
                script = await (0, scriptSource_1.fetchLatestScript)(spec.name);
            }
            catch (err) {
                res.status(502).json({ error: `Failed to fetch script from repo for "${spec.name}": ${err.message}` });
                return;
            }
        }
        let parsedSlos = [];
        try {
            parsedSlos = slos ? (typeof slos === 'string' ? JSON.parse(slos) : slos) : [];
        }
        catch { }
        const execution = await prisma_1.default.execution.create({
            data: {
                specId: spec?.id,
                specName: spec?.name || ((typeof testName === 'string' && testName.trim()) ? testName.trim() : 'Ad-hoc Execution'),
                environment: 'custom',
                status: 'queued',
                triggeredBy: req.user?.email ?? 'executor',
                thresholdBreaches: 0,
                checksPassed: 0,
                checksFailed: 0,
                thresholdResults: [],
                checkResults: [],
                responseTimeSeries: [],
                slos: parsedSlos,
            },
        });
        // If a credentials CSV was uploaded for this run, re-tag those cached rows
        // with the real executionId (for audit/cleanup) and splice them into the
        // script's CREDENTIALS placeholder before dispatch.
        if (typeof credentialBatchId === 'string' && credentialBatchId.trim()) {
            const rows = await prisma_1.default.executionCredential.findMany({
                where: { batchId: credentialBatchId.trim() },
                orderBy: { rowIndex: 'asc' },
            });
            if (rows.length > 0) {
                await prisma_1.default.executionCredential.updateMany({
                    where: { batchId: credentialBatchId.trim() },
                    data: { executionId: execution.id },
                });
                const credentials = rows.map(r => ({
                    loginUrl: r.loginUrl, username: r.username, password: r.password, instanceName: r.instanceName ?? '',
                }));
                script = (0, k6PromptBlocks_1.injectCredentials)(script, credentials);
            }
        }
        const config = {
            vus: vus ? parseInt(vus) : 10,
            duration: duration || '1m',
            stages: stages ? (typeof stages === 'string' ? JSON.parse(stages) : stages) : null,
            profileType: profileType || 'staged',
            envVars: envVars ? (typeof envVars === 'string' ? JSON.parse(envVars) : envVars) : {},
        };
        let dispatchedAgentId;
        try {
            dispatchedAgentId = await (0, jobDispatcher_1.dispatchJob)(execution.id, script, config);
        }
        catch (err) {
            return res.status(503).json({ error: err.message, executionId: execution.id });
        }
        // Auto-fix & retry: on failure, the executor's job_complete/job_error
        // handler in index.ts will ask Claude to diagnose + rewrite this script
        // and redispatch under the same executionId, up to maxAttempts total runs.
        const autoFixEnabled = autoFix === true || autoFix === 'true';
        if (autoFixEnabled) {
            const parsedMaxAttempts = Math.min(Math.max(parseInt(maxAttempts, 10) || 3, 2), 5);
            (0, autoFixRunner_1.registerAutoFixRun)(execution.id, { script, config, maxAttempts: parsedMaxAttempts, agentId: dispatchedAgentId });
        }
        res.json({ executionId: execution.id, wsUrl: `/ws/executor/${execution.id}` });
    }
    catch (err) {
        console.error('[executor/run] unhandled error:', err);
        res.status(500).json({ error: err.message ?? 'Internal server error' });
    }
});
router.post('/executor/stop/:executionId', async (req, res) => {
    const exec = await prisma_1.default.execution.findUnique({ where: { id: req.params.executionId } });
    if (!exec || !exec.agentId) {
        res.status(404).json({ error: 'Execution not found or not running' });
        return;
    }
    const dispatched = agentRegistry_1.agentRegistry.dispatch(exec.agentId, {
        type: 'cancel_job',
        executionId: exec.id,
    });
    res.json({ stopped: dispatched });
});
// POST /api/executor/troubleshoot — streaming SSE endpoint. Given the script,
// console logs and/or summary from an execution plus free-text context from
// the user, asks Claude to diagnose the failure. Reuses the same SSE pattern
// as /api/ai-generate and /api/ai-refine for consistency.
const MAX_LOG_CHARS = 20000;
function buildTroubleshootSystemPrompt() {
    return `You are an expert performance engineer helping debug a k6 load test execution that failed or produced unexpected results. You are given the k6 script (if available), console/error output from the run, an execution summary (if available), and context from the user describing what they're seeing or trying to understand.

Diagnose the likely root cause(s) and suggest concrete fixes. Ground your answer in the specific evidence given — quote the exact error lines/messages you're reasoning from rather than speaking generically. If the provided information is insufficient to pinpoint the cause, say so and list the most likely candidates plus what additional info (logs, config) would help narrow it down.

Format your response as concise markdown: a short diagnosis, then a bulleted list of fixes/next steps. Do not restate the entire script or log back to the user.`;
}
router.post('/executor/troubleshoot', async (req, res) => {
    const { context, script, consoleLogs, summary } = req.body;
    if (!(0, anthropicClient_1.hasAnthropicCredentials)()) {
        res.status(500).json({
            error: 'Anthropic API credentials not configured. Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in backend/.env or as an environment variable.',
        });
        return;
    }
    if (!context?.trim() && !consoleLogs?.trim()) {
        res.status(400).json({ error: 'Provide either context describing the issue or console logs to analyze.' });
        return;
    }
    const truncatedLogs = consoleLogs && consoleLogs.length > MAX_LOG_CHARS
        ? `…(truncated, showing last ${MAX_LOG_CHARS} chars)…\n` + consoleLogs.slice(-MAX_LOG_CHARS)
        : consoleLogs;
    const userMessageParts = [
        context?.trim() ? `User-provided context:\n${context.trim()}` : `No specific context was provided by the user — diagnose from the logs/summary alone.`,
    ];
    if (summary)
        userMessageParts.push(`Execution summary:\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\``);
    if (truncatedLogs?.trim())
        userMessageParts.push(`Console/error output:\n\`\`\`\n${truncatedLogs}\n\`\`\``);
    if (script?.trim())
        userMessageParts.push(`k6 script that was run:\n\`\`\`javascript\n${script}\n\`\`\``);
    userMessageParts.push('Diagnose the issue and suggest fixes, per the instructions.');
    const userMessage = userMessageParts.join('\n\n');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const sendEvent = (type, data) => {
        res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };
    try {
        sendEvent('status', { message: 'Analyzing execution with Claude…' });
        let stream = null;
        for (let attempt = 0; attempt < anthropicClient_1.MAX_STREAM_ATTEMPTS; attempt++) {
            try {
                stream = await (0, anthropicClient_1.getAnthropicClient)().messages.stream({
                    model: anthropicClient_1.CLAUDE_MODEL,
                    max_tokens: 4000,
                    system: buildTroubleshootSystemPrompt(),
                    messages: [{ role: 'user', content: userMessage }],
                });
                break;
            }
            catch (err) {
                if ((0, anthropicClient_1.isOverloadedError)(err) && attempt < anthropicClient_1.MAX_STREAM_ATTEMPTS - 1) {
                    sendEvent('status', { message: `Claude is currently overloaded — retrying (${attempt + 1}/${anthropicClient_1.MAX_STREAM_ATTEMPTS - 1})…` });
                    await new Promise(r => setTimeout(r, anthropicClient_1.STREAM_BACKOFF_MS[attempt]));
                    continue;
                }
                throw err;
            }
        }
        if (!stream)
            throw new Error('Failed to start troubleshooting after retries');
        let fullText = '';
        for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                const text = chunk.delta.text;
                fullText += text;
                sendEvent('chunk', { text });
            }
        }
        sendEvent('complete', { message: fullText });
        res.end();
    }
    catch (err) {
        if (err.name === 'AbortError') {
            res.end();
            return;
        }
        if (err.status === 401) {
            sendEvent('error', { message: 'Invalid Anthropic API key. Check your ANTHROPIC_API_KEY.' });
        }
        else if (err.status === 429) {
            sendEvent('error', { message: 'Rate limit reached. Please wait a moment and try again.' });
        }
        else if ((0, anthropicClient_1.isOverloadedError)(err)) {
            sendEvent('error', { message: "Claude's servers are overloaded right now. We retried a few times but it didn't recover — please try again in a minute." });
        }
        else {
            sendEvent('error', { message: err.message || 'Troubleshooting request failed' });
        }
        res.end();
    }
});
exports.default = router;
