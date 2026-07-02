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
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const multer_1 = __importDefault(require("multer"));
const XLSX = __importStar(require("xlsx"));
const path = __importStar(require("path"));
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
// Build client lazily so it always reads the env vars after dotenv has run
function getClient() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
    if (apiKey)
        return new sdk_1.default({ apiKey });
    if (authToken)
        return new sdk_1.default({ authToken });
    return new sdk_1.default({ apiKey: '' }); // will fail with clear auth error
}
// Parse uploaded file into readable text content
function parseFileToText(buffer, mimetype, originalname) {
    const ext = path.extname(originalname).toLowerCase();
    if (ext === '.csv' || ext === '.xls' || ext === '.xlsx') {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const results = [];
        workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
            results.push(`Sheet: ${sheetName}\n${JSON.stringify(data, null, 2)}`);
        });
        return results.join('\n\n');
    }
    if (ext === '.json') {
        try {
            const parsed = JSON.parse(buffer.toString('utf8'));
            return JSON.stringify(parsed, null, 2);
        }
        catch {
            return buffer.toString('utf8');
        }
    }
    // YAML, TXT, or any other text format
    return buffer.toString('utf8');
}
// Build the system prompt for K6 generation
function buildSystemPrompt(testType, complexity) {
    return `You are an expert performance engineer specializing in k6 load testing with InfluxDB v2 integration. Analyze the provided test case data and generate a complete, production-ready k6 JavaScript script.

Test Type: ${testType}
Complexity: ${complexity}

MANDATORY RULES — every rule must be followed exactly:
1. Output ONLY valid JavaScript — no markdown, no code fences, no explanation text.
2. Start with imports, end with handleSummary export.
3. Include the full InfluxDB v2 integration block shown below, word for word.
4. Use __ENV.BASE_URL (default 'http://localhost:3000') for all request base URLs.
5. All secrets and tokens use __ENV.VAR_NAME — never hardcoded values.
6. Every HTTP request is wrapped in a named group().
7. Every endpoint has its own Trend metric (e.g. loginTrend, createOrderTrend).
8. Every request has check() for status code AND response time.
9. Include sleep(1) between logical steps within an iteration.
10. Use options.scenarios with ramping-vus executor and explicit exec function names.
11. Set thresholds from test case data or sensible defaults (p(95)<800, rate<0.05).
12. SCENARIO_MAX_VUS must be computed with Math.max and ?? (not ||): const SCENARIO_MAX_VUS = Math.max(...Object.values(options.scenarios).flatMap(s => (s.stages||[]).map(st => st.target ?? 0)), 1);
13. Auth tokens: extract defensively — const token = (body.token ?? body.sessionToken ?? body.access_token ?? (body.data && body.data.token) ?? '');
14. All test data that must be unique per VU/iteration (names, emails, usernames) must embed __VU and __ITER: e.g. 'user_' + __VU + '_' + __ITER + '@example.com'.
15. Use ?? instead of || when the right-hand side is a fallback for null/undefined (stage.target ?? 0, not stage.target || 0).
16. handleSummary must output ONLY stdout — do NOT write any file (no summary.json).

════════════════════════════════════════════════════════════════
INFLUXDB INTEGRATION — EMBED THIS BLOCK EXACTLY IN EVERY SCRIPT
════════════════════════════════════════════════════════════════

After imports, declare env vars and metrics:

const TEST_ID = __ENV.TESTID || ('local-' + Date.now());
const RUN_ID = __ENV.RUN_ID || ('PerfOps-' + Date.now());
const NODE_NAME = __ENV.NODE_NAME || 'PerfOps';
const TEST_NAME = __ENV.TEST_NAME || '<derive from test cases>';
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const INFLUX_V2_URL = __ENV.INFLUX_V2_URL || 'http://localhost:8086';
const INFLUX_V2_ORG = __ENV.INFLUX_V2_ORG || '';
const INFLUX_V2_ORG_ID = __ENV.INFLUX_V2_ORG_ID || '';
const INFLUX_V2_BUCKET = __ENV.INFLUX_V2_BUCKET || 'PerfDB';
const INFLUX_V2_TOKEN = __ENV.INFLUX_V2_TOKEN || '';
const INFLUX_V2_AUTO_CREATE_BUCKET = (__ENV.INFLUX_V2_AUTO_CREATE_BUCKET || 'false').toLowerCase() === 'true';
const INFLUX_V2_ENABLED = !!(INFLUX_V2_ORG && INFLUX_V2_BUCKET && INFLUX_V2_TOKEN);

const k6HttpReqsTotal = new Counter('k6_http_reqs_total');
const k6HttpReqFailedTotal = new Counter('k6_http_req_failed_total');
const k6IterationsTotal = new Counter('k6_iterations_total');
const k6HttpReqDurationSeconds = new Trend('k6_http_req_duration_seconds');
const k6Vus = new Gauge('k6_vus');
const k6VusMax = new Gauge('k6_vus_max');
const k6DataSentBytesTotal = new Counter('k6_data_sent_bytes_total');
const k6DataReceivedBytesTotal = new Counter('k6_data_received_bytes_total');

Add these helper functions before setup():

function getByteLength(value) {
  if (value === null || value === undefined) return 0;
  return String(value).length;
}
function escapeTagValue(value) {
  return String(value)
    .replace(/\\\\/g, '\\\\\\\\')
    .replace(/,/g, '\\\\,')
    .replace(/ /g, '\\\\ ')
    .replace(/=/g, '\\\\=');
}
function normalizeTagText(value, maxLength) {
  if (value === null || value === undefined) return undefined;
  const s = String(value).replace(/\\s+/g, ' ').trim();
  if (!s) return undefined;
  return s.length > maxLength ? s.slice(0, maxLength) : s;
}
function buildInfluxTagSet(tags) {
  return Object.entries(tags)
    .filter(function(e) { return e[1] !== undefined && e[1] !== null; })
    .map(function(e) { return e[0] + '=' + escapeTagValue(e[1]); })
    .join(',');
}
function getErrorDetails(response, failed) {
  const responseCode = String(response.status);
  if (!failed) return { responseCode: responseCode };
  let errorMessage;
  try {
    const b = response.json();
    errorMessage = b && (b.message || b.error || b.title || b.detail);
  } catch(e) { errorMessage = undefined; }
  return {
    responseCode: responseCode,
    errorMessage: normalizeTagText(errorMessage || response.error || response.status_text || ('HTTP ' + response.status), 256),
  };
}
function getInfluxAuthHeaders() {
  return { Authorization: 'Token ' + INFLUX_V2_TOKEN, Accept: 'application/json' };
}
function ensureInfluxBucket() {
  if (!INFLUX_V2_ENABLED) return;
  let orgId = INFLUX_V2_ORG_ID;
  if (!orgId) {
    const r = http.get(INFLUX_V2_URL + '/api/v2/orgs', { headers: getInfluxAuthHeaders(), tags: { api: 'influx-v2-orgs', step: 'metrics-precheck', name: 'GET /api/v2/orgs' } });
    if (r.status < 200 || r.status >= 300) throw new Error('Cannot reach InfluxDB org "' + INFLUX_V2_ORG + '". HTTP ' + r.status + '. Set INFLUX_V2_ORG_ID to skip this lookup.');
    let body; try { body = r.json(); } catch(e) { throw new Error('InfluxDB org lookup returned non-JSON'); }
    const orgs = body.orgs || [];
    const found = orgs.find(function(o) { return String(o.name).toLowerCase() === String(INFLUX_V2_ORG).toLowerCase(); });
    if (!found) throw new Error('InfluxDB org "' + INFLUX_V2_ORG + '" not found. Set INFLUX_V2_ORG_ID to bypass lookup.');
    orgId = found.id;
  }
  const br = http.get(INFLUX_V2_URL + '/api/v2/buckets?orgID=' + encodeURIComponent(orgId) + '&name=' + encodeURIComponent(INFLUX_V2_BUCKET), { headers: getInfluxAuthHeaders(), tags: { api: 'influx-v2-buckets', step: 'metrics-precheck', name: 'GET /api/v2/buckets' } });
  let bucketExists = false;
  if (br.status === 404) { bucketExists = false; }
  else if (br.status >= 200 && br.status < 300) {
    let bb; try { bb = br.json(); } catch(e) { throw new Error('InfluxDB bucket lookup returned non-JSON'); }
    bucketExists = (bb.buckets || []).some(function(b) { return b.name === INFLUX_V2_BUCKET; });
  } else { throw new Error('Cannot verify bucket "' + INFLUX_V2_BUCKET + '". HTTP ' + br.status); }
  if (bucketExists) return;
  if (!INFLUX_V2_AUTO_CREATE_BUCKET) throw new Error('Bucket "' + INFLUX_V2_BUCKET + '" does not exist. Set INFLUX_V2_AUTO_CREATE_BUCKET=true to create it.');
  const cr = http.post(INFLUX_V2_URL + '/api/v2/buckets', JSON.stringify({ orgID: orgId, name: INFLUX_V2_BUCKET, retentionRules: [] }), { headers: { Authorization: 'Token ' + INFLUX_V2_TOKEN, Accept: 'application/json', 'Content-Type': 'application/json' }, tags: { api: 'influx-v2-buckets', step: 'metrics-precheck', name: 'POST /api/v2/buckets' } });
  if (cr.status !== 200 && cr.status !== 201) throw new Error('Failed to create bucket "' + INFLUX_V2_BUCKET + '". HTTP ' + cr.status);
}
function writeInfluxLines(lines) {
  if (!INFLUX_V2_ENABLED || lines.length === 0) return;
  http.post(
    INFLUX_V2_URL + '/api/v2/write?org=' + encodeURIComponent(INFLUX_V2_ORG) + '&bucket=' + encodeURIComponent(INFLUX_V2_BUCKET) + '&precision=ns',
    lines.join('\\n'),
    { headers: { Authorization: 'Token ' + INFLUX_V2_TOKEN, 'Content-Type': 'text/plain; charset=utf-8' }, tags: { api: 'influx-v2-write', step: 'metrics-publish', name: 'POST /api/v2/write' } }
  );
}
function buildMetricTagSet(t) {
  return 'testid=' + escapeTagValue(t.testid) + ',scenario=' + escapeTagValue(t.scenario) + ',api=' + escapeTagValue(t.api) + ',url=' + escapeTagValue(t.url) + ',status=' + escapeTagValue(t.status);
}
function recordCustomMetrics(response, scenario, apiTag, urlPath, sentBytes, requestName) {
  const failed = response.status >= 400 ? 1 : 0;
  const ts = String(Date.now()) + '000000';
  const mTags = { testid: TEST_ID, scenario: scenario, api: apiTag, url: urlPath, status: String(response.status) };
  const tagSet = buildMetricTagSet(mTags);
  const ed = getErrorDetails(response, failed);
  const refTags = buildInfluxTagSet({ requestName: requestName, samplerType: 'request', runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, result: failed ? 'fail' : 'pass', responseCode: ed.responseCode, errorMessage: ed.errorMessage });
  const txTags = buildInfluxTagSet({ requestName: requestName, samplerType: 'transaction', runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, result: failed ? 'fail' : 'pass', responseCode: ed.responseCode, errorMessage: ed.errorMessage });
  k6HttpReqsTotal.add(1, mTags);
  if (failed) k6HttpReqFailedTotal.add(1, mTags);
  k6HttpReqDurationSeconds.add(response.timings.duration / 1000, mTags);
  k6DataSentBytesTotal.add(sentBytes, mTags);
  k6DataReceivedBytesTotal.add(getByteLength(response.body), mTags);
  writeInfluxLines([
    'k6_http_reqs_total,' + tagSet + ' value=1i ' + ts,
    'k6_http_req_failed_total,' + tagSet + ' value=' + failed + 'i ' + ts,
    'k6_http_req_duration_seconds,' + tagSet + ' value=' + (response.timings.duration / 1000) + ' ' + ts,
    'k6_data_sent_bytes_total,' + tagSet + ' value=' + sentBytes + 'i ' + ts,
    'k6_data_received_bytes_total,' + tagSet + ' value=' + getByteLength(response.body) + 'i ' + ts,
    'requestsRaw,' + refTags + ' responseTime=' + response.timings.duration + ',errorCount=' + failed + 'i,count=1i ' + ts,
    'requestsRaw,' + txTags + ' responseTime=' + response.timings.duration + ',errorCount=' + failed + 'i,count=1i ' + ts,
  ]);
}

setup() and teardown() — write these exactly:

export function setup() {
  if (INFLUX_V2_ENABLED) { ensureInfluxBucket(); }
  k6VusMax.add(SCENARIO_MAX_VUS, { testid: TEST_ID });
  const ts = String(Date.now()) + '000000';
  writeInfluxLines([
    'testStartEnd,' + buildInfluxTagSet({ runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, type: 'started' }) + ' value=1i ' + ts,
    'k6_vus_max,testid=' + escapeTagValue(TEST_ID) + ' value=' + SCENARIO_MAX_VUS + 'i ' + ts,
  ]);
  return null;
}
export function teardown() {
  const ts = String(Date.now()) + '000000';
  writeInfluxLines([
    'testStartEnd,' + buildInfluxTagSet({ runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, type: 'finished' }) + ' value=1i ' + ts,
  ]);
}

At the START of every exec function iteration (NOT export default), add:

  const _ts = String(Date.now()) + '000000';
  k6IterationsTotal.add(1, { testid: TEST_ID, scenario: SCENARIO_NAME });
  k6Vus.add(1, { testid: TEST_ID, scenario: SCENARIO_NAME, vu: String(__VU) });
  writeInfluxLines([
    'k6_iterations_total,testid=' + escapeTagValue(TEST_ID) + ',scenario=' + escapeTagValue(SCENARIO_NAME) + ' value=1i ' + _ts,
    'k6_vus,testid=' + escapeTagValue(TEST_ID) + ',scenario=' + escapeTagValue(SCENARIO_NAME) + ',vu=' + escapeTagValue(__VU) + ' value=1 ' + _ts,
    'virtualUsers,' + buildInfluxTagSet({ runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, scenario: SCENARIO_NAME }) + ' meanActiveThreads=1,finishedThreads=' + __ITER + ' ' + _ts,
  ]);

After EVERY http call, immediately call:
  recordCustomMetrics(res, SCENARIO_NAME, '<api-tag>', '<url-path>', getByteLength(payload || ''), '<Step Name>');

handleSummary — output ONLY stdout, no file writes:
export function handleSummary(data) {
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}

════════════════════════════════════════════════════════════════

TEST TYPE LOAD SHAPES:
- "Smoke Test": 1-3 VUs, 1m duration
- "Load Test": ramp 2m → sustain 8m → ramp-down 2m
- "Stress Test": ramp to 2× normal, sustain 5m, find breaking point
- "Spike Test": burst to max 1m, drop, repeat 3 cycles
- "Soak Test": low-medium VUs for 30-60m (memory leak detection)
- "Volume Test": moderate VUs, high iteration count

COMPLEXITY LEVELS:
- "Simple": single default function, sequential endpoints, basic checks
- "Standard": separate exec functions, custom per-endpoint Trend metrics, weighted scenarios
- "Advanced": full scenario matrix, per-scenario thresholds, data parameterization, detailed error handling

Generate the k6 script now. Output ONLY JavaScript, starting with the first import line.`;
}
// POST /api/ai-generate — streaming SSE endpoint
router.post('/ai-generate', upload.single('file'), async (req, res) => {
    const { testType, complexity, pastedContent } = req.body;
    const hasAuth = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
    if (!hasAuth) {
        res.status(500).json({
            error: 'Anthropic API credentials not configured. Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in backend/.env or as an environment variable.',
        });
        return;
    }
    // Get content to analyze
    let fileContent = '';
    if (req.file) {
        try {
            fileContent = parseFileToText(req.file.buffer, req.file.mimetype, req.file.originalname);
        }
        catch (err) {
            res.status(400).json({ error: `Failed to parse file: ${err.message}` });
            return;
        }
    }
    else if (pastedContent) {
        fileContent = pastedContent;
    }
    else {
        res.status(400).json({ error: 'No file or content provided' });
        return;
    }
    const userMessage = `Here are the test cases to analyze and convert into a k6 performance test script:

\`\`\`
${fileContent}
\`\`\`

Generate a ${testType} k6 script at ${complexity} complexity level based on these test cases. Output ONLY the JavaScript code.`;
    // Set up SSE headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const sendEvent = (type, data) => {
        res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };
    try {
        sendEvent('status', { message: `Analyzing ${req.file ? req.file.originalname : 'content'} with Claude...` });
        const stream = await getClient().messages.stream({
            model: 'claude-opus-4-8',
            max_tokens: 8096,
            system: buildSystemPrompt(testType || 'Load Test', complexity || 'Standard'),
            messages: [{ role: 'user', content: userMessage }],
        });
        let fullScript = '';
        for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                const text = chunk.delta.text;
                fullScript += text;
                sendEvent('chunk', { text });
            }
        }
        // Strip any accidental markdown code fences
        fullScript = fullScript
            .replace(/^```(?:javascript|js)?\n?/m, '')
            .replace(/\n?```\s*$/m, '')
            .trim();
        sendEvent('complete', { script: fullScript });
        res.end();
    }
    catch (err) {
        if (err.status === 401) {
            sendEvent('error', { message: 'Invalid Anthropic API key. Check your ANTHROPIC_API_KEY.' });
        }
        else if (err.status === 429) {
            sendEvent('error', { message: 'Rate limit reached. Please wait a moment and try again.' });
        }
        else {
            sendEvent('error', { message: err.message || 'AI generation failed' });
        }
        res.end();
    }
});
exports.default = router;
