// Shared prompt text embedded in every Claude-generated k6 script. Split into
// three pieces so callers can mix and match:
//   - buildInfluxBlock: env vars / metrics / helpers / baseline setup+teardown
//     (always required, independent of auth).
//   - buildGenericAuthPatternBlock: the generic "inspect the test cases and
//     figure out the login shape yourself" pattern — used by /api/ai-generate
//     (routes/aiGenerate.ts), which only has loosely-structured uploaded text
//     to work from.
//   - HANDLE_SUMMARY_BLOCK: the trailing handleSummary requirement.
// /api/har-generate (routes/harGenerate.ts) uses only buildInfluxBlock +
// HANDLE_SUMMARY_BLOCK — it writes its own auth instructions because it
// deterministically injects the login request as a LOGIN_REQUEST constant
// rather than asking Claude to transcribe it.
export function buildInfluxBlock(baseUrl: string | null): string {
  return `════════════════════════════════════════════════════════════════
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
// A replayed/captured request can legitimately land on a redirect or an
// auth-probe response (401/403) without that being a real failure — e.g. a
// captured 302 replays as a 302 to a different location, or a session check
// intentionally probes with a stale token. Treat those as expected instead of
// counting them against http_req_failed.
function isResponseStatusExpected(response, expectedStatus) {
  if (expectedStatus === undefined || expectedStatus === null) return false;
  if (response.status === expectedStatus) return true;
  if (expectedStatus >= 300 && expectedStatus < 400) {
    return response.status >= 300 && response.status < 400;
  }
  return response.status === 401 || response.status === 403;
}
function recordCustomMetrics(response, scenario, apiTag, urlPath, sentBytes, requestName, expectedStatus) {
  const failed = response.status >= 400 && !isResponseStatusExpected(response, expectedStatus) ? 1 : 0;
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
`;
}

export function buildGenericAuthPatternBlock(): string {
  return `════════════════════════════════════════════════════════════════
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

  // Extract the session token defensively — try the common response shapes in
  // order of specificity (Archer IRM nests it under RequestedObject.SessionToken;
  // most REST APIs use one of the flatter shapes below). Match the EXACT shape
  // from the actual login response in the test cases where possible.
  const sessionToken = (
    (body.RequestedObject && body.RequestedObject.SessionToken) ||
    body.access_token ||
    body.token ||
    body.sessionToken ||
    (body.data && body.data.token) ||
    (body.data && body.data.access_token) ||
    ''
  );
  if (!sessionToken) {
    throw new Error('Setup failed: Could not authenticate. Response: ' + JSON.stringify(body).substring(0, 300));
  }

  // Build the Cookie header carried by every subsequent request. Prefer real
  // Set-Cookie cookies from the login response (k6 exposes these on res.cookies
  // regardless of the VU cookie jar) — this is what the browser would actually
  // send. Fall back to a cookie built from the extracted token so cookie-based
  // session APIs (e.g. Archer IRM's __ArcherSessionCookie__) still work even
  // when the login endpoint returns the token only in the JSON body.
  const cookieParts = [];
  if (res.cookies) {
    for (const cookieName of Object.keys(res.cookies)) {
      const c = res.cookies[cookieName][0];
      if (c) cookieParts.push(cookieName + '=' + c.value);
    }
  }
  if (cookieParts.length === 0) {
    // <cookie name from the captured request's own Cookie header, if any —
    // otherwise a sensible default such as '__ArcherSessionCookie__' or 'session'>
    cookieParts.push('<cookie-name>=' + sessionToken);
  }
  const cookieHeader = cookieParts.join('; ');

  console.log('Setup: Successfully authenticated. Session token acquired.');
  return { sessionToken: sessionToken, cookieHeader: cookieHeader };
}

Every exec function MUST accept the setup() return value as its parameter and fail fast if the token is missing, instead of attempting its own login. Every authenticated request MUST send the shared session via the Cookie header built in setup() — this is the "required cookie header value" every other API call needs:

export function <execFnName>(setupData) {
  const sessionToken = (setupData && setupData.sessionToken) ? setupData.sessionToken : '';
  const cookieHeader = (setupData && setupData.cookieHeader) ? setupData.cookieHeader : '';
  if (!sessionToken) {
    fail('Session token is missing from setup. Cannot execute authenticated API calls.');
  }
  const authHeaders = { Cookie: cookieHeader };
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

After EVERY http call, immediately call (the trailing expectedStatus arg lets
recordCustomMetrics use the isResponseStatusExpected() helper declared in the
InfluxDB block above, so an expected redirect or 401/403 auth-probe doesn't
get counted as a failure):
  recordCustomMetrics(res, SCENARIO_NAME, '<api-tag>', '<url-path>', getByteLength(payload || ''), '<Step Name>', <expected-status>);
`;
}

export const HANDLE_SUMMARY_BLOCK = `handleSummary — output ONLY stdout, no file writes:
export function handleSummary(data) {
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}
`;

// Backwards-compatible combined block (InfluxDB baseline + generic auth pattern +
// handleSummary) — matches the original single-block text used by /api/ai-generate.
export function buildInfluxAndAuthBlock(baseUrl: string | null): string {
  return `${buildInfluxBlock(baseUrl)}
${buildGenericAuthPatternBlock()}
${HANDLE_SUMMARY_BLOCK}`;
}
