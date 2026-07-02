/**
 * K6 InfluxDB v2 integration boilerplate.
 * Injected into every generated script so metrics flow to InfluxDB → Grafana.
 *
 * Fixes applied vs original:
 * - k6-summary upgraded to 0.0.2
 * - INFLUX_V2_ORG_ID added (bypasses fragile org-name lookup)
 * - INFLUX_V2_AUTO_CREATE_BUCKET added
 * - ensureInfluxBucket() included in every script so missing buckets abort cleanly
 * - buildInfluxTagSet() replaces buildReferenceTagSet() – supports optional error fields
 * - getErrorDetails() captures responseCode / errorMessage on failures
 * - recordCustomMetrics() adds count=1i to both requestsRaw lines (consistent)
 * - k6VusMax moved from per-iteration __VU===1 guard to setup() (reliable)
 * - All alignment whitespace removed
 */

/** Imports – replace the basic http/check/sleep imports */
export function influxImports(): string {
  return [
    "import http from 'k6/http';",
    "import { check, sleep, group, fail } from 'k6';",
    "import { Counter, Gauge, Trend } from 'k6/metrics';",
    "import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';",
  ].join('\n');
}

/** Module-level env vars + custom metric instances */
export function influxEnvAndMetrics(testName: string, baseUrl = 'http://localhost:3000'): string {
  return [
    `const TEST_ID = __ENV.TESTID || ('local-' + Date.now());`,
    `const RUN_ID = __ENV.RUN_ID || ('PerfOps-' + Date.now());`,
    `const NODE_NAME = __ENV.NODE_NAME || 'PerfOps';`,
    `const TEST_NAME = __ENV.TEST_NAME || '${testName}';`,
    `const BASE_URL = __ENV.BASE_URL || '${baseUrl}';`,
    `const INFLUX_V2_URL = __ENV.INFLUX_V2_URL || 'http://localhost:8086';`,
    `const INFLUX_V2_ORG = __ENV.INFLUX_V2_ORG || '';`,
    `const INFLUX_V2_ORG_ID = __ENV.INFLUX_V2_ORG_ID || '';`,
    `const INFLUX_V2_BUCKET = __ENV.INFLUX_V2_BUCKET || 'PerfDB';`,
    `const INFLUX_V2_TOKEN = __ENV.INFLUX_V2_TOKEN || '';`,
    `const INFLUX_V2_AUTO_CREATE_BUCKET = (__ENV.INFLUX_V2_AUTO_CREATE_BUCKET || 'false').toLowerCase() === 'true';`,
    `const INFLUX_V2_ENABLED = !!(INFLUX_V2_ORG && INFLUX_V2_BUCKET && INFLUX_V2_TOKEN);`,
    '',
    `const k6HttpReqsTotal = new Counter('k6_http_reqs_total');`,
    `const k6HttpReqFailedTotal = new Counter('k6_http_req_failed_total');`,
    `const k6IterationsTotal = new Counter('k6_iterations_total');`,
    `const k6HttpReqDurationSeconds = new Trend('k6_http_req_duration_seconds');`,
    `const k6Vus = new Gauge('k6_vus');`,
    `const k6VusMax = new Gauge('k6_vus_max');`,
    `const k6DataSentBytesTotal = new Counter('k6_data_sent_bytes_total');`,
    `const k6DataReceivedBytesTotal = new Counter('k6_data_received_bytes_total');`,
  ].join('\n');
}

/** Helper functions injected before export default */
export function influxHelperFunctions(): string {
  return `
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
    const r = http.get(
      INFLUX_V2_URL + '/api/v2/orgs',
      { headers: getInfluxAuthHeaders(), tags: { api: 'influx-v2-orgs', step: 'metrics-precheck', name: 'GET /api/v2/orgs' } }
    );
    if (r.status < 200 || r.status >= 300) {
      throw new Error('Cannot reach InfluxDB org "' + INFLUX_V2_ORG + '". HTTP ' + r.status + '. Set INFLUX_V2_ORG_ID to skip this lookup.');
    }
    let body;
    try { body = r.json(); } catch(e) { throw new Error('InfluxDB org lookup returned non-JSON (status ' + r.status + ')'); }
    const orgs = body.orgs || [];
    const found = orgs.find(function(o) { return String(o.name).toLowerCase() === String(INFLUX_V2_ORG).toLowerCase(); });
    if (!found) throw new Error('InfluxDB org "' + INFLUX_V2_ORG + '" not found. Set INFLUX_V2_ORG_ID to bypass lookup.');
    orgId = found.id;
  }
  const br = http.get(
    INFLUX_V2_URL + '/api/v2/buckets?orgID=' + encodeURIComponent(orgId) + '&name=' + encodeURIComponent(INFLUX_V2_BUCKET),
    { headers: getInfluxAuthHeaders(), tags: { api: 'influx-v2-buckets', step: 'metrics-precheck', name: 'GET /api/v2/buckets' } }
  );
  let bucketExists = false;
  if (br.status === 404) {
    bucketExists = false;
  } else if (br.status >= 200 && br.status < 300) {
    let bb;
    try { bb = br.json(); } catch(e) { throw new Error('InfluxDB bucket lookup returned non-JSON'); }
    bucketExists = (bb.buckets || []).some(function(b) { return b.name === INFLUX_V2_BUCKET; });
  } else {
    throw new Error('Cannot verify bucket "' + INFLUX_V2_BUCKET + '". HTTP ' + br.status);
  }
  if (bucketExists) return;
  if (!INFLUX_V2_AUTO_CREATE_BUCKET) {
    throw new Error('Bucket "' + INFLUX_V2_BUCKET + '" does not exist in org "' + INFLUX_V2_ORG + '". Set INFLUX_V2_AUTO_CREATE_BUCKET=true to create it automatically.');
  }
  const cr = http.post(
    INFLUX_V2_URL + '/api/v2/buckets',
    JSON.stringify({ orgID: orgId, name: INFLUX_V2_BUCKET, retentionRules: [] }),
    {
      headers: { Authorization: 'Token ' + INFLUX_V2_TOKEN, Accept: 'application/json', 'Content-Type': 'application/json' },
      tags: { api: 'influx-v2-buckets', step: 'metrics-precheck', name: 'POST /api/v2/buckets' },
    }
  );
  if (cr.status !== 200 && cr.status !== 201) {
    throw new Error('Failed to create bucket "' + INFLUX_V2_BUCKET + '". HTTP ' + cr.status);
  }
}
// Buffered, not flushed on every call — each request under test previously
// triggered its own blocking http.post() to InfluxDB, doubling the VU's HTTP
// traffic and serializing iteration speed on InfluxDB's response time. Lines
// are now batched per-VU and flushed every INFLUX_FLUSH_THRESHOLD lines (~3-4
// requests' worth), cutting blocking writes ~3-4x while keeping near-real-time
// granularity. flushInfluxLines() forces a flush (called from teardown so the
// last partial batch isn't dropped).
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
    {
      headers: { Authorization: 'Token ' + INFLUX_V2_TOKEN, 'Content-Type': 'text/plain; charset=utf-8' },
      tags: { api: 'influx-v2-write', step: 'metrics-publish', name: 'POST /api/v2/write' },
    }
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
`;
}

