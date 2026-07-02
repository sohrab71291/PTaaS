import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import multer from 'multer';
import * as XLSX from 'xlsx';
import * as path from 'path';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Build client lazily so it always reads the env vars after dotenv has run
function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (apiKey) return new Anthropic({ apiKey });
  if (authToken) return new Anthropic({ authToken });
  return new Anthropic({ apiKey: '' }); // will fail with clear auth error
}

// Parse uploaded file into readable text content
function parseFileToText(buffer: Buffer, originalname: string): string {
  const ext = path.extname(originalname).toLowerCase();
  if (['.csv', '.xls', '.xlsx'].includes(ext)) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const results: string[] = [];
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
    } catch {
      return buffer.toString('utf8');
    }
  }
  // YAML, TXT, HAR, or any other text format — pass through as-is
  return buffer.toString('utf8');
}

// Test case files (CSV/XLSX/JSON/pasted text) often list full URLs per row.
// Pull the origin out of the first absolute URL we find so the AI uses it as BASE_URL.
function detectBaseUrl(content: string): string | null {
  const match = content.match(/https?:\/\/[^\s"'`,)]+/);
  if (!match) return null;
  try {
    return new URL(match[0]).origin;
  } catch {
    return null;
  }
}

function describeBaseUrl(baseUrl: string | null): string {
  if (!baseUrl) return '';
  return `\nMANDATORY BASE_URL — the uploaded test case data references "${baseUrl}". Use this as the BASE_URL default (see rule 4 and the InfluxDB integration block below) — do NOT default to localhost.\n`;
}

interface LoadProfileConfig {
  profileType: 'staged' | 'constant';
  stages?: { target: number; duration: string }[];
  constantVus?: number;
  constantDuration?: string;
}

function describeLoadProfile(profile: LoadProfileConfig | null): string {
  if (!profile) return '';
  if (profile.profileType === 'constant') {
    return `\nMANDATORY LOAD PROFILE — the user explicitly configured this; use it exactly, do not invent your own:
- Constant load: ${profile.constantVus ?? 10} VUs for ${profile.constantDuration ?? '1m'}.
- Every scenario's executor must be 'constant-vus' with vus: ${profile.constantVus ?? 10} and duration: '${profile.constantDuration ?? '1m'}'.\n`;
  }
  const stages = profile.stages && profile.stages.length > 0
    ? profile.stages
    : [{ target: 10, duration: '2m' }, { target: 10, duration: '5m' }, { target: 0, duration: '2m' }];
  const stagesList = stages.map(s => `    { target: ${s.target}, duration: '${s.duration}' },`).join('\n');
  return `\nMANDATORY LOAD PROFILE — the user explicitly configured this; use it exactly, do not invent your own:
- Ramping load with these exact stages (every scenario's executor must be 'ramping-vus' using this stages array verbatim):
  stages: [
${stagesList}
  ]\n`;
}

function describeEnvVarKeys(keys: string[]): string {
  if (!keys.length) return '';
  return `\nADDITIONAL ENV VARS — the user pre-declared these names; reference any that are relevant via __ENV.<NAME> (e.g. auth tokens, tenant ids) instead of hardcoding values: ${keys.join(', ')}\n`;
}

interface SpecContext {
  name: string;
  description?: string;
  tags?: string[];
  request: {
    method: string;
    url: string;
    headers: { key: string; value: string }[];
    payload: string | null;
    auth: { type: string; tokenSecret?: string; headerName?: string };
  };
  checks: string[];
  thresholds: Record<string, { condition: string; abortOnFail?: boolean }[]>;
  slos: any[];
}

function describeSpecContext(ctx: SpecContext | null): string {
  if (!ctx) return '';

  const lines: string[] = ['\nTEST SUITE CONTEXT — from the Test Authoring form. Test case data takes priority for'];
  lines.push('per-row specifics; use this to fill in anything the test case data leaves unspecified:');
  lines.push(`- Test Name: ${ctx.name || '(untitled)'}`);
  if (ctx.description) lines.push(`- Description: ${ctx.description}`);
  if (ctx.tags?.length) lines.push(`- Tags: ${ctx.tags.join(', ')}`);

  if (ctx.request) {
    const r = ctx.request;
    lines.push(`- Default request: ${r.method} ${r.url}`);
    if (r.headers?.length) {
      lines.push(`  Headers: ${r.headers.map(h => `${h.key}: ${h.value}`).join(', ')}`);
    }
    if (r.payload) lines.push(`  Payload template: ${r.payload}`);
    if (r.auth && r.auth.type !== 'none') {
      lines.push(`  Auth: ${r.auth.type}${r.auth.tokenSecret ? ` — secret name __ENV.${r.auth.tokenSecret}` : ''}${r.auth.headerName ? `, header "${r.auth.headerName}"` : ''}`);
    }
  }

  const checks = (ctx.checks ?? []).filter(c => c && c.trim());
  if (checks.length) {
    lines.push(`- MANDATORY checks (every request must include check() assertions covering these): ${checks.join(' | ')}`);
  }

  const thresholdEntries = Object.entries(ctx.thresholds ?? {});
  if (thresholdEntries.length) {
    const rendered = thresholdEntries.map(([metric, conds]) => `${metric}: ${conds.map(c => c.condition).join(', ')}`).join(' | ');
    lines.push(`- MANDATORY thresholds (use these exact conditions in options.thresholds instead of the defaults in rule 11): ${rendered}`);
  }

  if (ctx.slos?.length) {
    const rendered = ctx.slos.map((s: any) => `${s.label || s.metric} ${s.operator === 'lte' ? '<=' : '>='} ${s.target}${s.unit || ''}`).join(' | ');
    lines.push(`- SLO/SLA targets (reflect these in thresholds where the metric maps to a k6 threshold, e.g. p95/error rate): ${rendered}`);
  }

  return lines.join('\n') + '\n';
}

function buildSystemPrompt(
  testType: string,
  complexity: string,
  loadProfile: LoadProfileConfig | null,
  envVarKeys: string[],
  baseUrl: string | null,
  specContext: SpecContext | null,
): string {
  return `You are an expert performance engineer specializing in k6 load testing with InfluxDB v2 integration. Analyze the provided test case data and generate a complete, production-ready k6 JavaScript script.

Test Type: ${testType}
Complexity: ${complexity}
${describeLoadProfile(loadProfile)}${describeEnvVarKeys(envVarKeys)}${describeBaseUrl(baseUrl)}${describeSpecContext(specContext)}

MANDATORY RULES — every rule must be followed exactly:
1. Output ONLY valid JavaScript — no markdown, no code fences, no explanation text.
2. Start with imports, end with handleSummary export.
3. Include the full InfluxDB v2 integration block shown below, word for word.
4. Use __ENV.BASE_URL for all request base URLs, defaulting to ${baseUrl ? `'${baseUrl}' (see MANDATORY BASE_URL above — this came from the uploaded test case data, do NOT use localhost)` : `'http://localhost:3000'`}.
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
17. If the test cases require authentication (a login/token endpoint), perform the login ONCE in setup() — never per-VU or per-iteration — and pass the resulting session token to exec functions via setup()'s return value. See AUTHENTICATION PATTERN below; this is mandatory whenever a login step exists, to avoid concurrent-login failures under load.

════════════════════════════════════════════════════════════════
INFLUXDB INTEGRATION — EMBED THIS BLOCK EXACTLY IN EVERY SCRIPT
════════════════════════════════════════════════════════════════

After imports, declare env vars and metrics:

const TEST_ID = __ENV.TESTID || ('local-' + Date.now());
const RUN_ID = __ENV.RUN_ID || ('PerfOps-' + Date.now());
const NODE_NAME = __ENV.NODE_NAME || 'PerfOps';
const TEST_NAME = __ENV.TEST_NAME || '<derive from test cases>';
const BASE_URL = __ENV.BASE_URL || '${baseUrl || 'http://localhost:3000'}';
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
// Buffered — do NOT flush on every call. Flushing per call means every request
// under test triggers its own blocking write to InfluxDB, doubling HTTP traffic
// and serializing each VU's iteration speed on InfluxDB's response time. Batch
// lines and flush every INFLUX_FLUSH_THRESHOLD lines instead.
let __influxBuffer = [];
const INFLUX_FLUSH_THRESHOLD = 25;
function writeInfluxLines(lines) {
  if (!INFLUX_V2_ENABLED || lines.length === 0) return;
  for (let i = 0; i < lines.length; i++) __influxBuffer.push(lines[i]);
  if (__influxBuffer.length >= INFLUX_FLUSH_THRESHOLD) flushInfluxLines();
}
function flushInfluxLines() {
  if (!INFLUX_V2_ENABLED || __influxBuffer.length === 0) return;
  const batch = __influxBuffer;
  __influxBuffer = [];
  http.post(
    INFLUX_V2_URL + '/api/v2/write?org=' + encodeURIComponent(INFLUX_V2_ORG) + '&bucket=' + encodeURIComponent(INFLUX_V2_BUCKET) + '&precision=ns',
    batch.join('\\n'),
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

setup() and teardown() — write these exactly (this is the InfluxDB-only baseline;
if the test cases need authentication, extend setup() per AUTHENTICATION PATTERN
below instead of writing a separate setup() function):

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
  flushInfluxLines();
}

════════════════════════════════════════════════════════════════
AUTHENTICATION PATTERN — MANDATORY whenever the test cases involve a login/auth
step. Login ONCE in setup(), not per-VU/per-iteration, to avoid concurrent-login
failures (e.g. rate limits, session collisions) when many VUs ramp up in parallel.
════════════════════════════════════════════════════════════════

Merge this into the setup() shown above (do not write a second setup()) — after
the InfluxDB bootstrap lines, perform the single shared login and return the
token so every VU iteration reuses it instead of logging in itself:

CREDENTIALS — MANDATORY: the username/password (and any other login fields,
e.g. instance/tenant name) MUST be taken from the uploaded test case data, not
invented or left as a generic placeholder. Declare them as __ENV-overridable
constants whose DEFAULT is the literal value found in the test cases, e.g.:
  const USERNAME = __ENV.APP_USERNAME || '<exact username from test case file>';
  const PASSWORD = __ENV.APP_PASSWORD || '<exact password from test case file>';
If the test cases genuinely contain no credentials, declare the __ENV var with
no hardcoded fallback (e.g. const PASSWORD = __ENV.APP_PASSWORD || '';) rather
than fabricating one.

export function setup() {
  if (INFLUX_V2_ENABLED) { ensureInfluxBucket(); }
  k6VusMax.add(SCENARIO_MAX_VUS, { testid: TEST_ID });
  const ts = String(Date.now()) + '000000';
  writeInfluxLines([
    'testStartEnd,' + buildInfluxTagSet({ runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, type: 'started' }) + ' value=1i ' + ts,
    'k6_vus_max,testid=' + escapeTagValue(TEST_ID) + ' value=' + SCENARIO_MAX_VUS + 'i ' + ts,
  ]);

  // Single shared login to avoid concurrent auth bottleneck. USERNAME/PASSWORD
  // come from the CREDENTIALS constants above — sourced from the test cases.
  const url = BASE_URL + '<login endpoint from test cases>';
  const payload = JSON.stringify({ /* e.g. username: USERNAME, password: PASSWORD, plus any other fields the login endpoint needs */ });
  const params = { headers: { 'Content-Type': 'application/json' } };
  const res = http.post(url, payload, params);
  let body = {};
  try { body = res.json(); } catch (e) { body = {}; }

  // STRICT validation — check the EXACT response structure the login endpoint
  // returns (do not fall back to a grab-bag of possible field names). Inspect
  // the actual login response shape from the test cases and match it exactly,
  // e.g. for Archer IRM logins the shape is:
  //   if (!body.IsSuccessful || !body.RequestedObject || !body.RequestedObject.SessionToken)
  if (!body.IsSuccessful || !body.RequestedObject || !body.RequestedObject.SessionToken) {
    throw new Error('Setup failed: Could not authenticate. Response: ' + JSON.stringify(body).substring(0, 300));
  }
  console.log('Setup: Successfully authenticated. Session token acquired.');
  return { sessionToken: body.RequestedObject.SessionToken };
}

Add a helper to build per-request auth headers from the shared token. Use the
EXACT header/cookie format the target API expects — inspect the test cases for
this. For Archer IRM-style APIs the session is carried via a cookie with an
equals sign, not an Authorization/Bearer header:

function buildSessionHeaders(sessionToken, extraHeaders) {
  return Object.assign({
    Cookie: '__ArcherSessionCookie__=' + sessionToken,
  }, extraHeaders || {});
}

Every exec function MUST accept the setup() return value as its parameter and fail fast if the token is missing, instead of attempting its own login:

export function <execFnName>(setupData) {
  const sessionToken = (setupData && setupData.sessionToken) ? setupData.sessionToken : '';
  if (!sessionToken) {
    fail('Session token is missing from setup. Cannot execute authenticated API calls.');
  }
  const authHeaders = buildSessionHeaders(sessionToken);
  // ... use authHeaders on every authenticated request below
}

Every authenticated request MUST wrap headers in a params object, spreading
authHeaders alongside any per-request headers (e.g. Content-Type) — do not pass
authHeaders directly as the headers value:

const params = {
  headers: { ...authHeaders, 'Content-Type': 'application/json' },
  tags: { name: '<RequestName>' },
};
const res = http.post(url, payload, params);

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

TEST TYPE LOAD SHAPES (fallback only — ignore this section if a MANDATORY LOAD PROFILE was given above; that one wins):
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

const isOverloaded = (err: any) =>
  err?.status === 529 || err?.error?.error?.type === 'overloaded_error' || err?.error?.type === 'overloaded_error';

const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [1000, 2000, 4000];

// POST /api/ai-generate — streaming SSE endpoint
router.post('/ai-generate', upload.single('file'), async (req: Request, res: Response) => {
  const { testType, complexity, pastedContent, loadProfile: loadProfileRaw, envVarKeys: envVarKeysRaw, specContext: specContextRaw } = req.body;

  let loadProfile: LoadProfileConfig | null = null;
  try { loadProfile = loadProfileRaw ? JSON.parse(loadProfileRaw) : null; } catch {}
  let envVarKeys: string[] = [];
  try { envVarKeys = envVarKeysRaw ? JSON.parse(envVarKeysRaw) : []; } catch {}
  let specContext: SpecContext | null = null;
  try { specContext = specContextRaw ? JSON.parse(specContextRaw) : null; } catch {}

  const hasAuth = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (!hasAuth) {
    res.status(500).json({
      error: 'Anthropic API credentials not configured. Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in backend/.env or as an environment variable.',
    });
    return;
  }

  if (!req.file && !pastedContent) {
    res.status(400).json({ error: 'No file or content provided' });
    return;
  }

  // Parse the uploaded file into text Claude can read
  let fileContent = '';
  if (req.file) {
    try {
      fileContent = parseFileToText(req.file.buffer, req.file.originalname);
    } catch (err: any) {
      res.status(400).json({ error: `Failed to parse file: ${err.message}` });
      return;
    }
  } else {
    fileContent = pastedContent;
  }

  const detectedBaseUrl = detectBaseUrl(fileContent) ?? detectBaseUrl(specContext?.request?.url ?? '');
  const userMessage = `Here are the test cases to analyze and convert into a k6 performance test script:\n\n\`\`\`\n${fileContent}\n\`\`\`\n\nGenerate a ${testType} k6 script at ${complexity} complexity level based on these test cases. Output ONLY the JavaScript code.`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (type: string, data: any) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  const stripFences = (s: string) => s
    .replace(/^```(?:javascript|js)?\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();

  try {
    sendEvent('status', { message: `Analyzing ${req.file ? req.file.originalname : 'content'} with Claude…` });

    let stream: Awaited<ReturnType<Anthropic['messages']['stream']>> | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        stream = await getClient().messages.stream({
          model: 'claude-opus-4-8',
          max_tokens: 8096,
          system: buildSystemPrompt(testType || 'Load Test', complexity || 'Standard', loadProfile, envVarKeys, detectedBaseUrl, specContext),
          messages: [{ role: 'user', content: userMessage }],
        });
        break;
      } catch (err: any) {
        if (isOverloaded(err) && attempt < MAX_ATTEMPTS - 1) {
          sendEvent('status', { message: `Claude is currently overloaded — retrying (${attempt + 1}/${MAX_ATTEMPTS - 1})…` });
          await new Promise(r => setTimeout(r, BACKOFF_MS[attempt]));
          continue;
        }
        throw err;
      }
    }
    if (!stream) throw new Error('Failed to start generation after retries');

    let fullScript = '';
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        const text = chunk.delta.text;
        fullScript += text;
        sendEvent('chunk', { text });
      }
    }
    fullScript = stripFences(fullScript);

    sendEvent('complete', { script: fullScript });
    res.end();
  } catch (err: any) {
    if (err.name === 'AbortError') { res.end(); return; }
    if (err.status === 401) {
      sendEvent('error', { message: 'Invalid Anthropic API key. Check your ANTHROPIC_API_KEY.' });
    } else if (err.status === 429) {
      sendEvent('error', { message: 'Rate limit reached. Please wait a moment and try again.' });
    } else if (isOverloaded(err)) {
      sendEvent('error', { message: "Claude's servers are overloaded right now. We retried a few times but it didn't recover — please try again in a minute." });
    } else {
      sendEvent('error', { message: err.message || 'AI generation failed' });
    }
    res.end();
  }
});

export default router;
