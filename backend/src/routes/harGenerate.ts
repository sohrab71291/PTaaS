import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import multer from 'multer';
import { parseHar } from '../services/harParser';
import {
  ParsedTestCase, isAuthEntry, isAuthHeader, toUrlPath,
} from '../services/k6FromTestCases';
import {
  buildInfluxBlock, buildCsvCredentialAuthPatternBlock, HANDLE_SUMMARY_BLOCK,
  DATA_PLACEHOLDER, injectCapturedData, injectCredentials,
} from '../services/k6PromptBlocks';
import { fetchScriptCredentials } from '../services/credentialStore';
import { isBraceBalanced } from '../services/k6ScriptValidator';
import {
  getAnthropicClient, hasAnthropicCredentials, isOverloadedError,
  CLAUDE_MODEL, MAX_STREAM_ATTEMPTS, STREAM_BACKOFF_MS, stripCodeFences,
} from '../services/anthropicClient';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = '.' + file.originalname.split('.').pop()?.toLowerCase();
    if (['.har', '.json'].includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${ext}. Allowed: .har, .json`));
  },
});

// Hard cap on the number of captured calls fed into the script — protects
// memory/prompt size on huge HAR captures. testCases beyond this are dropped
// with a warning rather than silently truncated without explanation. Since the
// captured data is injected as a literal (not hand-transcribed by Claude), this
// cap is generous — it's not fighting a token limit, just a sanity ceiling.
const MAX_CAPTURED_CALLS = 5000;

interface LoadProfileConfig {
  profileType: 'staged' | 'constant';
  stages?: { target: number; duration: string }[];
  constantVus?: number;
  constantDuration?: string;
}

interface ReplayRequest {
  name: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  payload: string | null;
  // 'form' means `payload` is a real {field: value} object (JSON-encoded) that
  // must be sent as application/x-www-form-urlencoded, not parsed as JSON body.
  payloadType: 'json' | 'form';
  expectedStatus: number;
  responseThresholdMs: number;
  // See k6FromTestCases.ts ParsedTestCase.producesVars / harParser.ts
  // applyIdCorrelation — path/payload may contain `{{token:capturedValue}}`
  // placeholders; producesVars tells the replay harness which JSON path in
  // THIS call's own response to re-extract the real value from at runtime.
  producesVars?: { token: string; jsonPath: string }[];
}

interface LoginRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  payload: string | null;
  payloadType: 'json' | 'form';
  cookieNameHint: string | null;
}

function stripAuthHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!isAuthHeader(k)) out[k] = v;
  }
  return out;
}

function toReplayRequest(tc: ParsedTestCase): ReplayRequest {
  return {
    name: tc.name,
    method: tc.method,
    path: toUrlPath(tc.url),
    headers: stripAuthHeaders(tc.headers),
    payload: tc.payload,
    payloadType: tc.payloadType ?? 'json',
    expectedStatus: tc.expectedStatus,
    responseThresholdMs: tc.responseThresholdMs,
    ...(tc.producesVars?.length ? { producesVars: tc.producesVars } : {}),
  };
}

function toLoginRequest(tc: ParsedTestCase, cookieNameHint: string | null): LoginRequest {
  return {
    method: tc.method,
    path: toUrlPath(tc.url),
    headers: { 'Content-Type': 'application/json', ...stripAuthHeaders(tc.headers) },
    payload: tc.payload,
    payloadType: tc.payloadType ?? 'json',
    cookieNameHint,
  };
}

function detectBaseUrl(testCases: ParsedTestCase[]): string | null {
  for (const tc of testCases) {
    try { return new URL(tc.url).origin; } catch { /* relative URL — keep scanning */ }
  }
  return null;
}

function describeLoadProfile(profile: LoadProfileConfig | null): string {
  if (!profile) {
    return `\nLOAD PROFILE — none was configured; use an environment-parameterized constant-VUs default rather than a hardcoded scenario, so the run can be resized without editing the script:
  const VUS = Number(__ENV.VUS) || 5;
  const DURATION = __ENV.DURATION || '1m';
- The scenario's executor must be 'constant-vus' with vus: VUS and duration: DURATION.\n`;
  }
  if (profile.profileType === 'constant') {
    return `\nMANDATORY LOAD PROFILE — the user explicitly configured this; use it exactly:
- Constant load: ${profile.constantVus ?? 10} VUs for ${profile.constantDuration ?? '1m'}.
- The scenario's executor must be 'constant-vus' with vus: ${profile.constantVus ?? 10} and duration: '${profile.constantDuration ?? '1m'}'.\n`;
  }
  const stages = profile.stages && profile.stages.length > 0
    ? profile.stages
    : [{ target: 10, duration: '2m' }, { target: 10, duration: '5m' }, { target: 0, duration: '1m' }];
  const stagesList = stages.map(s => `    { target: ${s.target}, duration: '${s.duration}' },`).join('\n');
  return `\nMANDATORY LOAD PROFILE — the user explicitly configured this; use it exactly:
- Ramping load with these exact stages (the scenario's executor must be 'ramping-vus' using this stages array verbatim):
  stages: [
${stagesList}
  ]\n`;
}