/**
 * setup() export.
 * Calls ensureInfluxBucket() so missing buckets abort cleanly before load starts.
 * Writes k6VusMax once here – more reliable than the old __VU===1 per-iteration guard.
 *
 * @param maxVusExpr  JS expression string (or number literal) for the configured peak VUs.
 *                    Evaluated at K6 init time and embedded literally into the script.
 */
export function influxSetup(maxVusExpr: string | number = 0): string {
  return `
export function setup() {
  if (INFLUX_V2_ENABLED) { ensureInfluxBucket(); }
  k6VusMax.add(${maxVusExpr}, { testid: TEST_ID });
  const ts = String(Date.now()) + '000000';
  writeInfluxLines([
    'testStartEnd,' + buildInfluxTagSet({ runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, type: 'started' }) + ' value=1i ' + ts,
    'k6_vus_max,testid=' + escapeTagValue(TEST_ID) + ' value=${maxVusExpr}i ' + ts,
  ]);
  return null;
}
`;
}

/** teardown() export – writes testStartEnd finished event */
// NOTE: teardown() runs in its own fresh VU context in k6, so it can only flush
// its own (empty) buffer — it cannot reach into other VUs' buffers. Each VU may
// lose up to INFLUX_FLUSH_THRESHOLD-1 buffered lines (a few trailing requests)
// when it exits. That's an acceptable trade for cutting blocking InfluxDB
// writes ~3-4x; k6's architecture gives no per-VU exit hook to flush earlier.
export function influxTeardown(): string {
  return `
export function teardown() {
  const ts = String(Date.now()) + '000000';
  writeInfluxLines([
    'testStartEnd,' + buildInfluxTagSet({ runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, type: 'finished' }) + ' value=1i ' + ts,
  ]);
  flushInfluxLines();
}
`;
}

/**
 * VU / iteration tracking block for the start of every exec function.
 * k6VusMax is no longer set here (moved to setup()) to avoid the unreliable __VU===1 guard.
 *
 * @param scenarioName  The JS expression for the scenario name (e.g. 'SCENARIO_NAME' or a string literal).
 */
export function influxIterationTracking(scenarioName: string): string {
  return `
  const _ts = String(Date.now()) + '000000';
  k6IterationsTotal.add(1, { testid: TEST_ID, scenario: ${scenarioName} });
  k6Vus.add(1, { testid: TEST_ID, scenario: ${scenarioName}, vu: String(__VU) });
  writeInfluxLines([
    'k6_iterations_total,testid=' + escapeTagValue(TEST_ID) + ',scenario=' + escapeTagValue(${scenarioName}) + ' value=1i ' + _ts,
    'k6_vus,testid=' + escapeTagValue(TEST_ID) + ',scenario=' + escapeTagValue(${scenarioName}) + ',vu=' + escapeTagValue(__VU) + ' value=1 ' + _ts,
    'virtualUsers,' + buildInfluxTagSet({ runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, scenario: ${scenarioName} }) + ' meanActiveThreads=1,finishedThreads=' + __ITER + ' ' + _ts,
  ]);
`;
}

/**
 * Produces the recordCustomMetrics() call line for a given request.
 */
export function influxRecordCall(
  responseVar: string,
  scenarioExpr: string,
  apiTag: string,
  urlPath: string,
  sentBytesExpr: string,
  stepName: string,
): string {
  return `recordCustomMetrics(${responseVar}, ${scenarioExpr}, '${apiTag}', '${urlPath}', ${sentBytesExpr}, '${stepName}');`;
}
