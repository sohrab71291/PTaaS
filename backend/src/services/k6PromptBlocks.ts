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
// PASS/FAIL POLICY: this is used ONLY to label a check()/console.warn()
// validation as passed/failed — it must NEVER influence whether a response
// counts as a failure in recordCustomMetrics() below. Every 4xx/5xx status is
// unconditionally a real failure (see recordCustomMetrics), full stop — a
// captured/expected status match only ever affects the check()/WARNING text.
// A replayed/captured request can legitimately land on a redirect to a
// different location than the one captured — still a redirect, so still
// "expected" for the check() label. 401/403 are deliberately NOT treated as
// expected here: a real auth failure (expired/invalid session, bad
// credentials, missing bearer token) must always surface as a failed check.
function isResponseStatusExpected(response, expectedStatus) {
  if (expectedStatus === undefined || expectedStatus === null) return false;
  if (response.status === expectedStatus) return true;
  if (expectedStatus >= 300 && expectedStatus < 400) {
    return response.status >= 300 && response.status < 400;
  }
  return false;
}
// expectedStatus is passed through for context only (error messages) — it
// must NEVER exempt a 4xx/5xx from counting as failed. Every non-2xx/3xx
// response is unconditionally a real failure (Section D Thresholds/SLA
// policy — see the Test Authoring "Validation and Threshold" panel): Section
// D Checks are validations only and must never affect this calculation.
function recordCustomMetrics(response, scenario, apiTag, urlPath, sentBytes, requestName, expectedStatus) {
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
`;
}

export function buildGenericAuthPatternBlock(): string {
  return `════════════════════════════════════════════════════════════════
AUTHENTICATION PATTERN — MANDATORY whenever the test cases involve a login/auth
step. Login ONCE in setup(), not per-VU/per-iteration, to avoid concurrent-login
failures (e.g. rate limits, session collisions) when many VUs ramp up in parallel.
This pattern calls fail() below — 'fail' MUST be in the top-level k6 import
(import { check, group, sleep, fail } from 'k6';), NOT just check/group/sleep.
Omitting it crashes the ENTIRE script with "fail is not defined" the instant
a login attempt fails, aborting every VU instead of just that one attempt.
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

REAUTH ON 401/403 IS MANDATORY — the shared session from setup() can expire
mid-run; a bare 401/403 on a request does NOT mean the whole flow is broken,
just that the session needs refreshing. Reproduce this helper once, near
setup() (it repeats setup()'s own login call verbatim — same url/payload/
extraction logic — so keep them in sync if you change one):

function reauthenticate() {
  const url = BASE_URL + '<login endpoint from test cases>';
  const payload = JSON.stringify({ /* same login fields as setup() above */ });
  const res = http.post(url, payload, { headers: { 'Content-Type': 'application/json' } });
  let body = {};
  try { body = res.json(); } catch (e) { body = {}; }
  const sessionToken = (
    (body.RequestedObject && body.RequestedObject.SessionToken) ||
    body.access_token || body.token || body.sessionToken ||
    (body.data && body.data.token) || (body.data && body.data.access_token) || ''
  );
  const cookieParts = [];
  if (res.cookies) {
    for (const cookieName of Object.keys(res.cookies)) {
      const c = res.cookies[cookieName][0];
      if (c) cookieParts.push(cookieName + '=' + c.value);
    }
  }
  if (cookieParts.length === 0 && sessionToken) cookieParts.push('<cookie-name>=' + sessionToken);
  console.warn('Re-authenticating after a 401/403 — session token acquired.');
  return { sessionToken: sessionToken, cookieHeader: cookieParts.join('; ') };
}

Every exec function MUST accept the setup() return value as its parameter and fail fast if the token is missing, instead of attempting its own login. Every authenticated request MUST send the shared session via the Cookie header built in setup() — this is the "required cookie header value" every other API call needs. Do NOT cache a module-level mutable copy of setupData that every VU reads/writes — reassign a LOCAL variable per exec-function invocation instead, seeded from setupData, so a 401 retry in one VU's iteration never leaks into another VU's request:

export function <execFnName>(setupData) {
  let auth = { sessionToken: (setupData && setupData.sessionToken) || '', cookieHeader: (setupData && setupData.cookieHeader) || '' };
  if (!auth.sessionToken) {
    fail('Session token is missing from setup. Cannot execute authenticated API calls.');
  }
  // ... build authHeaders from auth (see below) and issue the request. On a
  // 401 or 403 response, call auth = reauthenticate(); ONCE and retry the
  // SAME request exactly once with the refreshed headers before falling
  // through to normal check()/metrics/error-logging — never retry twice; a
  // second consecutive 401/403 is a real failure (isResponseStatusExpected
  // in the InfluxDB block above NEVER treats 401/403 as expected, by design).
}

Every authenticated request MUST wrap headers in a params object, spreading
authHeaders (built fresh from the current auth value — NOT a stale object
captured once at the top of the exec function, since a mid-function reauth()
call replaces it) alongside any per-request headers (e.g. Content-Type) — do
not pass authHeaders directly as the headers value:

function authHeadersFrom(auth) {
  return { Cookie: auth.cookieHeader };
}

const params = {
  headers: { ...authHeadersFrom(auth), 'Content-Type': 'application/json' },
  tags: { name: '<RequestName>', endpoint_type: 'app' },
};
let res = http.post(url, payload, params);
if (res.status === 401 || res.status === 403) {
  auth = reauthenticate();
  res = http.post(url, payload, { headers: { ...authHeadersFrom(auth), 'Content-Type': 'application/json' }, tags: { name: '<RequestName>', endpoint_type: 'app' } });
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

After EVERY http call, immediately call (the trailing expectedStatus arg is
passed through for context/error-message purposes only — recordCustomMetrics
treats EVERY 4xx/5xx as an unconditional failure, no exceptions, per the
PASS/FAIL POLICY in the InfluxDB block above):
  recordCustomMetrics(res, SCENARIO_NAME, '<api-tag>', '<url-path>', getByteLength(payload || ''), '<Step Name>', <expected-status>);

Also call check() on every response for the configured Validation entries
(status/response-time assertions) and log any failing one via console.warn()
— e.g. \`console.warn('<Step Name> validation warning: expected status ' +
expectedStatus + ' but got ' + res.status);\` — NEVER console.error() for a
failing check. console.error() is reserved for the unconditional 4xx/5xx
failure log required by rule 8.

endpoint_type: 'app' IS MANDATORY in the tags object of every request under
test (login, reauth, and every request made inside an exec function) — this
is what lets options.thresholds scope http_req_duration/http_req_failed to
{endpoint_type:app} (see rule 11) and exclude the InfluxDB block's own
write/precheck HTTP calls below, which are deliberately left without this tag.

flushInfluxLines() (declared in the InfluxDB block above) MUST be called as
the LAST statement of every exec function, after all of that iteration's
requests — do NOT rely on teardown() for this. teardown() runs in its own
fresh VU context in k6 (see the InfluxDB block's writeInfluxLines() comment),
so it can only ever flush an EMPTY buffer of its own; it can never reach the
buffer this VU actually accumulated during the test. Without this explicit
per-iteration flush, up to INFLUX_FLUSH_THRESHOLD-1 trailing requestsRaw
points get silently dropped whenever a VU's iteration ends mid-batch — which
is exactly why a script's own k6_http_reqs_total counter (in-memory, always
exact) can end up higher than the request count the report derives from
requestsRaw.
`;
}

export function buildCsvCredentialAuthPatternBlock(): string {
  return `════════════════════════════════════════════════════════════════
AUTHENTICATION PATTERN — CSV-BASED PER-VU CREDENTIALS. MANDATORY when the user
has opted into CSV-based login credentials. Do NOT write a generic single
shared setup() login for this mode — every VU logs in with its own
username/password drawn from a credential pool uploaded on the Executor page.
This pattern calls fail() below — 'fail' MUST be in the top-level k6 import
(import { check, group, sleep, fail } from 'k6';), NOT just check/group/sleep.
Omitting it crashes the ENTIRE script with "fail is not defined" the instant
a VU has no credentials or its login fails, aborting every VU instead of just
that one VU.
════════════════════════════════════════════════════════════════

Declare this CREDENTIALS placeholder right after the InfluxDB block's env vars
(the literal comment must be preserved verbatim — the real credential rows are
spliced in at execution time, replacing the placeholder comment):

const CREDENTIALS = ${CREDENTIALS_PLACEHOLDER}[];
// Each entry has the shape: { loginUrl, username, password, instanceName } —
// these come verbatim from the uploaded CSV's URL / Username / Password /
// InstanceName columns. InstanceName is REQUIRED by the login API (Archer IRM
// throws ArgumentNullException: request.Credentials.InstanceName when it is
// missing/null) — every row in the CSV must supply a non-empty value.

Reproduce these helpers VERBATIM before setup()/exec functions — do not
paraphrase, simplify, rename fields, or drop the InstanceName field from the
login payload; it is a required field, not optional. k6 runs each VU in its
own isolated JS runtime, so plain module-scope variables are already per-VU —
no extra locking or keying by __VU is needed for the login cache:

function getVuCredential() {
  if (!CREDENTIALS.length) {
    fail('No login credentials available — upload a credentials CSV on the Executor page.');
  }
  return CREDENTIALS[(__VU - 1) % CREDENTIALS.length];
}

// Every VU needs its own cookie jar (module scope is per-VU in k6, so this
// cache is automatically isolated — no keying by __VU needed), and the login
// call plus every subsequent authenticated request MUST pass this SAME jar
// (\`{ jar: getVuJar() }\` in the request params) — not just rely on the
// manually-built Cookie header below. The login response's own Set-Cookie
// values (e.g. an archer_ngrx_* session-state cookie) only get captured and
// automatically replayed on later requests if they flow through a jar; if the
// jar is skipped, the server keeps whatever it last set for that VU (possibly
// a "logged-out" value from a prior 401) and every subsequent call 401s
// regardless of how valid the fresh session token is.
let __vuJar = null;
function getVuJar() {
  if (!__vuJar) __vuJar = http.cookieJar();
  return __vuJar;
}

// The classic Archer session cookie (SessionToken -> __ArcherSessionCookie__)
// does NOT necessarily authenticate the newer ngrx/Angular API surface
// (/ngrx/*) — that surface commonly expects a separate bearer JWT. Extract
// BOTH defensively from the same login response: whichever fields are
// actually present get used, so this doesn't break APIs that only return one.
function extractSessionToken(body) {
  return (body && body.RequestedObject && body.RequestedObject.SessionToken) || '';
}
function extractJwt(body) {
  if (!body) return '';
  return (
    (body.RequestedObject && (body.RequestedObject.Jwt || body.RequestedObject.AccessToken)) ||
    body.Jwt || body.jwt || body.AccessToken || body.access_token || body.token || ''
  );
}
// Deliberately never sets a Cookie header — Cookie comes exclusively from the
// VU's cookie jar (getVuJar(), seeded/refreshed by ensureAuth() below), which
// every request already carries via { jar: getVuJar() }. Setting one here
// would override the jar's actual contents (an explicit Cookie header always
// wins over a jar), silently hiding any cookie the app sets mid-session — the
// classic __ArcherSessionCookie__ does NOT necessarily authenticate the newer
// ngrx/Angular API surface (/ngrx/*), which commonly gets its own
// archer_ngrx_* JWT cookie from a SEPARATE bootstrap call sometime after
// login, not from login itself. A frozen Cookie string built once at login
// would never include that cookie, and every /ngrx/* call would 401 forever
// even with a perfectly valid session — the jar picks it up automatically
// instead, exactly like a real browser, as long as no explicit Cookie header
// ever overrides it.
function authHeadersFromAuth(auth) {
  const headers = {};
  if (auth && auth.jwt) headers.Authorization = 'Bearer ' + auth.jwt;
  return headers;
}

let __vuAuth = null; // per-VU cache — module scope is per-VU in k6, so this is NOT shared across VUs
function ensureAuth() {
  if (__vuAuth) return __vuAuth;
  const cred = getVuCredential();
  // InstanceName is REQUIRED — the login API rejects the request with a null
  // ArgumentNullException on request.Credentials.InstanceName if it's missing.
  // Always include it verbatim from the CSV row, never omit or default it.
  const loginPayload = { Username: cred.username, Password: cred.password, InstanceName: cred.instanceName };
  const jar = getVuJar();
  const res = http.post(
    cred.loginUrl,
    JSON.stringify(loginPayload),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'Login', endpoint_type: 'app' }, jar: jar },
  );
  let body = {};
  try { body = res.json(); } catch (e) { body = {}; }
  const sessionToken = extractSessionToken(body);
  const jwt = extractJwt(body);
  if (!sessionToken && !jwt) {
    fail('Login failed for VU ' + __VU + ': ' + JSON.stringify(body).substring(0, 300));
  }
  // Archer's classic login API returns the session token in the JSON body
  // only — it does NOT set a real Set-Cookie itself, so the jar needs to be
  // seeded manually here. If a future/different login response DOES set real
  // cookies via Set-Cookie, those already landed in the jar automatically
  // (this request ran with { jar: jar }), making this a harmless no-op then.
  if (sessionToken && (!res.cookies || Object.keys(res.cookies).length === 0)) {
    jar.set(BASE_URL, '__ArcherSessionCookie__', sessionToken);
  }
  __vuAuth = { jwt: jwt };
  console.log('VU ' + __VU + ': Successfully authenticated as ' + cred.username + (jwt ? ' (session cookie + bearer JWT)' : ' (session cookie only)'));
  return __vuAuth;
}

// Call this after a request comes back 401 — the cached session (30-min token
// in Archer's case) may have expired mid-run. Clears the cache AND the VU's
// cookie jar before forcing a fresh login: the server responds to an
// unauthenticated/expired-session call by setting its OWN session-state
// cookie (e.g. archer_ngrx_*) to a "logged-out" value via Set-Cookie, and
// since every request runs through getVuJar()'s shared jar, that stale
// logged-out cookie would otherwise keep riding along next to the brand-new
// __ArcherSessionCookie__ on every subsequent request — the server sees the
// mismatch and immediately 401s again, forever. Wiping the jar for BASE_URL
// first guarantees the only cookie the next request carries is the fresh one
// this reauth() call is about to obtain.
function reauth() {
  __vuAuth = null;
  console.warn('VU ' + __VU + ': got 401 — re-authenticating.');
  const jar = getVuJar();
  const stale = jar.cookiesForURL(BASE_URL) || {};
  Object.keys(stale).forEach(function (name) {
    jar.set(BASE_URL, name, '', { expires: new Date(0).toUTCString() });
  });
  return ensureAuth();
}

Every exec function MUST call ensureAuth() at the very start of the iteration
(NOT in setup() — each VU logs in lazily on its own first iteration) and use
the resulting headers (only Authorization: Bearer, when the login returned a
JWT — Cookie is deliberately NOT part of authHeaders, see authHeadersFromAuth's
comment above) on every authenticated request:

export function <execFnName>() {
  const auth = ensureAuth();
  const authHeaders = authHeadersFromAuth(auth);
  // ... use authHeaders on every authenticated request below. On a 401, call
  // reauth() and retry that request once with authHeadersFromAuth(reauth()) —
  // see REPLAY HARNESS PATTERN's replayStep for the reference implementation.
}

Every authenticated request MUST wrap headers in a params object, spreading
authHeaders alongside any per-request headers (e.g. Content-Type), and MUST pass
\`jar: getVuJar()\` so the server's own session-state cookies flow through and
get replayed automatically (see getVuJar()'s comment above — skipping this is
what causes repeated 401s after the first reauth). Do NOT set Origin, Referer,
or User-Agent on any request — these headers must never be sent:

const params = {
  headers: { ...authHeaders, 'Content-Type': 'application/json' },
  tags: { name: '<RequestName>', endpoint_type: 'app' },
  jar: getVuJar(),
};
const res = http.post(url, payload, params);

Do NOT write a setup() login or share one session across VUs in this mode —
each VU authenticates independently the first time ensureAuth() runs for it.
setup() should still perform the InfluxDB bootstrap (ensureInfluxBucket(),
k6VusMax, testStartEnd 'started') exactly as shown in the InfluxDB block above,
just without any login logic.
`;
}

// Archer's GetModuleRecordAccess endpoint needs a header shape that diverges
// from every other authenticated call in the script (see the incident this
// codifies: a Postman replay of this exact call redirected to Default.aspx
// because the request carried the wrong/extra headers and a stale cookie).
// This block is appended whenever the test cases target that endpoint so
// Claude reproduces the two-header call and the resulting csrf-token capture
// exactly, instead of reusing the generic AUTHENTICATION PATTERN's headers.
export function buildModuleRecordAccessPatternBlock(): string {
  return `════════════════════════════════════════════════════════════════
GetModuleRecordAccess HEADER PATTERN — MANDATORY whenever a test case calls
.../api/internal/Permission/GetModuleRecordAccess. This endpoint's header
requirements are stricter than the generic AUTHENTICATION PATTERN above and
override it for this endpoint specifically.
════════════════════════════════════════════════════════════════

Every call to GetModuleRecordAccess MUST send EXACTLY these three headers —
no Accept, no other header from the generic pattern:

  Cookie:                 '__ArcherSessionCookie__=' + data.sessionToken
  x-http-method-override: 'GET'
  Content-Type:           'application/json'

data.sessionToken is the session token returned by the /api/security/login
call performed in setup() (see AUTHENTICATION PATTERN above) — do NOT scrape
or hardcode a session cookie value from the captured test case data; it will
be stale by the time the script runs.

const params = {
  headers: {
    Cookie: '__ArcherSessionCookie__=' + data.sessionToken,
    'x-http-method-override': 'GET',
    'Content-Type': 'application/json',
  },
  tags: { name: 'GetModuleRecordAccess', endpoint_type: 'app' },
};
const res = http.post(url, payload, params);

The response to THIS call carries the csrf token needed by every subsequent
authenticated request, in its 'csrf-token' response header — capture it into
a variable and thread it through as x-csrf-token on every later call. Do NOT
use a value hardcoded/captured from the test case data — it must be read from
THIS call's own response, every time the script runs:

const csrfToken = res.headers['csrf-token'] || res.headers['Csrf-Token'] || '';

x-archer-source IS MANDATORY on every OTHER classic Archer /api/* call (not
just GetModuleRecordAccess) whenever the test case data captured one for that
specific call — Archer's classic API gateway validates x-archer-source
ALONGSIDE the csrf token to authorize the request, and its value is
call-specific (e.g. "Archer,ConsumerResources" vs "Archer,Translations" vs
"Archer,Navigation" — never a fixed/shared constant across endpoints). Dropping
it produces a 403 "Forbidden: Access is denied" even though the session
cookie and csrf token are both valid — this is NOT an auth failure, so do not
mistake it for one and do not omit this header to "simplify" the request.
Copy it VERBATIM per-call from that exact request's captured headers in the
test case data — do NOT invent, reuse another call's value, or hardcode one:

// Every authenticated request AFTER this one — but not this call itself —
// MUST include x-csrf-token: csrfToken, and MUST include x-archer-source
// verbatim from THAT call's own captured headers (when the test case data
// has one for it) alongside its other headers:
const laterParams = {
  headers: { ...authHeaders, 'x-csrf-token': csrfToken, 'x-archer-source': '<verbatim from this call\\'s captured headers, if present>', 'Content-Type': 'application/json' },
  tags: { name: '<RequestName>', endpoint_type: 'app' },
};

CSRF REFRESH ON REAUTH IS MANDATORY. A csrf token is bound to the specific
session that produced it — the moment your reauth()/reauthenticate() helper
(see AUTHENTICATION PATTERN above — CSV pattern's reauth(), or the generic
pattern's reauthenticate()) obtains a NEW session after a 401/403, the OLD
csrfToken becomes invalid for it even though it still looks like a
normal-shaped token. Retrying the failed request with a (new session, old
csrf) pair gets rejected by Archer's classic /api/* gateway with a generic
IIS 403 "Forbidden: Access is denied" — NOT a 401 — so this is easy to
misdiagnose as a permissions problem rather than what it actually is: a
one-call-stale csrf token. Whichever reauth helper your AUTHENTICATION
PATTERN uses, it MUST re-issue the GetModuleRecordAccess call (with the
freshly reauthenticated session's headers) and re-capture csrfToken from its
response BEFORE the caller retries the original failed request:

// Inside reauth()/reauthenticate(), immediately after the new session is
// obtained (before returning it to the caller that will retry):
const csrfRes = http.post(BASE_URL + '<GetModuleRecordAccess captured path>', payload, {
  headers: { Cookie: '__ArcherSessionCookie__=' + newAuth.sessionToken, 'x-http-method-override': 'GET', 'Content-Type': 'application/json' },
  tags: { name: 'GetModuleRecordAccess (csrf-refresh)', endpoint_type: 'app' },
});
csrfToken = csrfRes.headers['csrf-token'] || csrfRes.headers['Csrf-Token'] || csrfToken;
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

// ────────────────────────────────────────────────────────────────────────────
// Captured-data placeholder splicing — shared by /api/har-generate (initial
// generation) and /api/ai-refine (iterative edits). Scripts produced from a HAR
// capture embed the replayed calls as literal LOGIN_REQUEST/CAPTURED_REQUESTS
// constants, which can be hundreds of KB for a large capture. Claude must never
// be asked to transcribe that data back out — it can't fit within any practical
// max_tokens budget and the response gets cut off mid-array, producing invalid
// JS that k6's goja engine reports opaquely as "export only allowed in global
// scope" or similar. Instead: strip the two constants out before prompting,
// have Claude work against a placeholder, then splice the real data back in.
export const DATA_PLACEHOLDER = '/*__PERFOPS_CAPTURED_DATA__*/';

// Placeholder for the CSV-based per-VU login credential pool (see
// buildCsvCredentialAuthPatternBlock above). The real rows — uploaded on the
// Executor page and cached in Postgres for the duration of the run — are
// spliced in right before dispatch, exactly like DATA_PLACEHOLDER above.
export const CREDENTIALS_PLACEHOLDER = '/*__PERFOPS_CREDENTIALS__*/';

export interface ScriptCredential {
  loginUrl: string;
  username: string;
  password: string;
  instanceName: string;
}

// Splices the real credential pool into a script containing
// `const CREDENTIALS = /*__PERFOPS_CREDENTIALS__*/[];`. Falls back to
// inserting right after the last top-level import if the placeholder comment
// is missing (e.g. a hand-written or older script) — same fallback strategy
// as injectCapturedData below.
export function injectCredentials(script: string, credentials: ScriptCredential[]): string {
  const arrayLiteral = JSON.stringify(credentials);
  if (script.includes(CREDENTIALS_PLACEHOLDER)) {
    return script.replace(`${CREDENTIALS_PLACEHOLDER}[]`, arrayLiteral)
                 .replace(CREDENTIALS_PLACEHOLDER, arrayLiteral);
  }
  const constLine = `const CREDENTIALS = ${arrayLiteral};`;
  const importRegex = /^import .*;\s*$/gm;
  let lastImportEnd = -1;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(script)) !== null) {
    lastImportEnd = match.index + match[0].length;
  }
  if (lastImportEnd === -1) return `${constLine}\n\n${script}`;
  return `${script.slice(0, lastImportEnd)}\n\n${constLine}\n${script.slice(lastImportEnd)}`;
}

// Splices the real captured-request data into a Claude-produced script. Prefers
// the placeholder Claude was told to leave; falls back to inserting right after
// the last top-level `import ...;` line if the placeholder is missing for any
// reason (e.g. Claude dropped it despite instructions).
export function injectCapturedData(script: string, dataBlock: string): string {
  if (script.includes(DATA_PLACEHOLDER)) {
    return script.replace(DATA_PLACEHOLDER, dataBlock);
  }
  const importRegex = /^import .*;\s*$/gm;
  let lastImportEnd = -1;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(script)) !== null) {
    lastImportEnd = match.index + match[0].length;
  }
  if (lastImportEnd === -1) return `${dataBlock}\n\n${script}`;
  return `${script.slice(0, lastImportEnd)}\n\n${dataBlock}\n${script.slice(lastImportEnd)}`;
}

// Finds the index of the `;` that terminates the value starting at `start`,
// tracking {}/[] nesting depth and skipping over quoted string contents (so
// braces/brackets/semicolons inside a captured payload string don't throw off
// the count). Returns -1 if no terminating `;` is found at depth 0.
function findStatementEnd(script: string, start: number): number {
  let i = start;
  const n = script.length;
  let depth = 0;
  while (i < n) {
    const c = script[i];
    if (c === '"' || c === '\'') {
      const quote = c;
      i++;
      while (i < n && script[i] !== quote) { if (script[i] === '\\') i++; i++; }
      i++;
      continue;
    }
    if (c === '{' || c === '[') { depth++; i++; continue; }
    if (c === '}' || c === ']') { depth--; i++; continue; }
    if (c === ';' && depth <= 0) return i;
    i++;
  }
  return -1;
}

// Extracts the verbatim `const LOGIN_REQUEST = ...;` and
// `const CAPTURED_REQUESTS = ...;` statements from a HAR-generated script (in
// whichever order they appear) and replaces them with DATA_PLACEHOLDER, so the
// stripped script can be safely sent to Claude for refinement without asking it
// to transcribe the captured data. Returns null if the script doesn't contain
// both constants (e.g. a plain /api/ai-generate script with no captured data).
export function extractCapturedData(script: string): { dataBlock: string; strippedScript: string } | null {
  const loginMatch = script.match(/const\s+LOGIN_REQUEST\s*=/);
  const reqMatch = script.match(/const\s+CAPTURED_REQUESTS\s*=/);
  if (!loginMatch || loginMatch.index === undefined || !reqMatch || reqMatch.index === undefined) return null;

  const loginSemi = findStatementEnd(script, loginMatch.index + loginMatch[0].length);
  const reqSemi = findStatementEnd(script, reqMatch.index + reqMatch[0].length);
  if (loginSemi === -1 || reqSemi === -1) return null;

  const stmts = [
    { start: loginMatch.index, end: loginSemi + 1 },
    { start: reqMatch.index, end: reqSemi + 1 },
  ].sort((a, b) => a.start - b.start);

  const dataBlock = stmts.map(s => script.slice(s.start, s.end)).join('\n');
  const firstStart = stmts[0].start;

  let stripped = script;
  for (const s of [...stmts].sort((a, b) => b.start - a.start)) {
    stripped = stripped.slice(0, s.start) + stripped.slice(s.end);
  }
  stripped = stripped.slice(0, firstStart) + DATA_PLACEHOLDER + '\n' + stripped.slice(firstStart);

  return { dataBlock, strippedScript: stripped };
}

// Same idea as extractCapturedData, but for the baked-in `const CREDENTIALS =
// [...]` array from CSV-based auth scripts. Without this, /api/ai-refine would
// send the real credential rows to Claude as plain text and ask it to
// reproduce them verbatim in its rewrite — risking the same truncation/typo
// hazard as captured requests, and unnecessarily exposing plaintext passwords
// in the prompt. Returns null if the script has no CREDENTIALS constant.
export function extractCredentials(script: string): { dataBlock: string; strippedScript: string } | null {
  const credMatch = script.match(/const\s+CREDENTIALS\s*=/);
  if (!credMatch || credMatch.index === undefined) return null;

  const credSemi = findStatementEnd(script, credMatch.index + credMatch[0].length);
  if (credSemi === -1) return null;

  const start = credMatch.index;
  const end = credSemi + 1;
  const dataBlock = script.slice(start, end);
  const stripped = script.slice(0, start) + `const CREDENTIALS = ${CREDENTIALS_PLACEHOLDER}[];` + script.slice(end);

  return { dataBlock, strippedScript: stripped };
}

// Splices a previously-extracted `const CREDENTIALS = [...]` statement back in.
export function injectCredentialsBlock(script: string, dataBlock: string): string {
  return script.replace(`const CREDENTIALS = ${CREDENTIALS_PLACEHOLDER}[];`, dataBlock);
}