function buildHarSystemPrompt(baseUrl: string | null, loadProfile: LoadProfileConfig | null, totalCalls: number, hasLogin: boolean, useCsvCredentials: boolean): string {
  return `You are an expert performance engineer specializing in k6 load testing with InfluxDB v2 integration. You are writing a REPLAY HARNESS for a captured browser session (HAR export) — a small, fixed amount of code that iterates generically over an already-extracted array of API calls. You do NOT write one code block per captured call; the calls themselves are supplied to you as a runtime data array, not something you transcribe.
${describeLoadProfile(loadProfile)}
LOGIN_REQUEST and CAPTURED_REQUESTS are constants that will be injected into your script automatically — do NOT declare or redeclare them yourself, do NOT attempt to enumerate, copy, or transcribe their contents. Their shapes are:
  LOGIN_REQUEST: ${useCsvCredentials
    ? `null — login credentials come from an uploaded CSV pool instead (see CSV-BASED PER-VU CREDENTIALS below); the captured session's own login call, if any, is excluded from CAPTURED_REQUESTS and unused.`
    : hasLogin ? `{ method: string, path: string, headers: object, payload: string|null, payloadType: 'json'|'form', cookieNameHint: string|null } — a single detected login/auth call` : `null — no login/auth call was detected in the captured session`}
  CAPTURED_REQUESTS: Array<{ name: string, method: string, path: string, headers: object, payload: string|null, payloadType: 'json'|'form', expectedStatus: number, responseThresholdMs: number, producesVars?: Array<{ token: string, jsonPath: string }> }> — the ${totalCalls} non-login calls to replay, in the order they were captured.
  payloadType 'form' means payload is a JSON-encoded {field: value} object that was originally submitted as application/x-www-form-urlencoded — it MUST be sent as a real form body (see requestBody() helper in the REPLAY HARNESS PATTERN below), never re-encoded as JSON.

  ID CORRELATION — some captured sessions are stateful CRUD flows: a POST/PUT creates or mutates a resource and a LATER captured call references that exact id in ITS path or payload (e.g. a created content id showing up in a later /contents/{id}/fields call). Replaying such a flow with the bare capture-time id verbatim drifts the moment that id no longer exists (a fresh run creates a different id; an earlier run's own DELETE removed it) — the entire downstream chain fails even though the flow itself is fine. To avoid this, any entry's \`path\`/\`payload\` may contain a \`__CORR_<token>_<capturedValue>__\` placeholder (this exact underscore-delimited format, never \`{{...}}\` — curly braces get corrupted by k6's URL handling) in place of a literal id, and the call that PRODUCES that value is tagged with \`producesVars: [{ token, jsonPath }]\`. You MUST implement the correlation exactly as shown in the REPLAY HARNESS PATTERN below (substituteCorrelationVars() / getByJsonPath(), correlationVars scoped fresh per iteration inside sessionReplay — never module-level/shared across VUs, since each VU/iteration creates and must reference its OWN resources): resolve placeholders from values actually extracted from that VU's own prior responses this iteration, falling back to the captured literal only if extraction failed.

MANDATORY RULES — every rule must be followed exactly:
1. Output ONLY valid JavaScript — no markdown, no code fences, no explanation text.
2. Structure, in this exact order: (a) imports — http from 'k6/http', { check, group, sleep } from 'k6', metrics from 'k6/metrics', textSummary from the jslib summary URL; (b) the single line ${DATA_PLACEHOLDER} on its own line, verbatim, immediately after the imports — this is where the real captured-request data gets spliced in; (c) the InfluxDB v2 integration block shown below, word for word; (d) the REPLAY HARNESS PATTERN shown below; (e) handleSummary.
3. Use __ENV.BASE_URL for all request base URLs, defaulting to ${baseUrl ? `'${baseUrl}' (this is the origin the captured calls were made against — do NOT use localhost)` : `'http://localhost:3000'`}.
4. Do NOT write a separate function or group() per captured call. Write exactly the generic replayStep()/sessionReplay() functions shown in the REPLAY HARNESS PATTERN below — they already iterate over every entry in CAPTURED_REQUESTS, which guarantees complete coverage without you needing to enumerate anything.
5. Declare 'export const options = { scenarios: {...}, thresholds: {...} };' EXACTLY ONCE in the whole script, using 'const' (never 'let'/'var'), immediately after imports — a script with more than one export named 'options' (regardless of declaration keyword) fails to load at all with "Duplicate export name 'options'" before a single request runs. Put scenarios AND thresholds in that single object literal; never declare a second 'options' block later to add thresholds or anything else, and never reassign/mutate 'options' after the fact as a substitute for getting the first declaration right. SCENARIO_MAX_VUS must be computed robustly across executor types (constant-vus uses vus, ramping-vus uses stages targets, arrival-rate executors use preAllocatedVUs/maxVUs) using Math.max and ?? (not ||):
  const SCENARIO_MAX_VUS = Math.max(
    ...Object.values(options.scenarios).flatMap(s => [
      s.vus ?? 0,
      s.maxVUs ?? 0,
      s.preAllocatedVUs ?? 0,
      ...((s.stages || []).map(st => st.target ?? 0)),
    ]),
    1
  );
6. Use ?? instead of || when the right-hand side is a fallback for null/undefined.
7. handleSummary must output ONLY stdout — do NOT write any file (no summary.json).
8. Pick a descriptive TEST_NAME and SCENARIO_NAME based on the nature of the captured session (e.g. inferred from the request paths), and set options.thresholds to sensible defaults (p(95)<1000, http_req_failed rate<0.8, checks rate>0.9) unless told otherwise above. http_req_failed stays lenient only as a run-abort guardrail against catastrophic failure; the real per-step pass/fail signal comes from the isResponseStatusExpected()-based check() in replayStep below, not from this blanket threshold. The checks threshold IS the strict signal — it's based on the same per-step check() calls, so it must stay meaningfully tighter than http_req_failed (e.g. checks rate>0.9 vs http_req_failed rate<0.8): a run should not report PASS while a large fraction of individual steps are functionally failing.
9. The InfluxDB block below already declares isResponseStatusExpected(response, expectedStatus) — reuse it verbatim in replayStep's check()/error-logging. Do not redeclare it. It NEVER treats 401/403 as expected — a real auth failure must always count against http_req_failed/checks/errorRate, not be silently absorbed. On top of it, replayStep below also reuses isKnownBenignNotFound(reqDef, response) (see REPLAY HARNESS PATTERN) to tolerate specific endpoints that legitimately 404 depending on environment/record state (advanced-workflow-configuration, release_lock/release-lock), and isIdempotentDeleteOutcome(reqDef, response) to tolerate a replayed DELETE landing on 404/409 (already-deleted/conflicting-delete) — do not remove or narrow either allowance, and do not extend either to 401/403.
10. ALWAYS include the closing 'export default function (setupData) { sessionReplay(setupData); }' shown at the end of the REPLAY HARNESS PATTERN, even though the scenario's own exec already names sessionReplay. It is a required safety net: a k6 script with no exported function at all fails to start with an opaque error instead of running.
${useCsvCredentials
    ? `11. Login credentials come from an uploaded CSV pool (one login per VU) — see the CSV-BASED PER-VU CREDENTIALS pattern below. This is MANDATORY: do not use LOGIN_REQUEST or any setup()-based shared login for this script; every VU authenticates independently via ensureAuth() the first time sessionReplay() runs for it. Reproduce getVuCredential()/ensureAuth()/reauth()/extractJwt()/authHeadersFromAuth() verbatim, including the REQUIRED InstanceName field in the login payload — do not simplify, rename, or omit it.
12. setup() must NEVER throw — it only performs the InfluxDB bootstrap; it does not attempt any login and does not create/return a cookie jar in this mode (each VU gets its own lazily via getVuJar() — see rule 14).`
    : `11. Detect the login/auth call with the findLoginRequest() helper shown below (LOGIN_REQUEST if present, else the first CAPTURED_REQUESTS entry whose name/path mentions login/auth/signin, else none) — call it identically in both setup() and sessionReplay() so both agree on which entry is "the login" and which entries are ordinary replay steps. Never fall back to blindly treating CAPTURED_REQUESTS[0] as the login — an arbitrary first request (e.g. a homepage GET) is not necessarily auth-related.
12. setup() must NEVER throw when authentication doesn't yield a session — log a warning and return null so the run continues without auth headers instead of aborting the whole test. A broken/expired captured login must degrade to "requests run unauthenticated" (surfacing as REAL 401/403 failures per rule 9, not silently tolerated ones), not stop execution entirely. Reproduce ensureAuth()/reauth()/extractSessionToken()/extractJwt()/authHeadersFromAuth() from the REPLAY HARNESS PATTERN below verbatim — the single captured login still runs once in setup() to avoid a login stampede, but each VU independently re-runs it via reauth() if and when ITS session actually expires (see rule 15), rather than every VU sharing one session/cookie for the whole run indefinitely.`}
13. ID CORRELATION is MANDATORY, not optional — reproduce getByJsonPath()/substituteCorrelationVars() from the REPLAY HARNESS PATTERN below verbatim, declare \`const correlationVars = {};\` fresh at the top of sessionReplay() (a new empty object every iteration — never module-level), pass it into every replayStep() call, resolve \`__CORR_<token>_<literal>__\` placeholders in each request's path/payload against it before sending, and — for any entry with a non-empty producesVars — extract each token's real value from that entry's own response via getByJsonPath() immediately after it runs, storing it into correlationVars so later steps in the SAME iteration pick up the freshly created resource's real id instead of the stale capture-time literal.
14. Every VU must use its own cookie jar, never one shared object handed down from setup() — reproduce getVuJar() from the REPLAY HARNESS PATTERN below verbatim and call it in sessionReplay(); do NOT read a jar off setupData.
15. RE-AUTH ON 401/403 is MANDATORY — reproduce replayStep exactly as shown in the REPLAY HARNESS PATTERN below: on a 401 OR 403 response, call reauth() once, rebuild the request's auth headers from the result, and retry the SAME request exactly once before falling through to normal check()/metrics/error-logging on whichever response (original or retried) is now current. Never retry more than once per step — a second consecutive 401/403 is a real failure, not a transient token expiry.
16. Per-request response-time checks must use effectiveResponseThreshold(reqDef) (see REPLAY HARNESS PATTERN), NEVER the raw reqDef.responseThresholdMs directly — a single captured HAR sample under no concurrent load is not a reliable per-request SLA under real replay load, and using it verbatim produces noisy false-positive check failures unrelated to actual regressions.

${buildInfluxBlock(baseUrl)}
${useCsvCredentials ? buildCsvCredentialAuthPatternBlock() : ''}
════════════════════════════════════════════════════════════════
REPLAY HARNESS PATTERN — MANDATORY. Reproduce this pattern, adapting only
TEST_NAME/SCENARIO_NAME/options to the captured session. Do not deviate from
this structure — it is deliberately generic so it works regardless of how many
calls were captured.
════════════════════════════════════════════════════════════════

Write these helpers once, before setup(). Both JSON.parse calls MUST be
try/catch-wrapped — a captured payload or response body that isn't valid JSON
must never throw, since an uncaught exception here aborts the whole VU
iteration with a hard k6 execution error instead of a normal check failure:

function requestBody(payload, payloadType) {
  if (!payload) return null;
  if (payloadType === 'form') {
    // 'form' payloads are JSON-encoded {field: value} objects — pass the
    // parsed object itself (k6 auto-urlencodes object bodies), never a JSON
    // string. Fall back to the raw string if it somehow isn't valid JSON
    // rather than throwing and killing the iteration.
    if (typeof payload === 'string') {
      try {
        return JSON.parse(payload);
      } catch (e) {
        return payload;
      }
    }
    return payload;
  }
  return payload;
}

function sanitizeHeaders(headers) {
  // Captured HAR headers include content-length/transfer-encoding computed for
  // the ORIGINAL request. Replaying them verbatim can desync from the actual
  // body k6 sends and cause the server to hang or reject the request outright.
  // k6 computes these itself — strip them, along with any empty/null values.
  const sanitized = {};
  if (!headers) return sanitized;
  Object.keys(headers).forEach(function (name) {
    const value = headers[name];
    if (value === undefined || value === null || String(value).trim() === '') return;
    const normalizedName = String(name).toLowerCase();
    if (normalizedName === 'content-length' || normalizedName === 'transfer-encoding') return;
    sanitized[name] = value;
  });
  return sanitized;
}

function getResponseBody(response) {
  if (!response || !response.body) return {};
  try {
    return response.json();
  } catch (e) {
    return {};
  }
}

// Reads a dotted path ("RequestedObject.Id") out of a parsed response body.
// Never throws — a shape mismatch (e.g. the API changed) just yields
// undefined, which substituteCorrelationVars() below falls back from.
function getByJsonPath(obj, jsonPath) {
  if (!obj || !jsonPath) return undefined;
  return jsonPath.split('.').reduce(function (acc, key) {
    return (acc === undefined || acc === null) ? undefined : acc[key];
  }, obj);
}

// Resolves every __CORR_<token>_<capturedLiteral>__ placeholder in a
// path/payload string against this iteration's correlationVars — using the
// value actually extracted from an earlier response in THIS iteration when
// available, otherwise falling back to the captured literal embedded in the
// placeholder itself (e.g. because extraction failed or this VU hasn't run
// the producing step yet). Never throws.
function substituteCorrelationVars(text, correlationVars) {
  if (!text) return text;
  return text.replace(/__CORR_([A-Za-z0-9]+)_(\d+)__/g, function (match, token, fallbackLiteral) {
    const resolved = correlationVars ? correlationVars[token] : undefined;
    return (resolved !== undefined && resolved !== null && resolved !== '') ? String(resolved) : fallbackLiteral;
  });
}

// After a request that produces correlated values runs, pulls each one out of
// its own response body and stores it in correlationVars for later steps in
// the same iteration. Never throws — a missing/renamed field just means later
// steps fall back to the captured literal via substituteCorrelationVars above.
function captureCorrelationVars(reqDef, response, correlationVars) {
  if (!reqDef.producesVars || reqDef.producesVars.length === 0) return;
  const body = getResponseBody(response);
  reqDef.producesVars.forEach(function (v) {
    const value = getByJsonPath(body, v.jsonPath);
    if (value !== undefined && value !== null) {
      correlationVars[v.token] = value;
      console.log('VU ' + __VU + ': captured runtime id ' + value + ' from ' + reqDef.name + ' (' + v.jsonPath + ') -> ' + v.token);
    }
  });
}

// Some endpoints are known to legitimately 404 depending on environment/record
// state rather than because the replay drifted — e.g. an advanced workflow
// configuration that isn't defined for a given level, or a record lock that's
// already released by the time this step runs. Treat those as expected instead
// of flagging every replay as a hard failure.
function isKnownBenignNotFound(reqDef, response) {
  if (response.status !== 404) return false;
  const p = String(reqDef.path || '').toLowerCase();
  return p.indexOf('advanced-workflow-configuration') !== -1
    || p.indexOf('release_lock') !== -1
    || p.indexOf('release-lock') !== -1;
}

// A replayed DELETE can legitimately land on 404 (already gone — e.g. a prior
// retry, or a run that replayed the same correlated id twice) or 409 (a
// conflicting concurrent delete/lock) without that being a real failure —
// DELETE is idempotent by nature, so "the thing is already deleted" is a
// success outcome, not a regression.
function isIdempotentDeleteOutcome(reqDef, response) {
  if (String(reqDef.method || '').toUpperCase() !== 'DELETE') return false;
  return response.status === 404 || response.status === 409;
}

// Captured HAR timings reflect ONE real user's single request, often 500ms —
// too tight a bar to hold replay traffic to under concurrent load without
// generating noisy false-positive check failures unrelated to real
// regressions. Floor every per-request threshold at a stable minimum instead
// of trusting the raw captured value verbatim.
const RESPONSE_THRESHOLD_FLOOR_MS = 1000;
function effectiveResponseThreshold(reqDef) {
  return Math.max(reqDef.responseThresholdMs, RESPONSE_THRESHOLD_FLOOR_MS);
}

function buildCookieHeader(response, fallbackToken, loginRequest) {
  // Prefer real Set-Cookie cookies from the login response (k6 exposes these
  // on response.cookies regardless of the VU cookie jar) — this is what a
  // browser would actually send. Fall back to a cookie built from the
  // extracted token using cookieNameHint (or 'session') so cookie-based
  // session APIs still work when the token only appears in the JSON body.
  const cookieParts = [];
  if (response && response.cookies) {
    Object.keys(response.cookies).forEach(function (cookieName) {
      const cookie = response.cookies[cookieName][0];
      if (cookie) cookieParts.push(cookieName + '=' + cookie.value);
    });
  }
  if (cookieParts.length === 0 && fallbackToken) {
    cookieParts.push((loginRequest && loginRequest.cookieNameHint ? loginRequest.cookieNameHint : 'session') + '=' + fallbackToken);
  }
  return cookieParts.join('; ');
}

Write this helper once, before setup() too — k6's setup() runs ONCE for the
whole test, so a CookieJar created there and handed to every VU via setupData
is the exact same mutable object shared by every VU: one VU's response can
silently populate cookies another VU's requests then pick up. Give every VU
its own jar instead, created lazily on first use (module scope is per-VU in
k6, so this cache is automatically isolated — no keying by __VU needed):

let __vuJar = null;
function getVuJar() {
  if (!__vuJar) __vuJar = http.cookieJar();
  return __vuJar;
}

Write this helper once, before setup() — it decides which single entry counts
as "the login" for BOTH setup() and sessionReplay() below. Call it identically
in both places (never recompute this differently in each function, and never
fall back to blindly treating CAPTURED_REQUESTS[0] as the login — an arbitrary
first request, e.g. a homepage GET, is not necessarily auth-related):

function findLoginRequest(requests) {
  if (!requests || requests.length === 0) return null;
  if (LOGIN_REQUEST) return LOGIN_REQUEST;
  const loginCandidates = requests.filter(function (reqDef) {
    const name = String(reqDef.name || '').toLowerCase();
    const path = String(reqDef.path || '').toLowerCase();
    return name.includes('login') || name.includes('auth') || name.includes('signin') || path.includes('login') || path.includes('auth') || path.includes('signin');
  });
  return loginCandidates[0] || null;
}

${useCsvCredentials ? `Login credentials come from the uploaded CSV pool (see CSV-BASED PER-VU
CREDENTIALS above), NOT from the captured session — setup() below only does the
InfluxDB bootstrap. Do NOT attempt any login here, and do NOT create/return a
cookie jar here either — each VU gets its own lazily via getVuJar() above, so
one VU's cookies never leak into another's requests:

export function setup() {
  if (INFLUX_V2_ENABLED) { ensureInfluxBucket(); }
  k6VusMax.add(SCENARIO_MAX_VUS, { testid: TEST_ID });
  const ts = String(Date.now()) + '000000';
  writeInfluxLines([
    'testStartEnd,' + buildInfluxTagSet({ runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, type: 'started' }) + ' value=1i ' + ts,
    'k6_vus_max,testid=' + escapeTagValue(TEST_ID) + ' value=' + SCENARIO_MAX_VUS + 'i ' + ts,
  ]);
  return null;
}` : `Write these helpers once, before setup() — the classic session cookie
(SessionToken -> __ArcherSessionCookie__, or equivalent) does NOT necessarily
authenticate every API surface (e.g. a separate /ngrx/* Angular API commonly
expects its own bearer JWT instead of/in addition to the cookie) — extract
BOTH defensively from the login response, whichever are actually present:

function extractSessionToken(body) {
  return (body && ((body.RequestedObject && body.RequestedObject.SessionToken) ||
    body.access_token || body.token || body.sessionToken ||
    (body.data && body.data.token) || (body.data && body.data.access_token))) || '';
}
function extractJwt(body) {
  if (!body) return '';
  return (
    (body.RequestedObject && (body.RequestedObject.Jwt || body.RequestedObject.AccessToken)) ||
    body.Jwt || body.jwt || body.AccessToken || ''
  );
}
function authHeadersFromAuth(auth) {
  const headers = {};
  if (auth && auth.cookieHeader) headers.Cookie = auth.cookieHeader;
  if (auth && auth.jwt) headers.Authorization = 'Bearer ' + auth.jwt;
  return headers;
}

Merge the login handling into the setup() shown above (do not write a second
setup()) — after the InfluxDB bootstrap lines. This performs the ONE captured
login network call up front (avoids a login stampede when many VUs ramp up in
parallel — there's only one set of captured credentials to log in with anyway),
but do NOT create or return a cookie jar here: a jar created in setup() is the
exact same mutable object handed to every VU via setupData, so one VU's
responses would silently populate cookies another VU's requests then pick up.
Each VU gets its own jar lazily via getVuJar() (declared above) instead —
only the resulting cookieHeader/jwt (immutable strings, safe to share) are
threaded through setupData. Use findLoginRequest() to find the login call — if
it returns null, there is genuinely nothing to authenticate with, so log that
and continue:

export function setup() {
  if (INFLUX_V2_ENABLED) { ensureInfluxBucket(); }
  k6VusMax.add(SCENARIO_MAX_VUS, { testid: TEST_ID });
  const ts = String(Date.now()) + '000000';
  writeInfluxLines([
    'testStartEnd,' + buildInfluxTagSet({ runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, type: 'started' }) + ' value=1i ' + ts,
    'k6_vus_max,testid=' + escapeTagValue(TEST_ID) + ' value=' + SCENARIO_MAX_VUS + 'i ' + ts,
  ]);

  const effectiveLoginRequest = findLoginRequest(CAPTURED_REQUESTS);
  if (!effectiveLoginRequest) {
    console.log('Setup: no login/auth request found; continuing without authentication.');
    return null;
  }

  const res = http.request(
    effectiveLoginRequest.method,
    BASE_URL + effectiveLoginRequest.path,
    requestBody(effectiveLoginRequest.payload, effectiveLoginRequest.payloadType),
    {
      headers: sanitizeHeaders(effectiveLoginRequest.headers),
      redirects: 5,
      tags: { name: effectiveLoginRequest.name || effectiveLoginRequest.path },
    }
  );

  const body = getResponseBody(res);
  const sessionToken = extractSessionToken(body);
  const jwt = extractJwt(body);
  const cookieHeader = buildCookieHeader(res, sessionToken, effectiveLoginRequest);

  // NEVER throw here, even when the login produced nothing usable — a broken
  // or expired captured login must degrade to "requests run unauthenticated"
  // (later calls will now correctly surface as REAL 401/403 failures — see
  // isResponseStatusExpected — instead of stopping the whole run before any
  // other request gets a chance to execute).
  if (!cookieHeader && !jwt && !(res.status >= 300 && res.status < 400)) {
    console.warn('Setup: authentication request returned no session data; continuing without auth headers.');
    return null;
  }

  console.log('Setup: authentication completed with status ' + res.status + '.' + (jwt ? ' (session cookie + bearer JWT)' : ''));
  return { cookieHeader: cookieHeader, jwt: jwt };
}

Write these two helpers once, before setup() — every VU starts from the ONE
shared login setup() already performed (no extra network calls if that session
stays valid all run), but each VU independently refreshes ITS OWN copy the
moment its session actually expires, via reauth() (see replayStep's 401 retry
below) — never a second run-wide relogin shared by every VU:

let __vuAuth = null; // per-VU cache — module scope is per-VU in k6, so this is NOT shared across VUs
function ensureAuth(setupData) {
  if (__vuAuth) return __vuAuth;
  __vuAuth = (setupData && (setupData.cookieHeader || setupData.jwt))
    ? { cookieHeader: setupData.cookieHeader || '', jwt: setupData.jwt || '' }
    : { cookieHeader: '', jwt: '' };
  return __vuAuth;
}
function reauth() {
  console.warn('VU ' + __VU + ': got 401 — re-authenticating.');
  const effectiveLoginRequest = findLoginRequest(CAPTURED_REQUESTS);
  if (!effectiveLoginRequest) {
    __vuAuth = { cookieHeader: '', jwt: '' };
    return __vuAuth;
  }
  const res = http.request(
    effectiveLoginRequest.method,
    BASE_URL + effectiveLoginRequest.path,
    requestBody(effectiveLoginRequest.payload, effectiveLoginRequest.payloadType),
    { headers: sanitizeHeaders(effectiveLoginRequest.headers), redirects: 5, tags: { name: 'Reauth' } }
  );
  const body = getResponseBody(res);
  const sessionToken = extractSessionToken(body);
  const jwt = extractJwt(body);
  __vuAuth = { cookieHeader: buildCookieHeader(res, sessionToken, effectiveLoginRequest), jwt: jwt };
  console.log('VU ' + __VU + ': re-authenticated (status ' + res.status + ').');
  return __vuAuth;
}`}

Write exactly ONE generic step-executor function — it is called once per entry
in CAPTURED_REQUESTS, so it must not reference any specific captured call. Reuse
isResponseStatusExpected(response, expectedStatus) from the InfluxDB block above
instead of a strict === comparison — replayed sessions can legitimately land on
a matching-class redirect, but NEVER on a 401/403 (see isResponseStatusExpected's
own comment — those must always surface as real failures) — and layer
isKnownBenignNotFound() (above) on top of it for the specific endpoints that
legitimately 404 depending on environment/record state.
correlationVars (see ID CORRELATION above and getByJsonPath/substituteCorrelationVars/
captureCorrelationVars helpers above) MUST be threaded through here — resolve
placeholders in path/payload before sending, then capture this step's own
produced values after the response comes back.
RE-AUTH ON 401 is MANDATORY (rule 15) — build auth headers via ensureAuth()${useCsvCredentials ? '' : '(setupData)'}/authHeadersFromAuth() fresh for every request (not once per iteration — a cached auth object can be replaced mid-iteration by reauth()), and on a 401 call reauth() and retry the SAME request exactly once with the refreshed headers before falling through to normal check()/metrics/error-logging:

function replayStep(reqDef, jar, ${useCsvCredentials ? '' : 'setupData, '}correlationVars) {
  const path = substituteCorrelationVars(reqDef.path, correlationVars);
  const payload = substituteCorrelationVars(reqDef.payload, correlationVars);
  const url = BASE_URL + path;

  function doRequest(authHeaders) {
    const params = {
      headers: Object.assign({}, sanitizeHeaders(reqDef.headers), authHeaders),
      redirects: 5,
      tags: { name: reqDef.name },
      jar: jar,
    };
    return http.request(reqDef.method, url, requestBody(payload, reqDef.payloadType), params);
  }

  let auth = ensureAuth(${useCsvCredentials ? '' : 'setupData'});
  let res = doRequest(authHeadersFromAuth(auth));

  // A 30-min (or otherwise time-limited) token can expire mid-run — a bare
  // 401/403 here doesn't necessarily mean the whole flow is broken, just that
  // THIS VU's cached session needs refreshing. Retry exactly once with a fresh
  // session; a SECOND 401/403 after that is a real failure and falls through
  // normally (isResponseStatusExpected never treats 401/403 as expected).
  if (res.status === 401 || res.status === 403) {
    auth = reauth();
    res = doRequest(authHeadersFromAuth(auth));
  }

  // A captured call that 404s on a known-benign endpoint (see
  // isKnownBenignNotFound above), or a DELETE that 404s/409s because the
  // resource is already gone (see isIdempotentDeleteOutcome above), is
  // treated as expected for THIS response only — it does not change reqDef
  // itself, so unrelated failures on the same endpoint shape still fail normally.
  const effectiveExpectedStatus = isKnownBenignNotFound(reqDef, res) ? 404
    : isIdempotentDeleteOutcome(reqDef, res) ? res.status
    : reqDef.expectedStatus;

  const responseThresholdMs = effectiveResponseThreshold(reqDef);
  check(res, {
    [reqDef.name + ' status is ' + reqDef.expectedStatus]: function (r) { return isResponseStatusExpected(r, effectiveExpectedStatus); },
    [reqDef.name + ' response time < ' + responseThresholdMs + 'ms']: function (r) { return r.timings.duration < responseThresholdMs; },
  });

  recordCustomMetrics(res, SCENARIO_NAME, reqDef.name, path, getByteLength(payload || ''), reqDef.name, effectiveExpectedStatus);

  if (res.status >= 400 && !isResponseStatusExpected(res, effectiveExpectedStatus)) {
    const responseBody = String(res.body || '').substring(0, 800);
    const responseHeaders = JSON.stringify(res.headers || {});
    console.error(reqDef.name + ' failed: ' + res.status + ' body=' + responseBody + ' headers=' + responseHeaders);
  }

  captureCorrelationVars(reqDef, res, correlationVars);
}

Write exactly ONE exported iteration function — this is the scenario's exec
function. It loops over the injected CAPTURED_REQUESTS array (do not write any
other exec function, and do not unroll this loop). Reuse the cookie jar from
setup() so cookies set by replay steps carry forward.${useCsvCredentials ? '' : ` Call
findLoginRequest() again (same helper, same result) to exclude that exact entry
from replay — it already ran once in setup(). Do NOT substitute a different
heuristic here (e.g. CAPTURED_REQUESTS[0]): setup() and sessionReplay() must
agree on exactly which entry is "the login", or the login step ends up replayed
twice while an unrelated entry is silently dropped:`} Use getVuJar() (declared
above), NOT setupData.jar — every VU needs its own cookie jar, not the one
mutable object setup() would otherwise hand to all of them (see getVuJar()
comment above for why). Do NOT build a static authHeaders object here — pass
${useCsvCredentials ? 'jar' : 'jar and setupData'} straight through to replayStep, which resolves fresh auth headers per
request itself (via ensureAuth()${useCsvCredentials ? '' : '(setupData)'}) so a mid-iteration reauth() from a 401 retry is
picked up by every subsequent step, not just the one that triggered it:

export function sessionReplay(setupData) {
  const jar = getVuJar();
  const _ts = String(Date.now()) + '000000';
  k6IterationsTotal.add(1, { testid: TEST_ID, scenario: SCENARIO_NAME });
  k6Vus.add(1, { testid: TEST_ID, scenario: SCENARIO_NAME, vu: String(__VU) });
  writeInfluxLines([
    'k6_iterations_total,testid=' + escapeTagValue(TEST_ID) + ',scenario=' + escapeTagValue(SCENARIO_NAME) + ' value=1i ' + _ts,
    'k6_vus,testid=' + escapeTagValue(TEST_ID) + ',scenario=' + escapeTagValue(SCENARIO_NAME) + ',vu=' + escapeTagValue(__VU) + ' value=1 ' + _ts,
    'virtualUsers,' + buildInfluxTagSet({ runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, scenario: SCENARIO_NAME }) + ' meanActiveThreads=1,finishedThreads=' + __ITER + ' ' + _ts,
  ]);
${useCsvCredentials ? `
  const replayRequests = CAPTURED_REQUESTS;` : `
  const effectiveLoginRequest = findLoginRequest(CAPTURED_REQUESTS);
  const replayRequests = effectiveLoginRequest
    ? CAPTURED_REQUESTS.filter(function (reqDef) {
        return !(reqDef.name === effectiveLoginRequest.name && reqDef.method === effectiveLoginRequest.method && reqDef.path === effectiveLoginRequest.path);
      })
    : CAPTURED_REQUESTS;`}

  // Fresh every iteration — NEVER module-level/shared across VUs. Each
  // iteration replays its own independent session and must correlate its
  // OWN created resources, not another VU's (see ID CORRELATION above).
  const correlationVars = {};

  for (let i = 0; i < replayRequests.length; i++) {
    const reqDef = replayRequests[i];
    group(reqDef.name, function () {
      replayStep(reqDef, jar, ${useCsvCredentials ? '' : 'setupData, '}correlationVars);
    });
    sleep(1);
  }
}

MANDATORY — always close the pattern with a default export that delegates to
sessionReplay, even though the scenario's exec already names it by name. This
is a required safety net: a k6 script with no exported function at all refuses
to start (a hard error before any request runs), rather than failing normally:

export default function (setupData) {
  sessionReplay(setupData);
}

════════════════════════════════════════════════════════════════

${HANDLE_SUMMARY_BLOCK}
Generate the k6 replay harness now. Output ONLY JavaScript, starting with the first import line.`;
}

function safeParseJson(content: string): unknown | null {
  try { return JSON.parse(content); } catch { return null; }
}

async function streamHarness(
  baseUrl: string | null,
  loadProfile: LoadProfileConfig | null,
  totalCalls: number,
  hasLogin: boolean,
  useCsvCredentials: boolean,
  userMessage: string,
  sendEvent: (type: string, data: any) => void,
): Promise<string> {
  let stream: Awaited<ReturnType<Anthropic['messages']['stream']>> | null = null;
  for (let attempt = 0; attempt < MAX_STREAM_ATTEMPTS; attempt++) {
    try {
      stream = await getAnthropicClient().messages.stream({
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        system: buildHarSystemPrompt(baseUrl, loadProfile, totalCalls, hasLogin, useCsvCredentials),
        messages: [{ role: 'user', content: userMessage }],
      });
      break;
    } catch (err: any) {
      if (isOverloadedError(err) && attempt < MAX_STREAM_ATTEMPTS - 1) {
        sendEvent('status', { message: `Claude is currently overloaded — retrying (${attempt + 1}/${MAX_STREAM_ATTEMPTS - 1})…` });
        await new Promise(r => setTimeout(r, STREAM_BACKOFF_MS[attempt]));
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
  return stripCodeFences(fullScript);
}

// POST /api/har-generate — streaming SSE endpoint. Accepts one or more .har /
// .json files (field name "files"). HAR-shaped files are parsed with the
// structured parser (dedupe disabled, so every captured call survives); non-HAR
// .json files are passed through as raw supplementary context. The backend
// deterministically splits the login call from the rest and injects both as
// literal data into the script Claude writes — Claude never hand-transcribes
// the captured calls, which is what made large captures prone to truncation or
// brace-mismatch syntax errors ("export only allowed in global scope").
router.post('/har-generate', upload.any(), async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];

  if (!hasAnthropicCredentials()) {
    res.status(500).json({
      error: 'Anthropic API credentials not configured. Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in backend/.env or as an environment variable.',
    });
    return;
  }

  if (files.length === 0) {
    res.status(400).json({ error: 'No files uploaded. Use multipart/form-data with field name "files".' });
    return;
  }

  let loadProfile: LoadProfileConfig | null = null;
  try { loadProfile = req.body.loadProfile ? JSON.parse(req.body.loadProfile) : null; } catch { /* ignore */ }
  const useCsvCredentials = req.body.useCsvCredentials === true || req.body.useCsvCredentials === 'true';
  const credentialBatchId: string | undefined = req.body.credentialBatchId;

  let csvCredentials: Awaited<ReturnType<typeof fetchScriptCredentials>> = [];
  if (useCsvCredentials) {
    if (typeof credentialBatchId !== 'string' || !credentialBatchId.trim()) {
      res.status(422).json({
        error: 'CSV-based credentials were requested but no credential batch was uploaded. Upload a login credentials CSV before generating the script.',
      });
      return;
    }
    csvCredentials = await fetchScriptCredentials(credentialBatchId);
    if (csvCredentials.length === 0) {
      res.status(422).json({
        error: 'The uploaded credentials CSV/batch resolved to zero usable rows (check that it has URL, Username, Password, and InstanceName columns). Re-upload a valid credentials file.',
      });
      return;
    }
  }

  const allTestCases: ParsedTestCase[] = [];
  const warnings: string[] = [];
  const rawJsonBlocks: string[] = [];
  let totalSkipped = 0;

  for (const file of files) {
    const content = file.buffer.toString('utf-8');
    try {
      const { testCases, warnings: fileWarnings, skipped } = parseHar(content, file.originalname, { dedupe: false });
      allTestCases.push(...testCases);
      warnings.push(...fileWarnings);
      totalSkipped += skipped;
    } catch (err: any) {
      if (String(err.message).includes('no HAR entries found')) {
        // Not a HAR document — treat as arbitrary JSON context (e.g. a Postman
        // collection or custom export) and let Claude interpret its shape.
        const parsed = safeParseJson(content);
        if (parsed !== null) {
          rawJsonBlocks.push(`// From ${file.originalname}:\n${JSON.stringify(parsed, null, 2)}`);
        } else {
          warnings.push(`${file.originalname}: not a valid HAR export or JSON file — skipped`);
        }
      } else {
        warnings.push(`${file.originalname}: ${err.message}`);
      }
    }
  }

  if (allTestCases.length === 0 && rawJsonBlocks.length === 0) {
    res.status(422).json({
      error: 'No API requests found across the uploaded file(s). Check that the files are valid HAR exports with captured network traffic, or JSON files describing API calls.',
      warnings,
    });
    return;
  }

  let cappedTestCases = allTestCases;
  if (allTestCases.length > MAX_CAPTURED_CALLS) {
    cappedTestCases = allTestCases.slice(0, MAX_CAPTURED_CALLS);
    warnings.push(`Captured ${allTestCases.length} calls, exceeding the ${MAX_CAPTURED_CALLS}-call limit for a single script — only the first ${MAX_CAPTURED_CALLS} were used.`);
  }

  const baseUrl = detectBaseUrl(cappedTestCases);

  // Deterministically split the login call from the rest — this is the same
  // detection already used by the non-AI /api/upload/har generator, reused here
  // so both paths agree on what counts as a "login".
  const loginCase = cappedTestCases.find(isAuthEntry) ?? null;
  const replayCases = cappedTestCases.filter(tc => tc !== loginCase);
  const cookieNameHint = replayCases.map(tc => tc.cookieNames?.[0]).find((n): n is string => !!n) ?? null;

  // When CSV-based credentials are in play, login comes from the uploaded
  // credential pool at execution time, not from anything captured in the HAR —
  // LOGIN_REQUEST is always null in that mode (the detected login-like call is
  // still excluded from replayCases above, just never used for auth).
  const loginRequest: LoginRequest | null = (!useCsvCredentials && loginCase) ? toLoginRequest(loginCase, cookieNameHint) : null;
  const replayRequests: ReplayRequest[] = replayCases.map(toReplayRequest);

  const dataBlock = `const LOGIN_REQUEST = ${JSON.stringify(loginRequest)};
const CAPTURED_REQUESTS = ${JSON.stringify(replayRequests)};`;

  const userMessageParts = [
    useCsvCredentials
      ? `Login credentials come from an uploaded CSV pool (one login per VU) — LOGIN_REQUEST will be null at runtime; do not use it for authentication.`
      : loginRequest
      ? `A login/auth call was detected among the captured requests and will be available at runtime as LOGIN_REQUEST.`
      : `No login/auth call was detected among the captured requests — LOGIN_REQUEST will be null at runtime.`,
    `${replayRequests.length} non-login calls were captured and will be available at runtime as CAPTURED_REQUESTS, in this chronological order (sample of the first 3 entries below, for shape reference only — do NOT copy these into your output, all ${replayRequests.length} entries are injected automatically):`,
    '```json',
    JSON.stringify(replayRequests.slice(0, 3), null, 2),
    '```',
  ];
  if (rawJsonBlocks.length) {
    userMessageParts.push(
      '\nAdditional JSON context from non-HAR uploaded file(s) (format may vary — use only to inform TEST_NAME/thresholds, not as extra requests to replay):',
      rawJsonBlocks.join('\n\n'),
    );
  }
  userMessageParts.push('\nGenerate the replay harness now, per the REPLAY HARNESS PATTERN. Output ONLY the JavaScript code.');
  const userMessage = userMessageParts.join('\n\n');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (type: string, data: any) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  try {
    sendEvent('status', { message: `Analyzing ${replayRequests.length} captured API calls with Claude…` });

    let fullScript = await streamHarness(baseUrl, loadProfile, replayRequests.length, !!loginRequest, useCsvCredentials, userMessage, sendEvent);
    fullScript = injectCapturedData(fullScript, dataBlock);

    if (!isBraceBalanced(fullScript)) {
      sendEvent('status', { message: 'Generated script failed a structural check — retrying once…' });
      fullScript = await streamHarness(baseUrl, loadProfile, replayRequests.length, !!loginRequest, useCsvCredentials, userMessage, sendEvent);
      fullScript = injectCapturedData(fullScript, dataBlock);

      if (!isBraceBalanced(fullScript)) {
        sendEvent('error', { message: 'Claude produced a script with mismatched braces twice in a row. Please try again — if this keeps happening, try uploading a smaller HAR file.' });
        res.end();
        return;
      }
    }

    // Bake the real uploaded CSV rows into the script now, rather than leaving
    // the CREDENTIALS placeholder for execution time — the credentials are
    // part of the generated script, not something spliced in later.
    if (useCsvCredentials && csvCredentials.length > 0) {
      fullScript = injectCredentials(fullScript, csvCredentials);
    }

    sendEvent('complete', {
      script: fullScript,
      testCases: [...(loginCase ? [loginCase] : []), ...replayCases],
      warnings,
      skipped: totalSkipped,
      filesProcessed: files.length,
    });
    res.end();
  } catch (err: any) {
    if (err.name === 'AbortError') { res.end(); return; }
    if (err.status === 401) {
      sendEvent('error', { message: 'Invalid Anthropic API key. Check your ANTHROPIC_API_KEY.' });
    } else if (err.status === 429) {
      sendEvent('error', { message: 'Rate limit reached. Please wait a moment and try again.' });
    } else if (isOverloadedError(err)) {
      sendEvent('error', { message: "Claude's servers are overloaded right now. We retried a few times but it didn't recover — please try again in a minute." });
    } else {
      sendEvent('error', { message: err.message || 'HAR/JSON script generation failed' });
    }
    res.end();
  }
});

export default router;
