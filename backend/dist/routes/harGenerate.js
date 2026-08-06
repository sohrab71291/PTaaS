"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const harParser_1 = require("../services/harParser");
const k6FromTestCases_1 = require("../services/k6FromTestCases");
const k6PromptBlocks_1 = require("../services/k6PromptBlocks");
const credentialStore_1 = require("../services/credentialStore");
const k6ScriptValidator_1 = require("../services/k6ScriptValidator");
const anthropicClient_1 = require("../services/anthropicClient");
const router = (0, express_1.Router)();
// Capped at 150MB, not the 200MB this endpoint used to allow — the raw file is
// later persisted as a base64 string inside TestSpec.uploadedFiles (a jsonb
// column), and Postgres hard-caps any single jsonb string at ~256MB. Base64
// inflates by ~4/3, so 200MB raw (~274MB encoded) already exceeded that cap —
// the suite would generate fine but then fail to ever SAVE. 150MB raw
// (~200MB encoded) leaves real margin.
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 150 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ext = '.' + file.originalname.split('.').pop()?.toLowerCase();
        if (['.har', '.json'].includes(ext))
            cb(null, true);
        else
            cb(new Error(`Unsupported file type: ${ext}. Allowed: .har, .json`));
    },
});
// Hard cap on the number of captured calls fed into the script — protects
// memory/prompt size on huge HAR captures. testCases beyond this are dropped
// with a warning rather than silently truncated without explanation. Since the
// captured data is injected as a literal (not hand-transcribed by Claude), this
// cap is generous — it's not fighting a token limit, just a sanity ceiling.
const MAX_CAPTURED_CALLS = 5000;
function describeValidationConfig(cfg) {
    if (!cfg)
        return '';
    const lines = [];
    const checks = (cfg.checks ?? []).filter(c => c && c.trim());
    if (checks.length) {
        lines.push(`\nMANDATORY CHECKS (VALIDATIONS ONLY — see rule 8(c)) — the user configured these exact checks in the Validation and Threshold section; every replayed request's check() block must assert them (in addition to the status/response-time checks already required by the REPLAY HARNESS PATTERN). These are informational validations, NOT pass/fail gates — a failing one must log a console.warn() WARNING, never fail the run or count as an error: ${checks.join(' | ')}\n`);
    }
    const thresholdEntries = Object.entries(cfg.thresholds ?? {});
    if (thresholdEntries.length) {
        const rendered = thresholdEntries.map(([metric, conds]) => `${metric}: ${conds.map(c => c.condition).join(', ')}`).join(' | ');
        lines.push(`\nMANDATORY THRESHOLDS (SLA/SLO — see rule 8(b)) — the user configured these exact conditions in the Validation and Threshold section; use them verbatim in options.thresholds INSTEAD of the defaults in rule 8: ${rendered}. These ARE the pass/fail gate for the run — breaching any of them fails the test. If the metric is http_req_duration or http_req_failed, still apply the {endpoint_type:app} tag scope from rule 8 to the KEY (e.g. user condition "rate<0.01" on metric "http_req_failed" becomes 'http_req_failed{endpoint_type:app}': ['rate<0.01']) — the condition itself is exactly what the user typed, only the key gets the mandatory scope so InfluxDB traffic still can't affect it. Do not add a 'checks' threshold — checks are validations only (rule 8(c)) and must never gate pass/fail.\n`);
    }
    return lines.join('');
}
function stripAuthHeaders(headers) {
    const out = {};
    for (const [k, v] of Object.entries(headers)) {
        if (!(0, k6FromTestCases_1.isAuthHeader)(k))
            out[k] = v;
    }
    return out;
}
// GetModuleRecordAccess is the call that PRODUCES the csrf token (see its
// response's csrf-token header) — it must never carry a stale/"null"
// x-csrf-token captured from the HAR, and it needs x-http-method-override
// instead, per explicit product requirement:
//   x-http-method-override: GET
//   Content-Type:           application/json
const MODULE_RECORD_ACCESS_RE = /GetModuleRecordAccess/i;
// STRICT HEADER ALLOWLIST for every non-login replay call — per explicit
// product requirement, the generated script must carry ONLY these headers
// on non-login requests, taken from the HAR exactly as specified:
//   - x-csrf-token: verbatim from the HAR's own Header section
//   - Content-Type: application/json (fixed, not the HAR's captured mimeType)
//   - x-archer-source: verbatim from the HAR's own Header section, when
//     present — Archer's classic /api/* gateway uses this ALONGSIDE the csrf
//     token to authorize the call, and its value is call-specific (e.g.
//     "Archer,ConsumerResources" vs "Archer,Translations" vs "Archer,
//     Navigation"), not a fixed constant. Dropping it produces a 403 even
//     though the session cookie and csrf token are both valid — this is NOT
//     an auth failure, so it's easy to misdiagnose as a stale token/cookie.
//   - x-requested-with: verbatim from the HAR's own Header section, when
//     present — only some classic endpoints send it (e.g. ConsumerResources),
//     others legitimately omit it (e.g. ConsumerGroups), so it must be
//     copied per-call rather than assumed universal.
// Cookie is deliberately NEVER baked in here — the __ArcherSessionCookie__
// literal captured in the HAR is stale by replay time, and freezing a Cookie
// string at generation time (or even once at runtime login) also permanently
// hides any OTHER session cookie the app sets later mid-flow (e.g. Archer's
// ngrx/Angular surface issues its own archer_ngrx_* JWT cookie via a
// bootstrap call sometime after login, not at login itself) — an explicit
// Cookie header always wins over whatever a k6 cookie jar would have sent, so
// baking one here would silently suppress that cookie for the rest of the
// run. The REPLAY HARNESS PATTERN's runtime cookie jar (passed to every
// request, including login/reauth) is the sole source of Cookie instead — it
// accumulates every Set-Cookie exactly like a real browser would.
// Every other header key present in the HAR is ignored outright.
function buildReplayHeaders(tc) {
    const findHeader = (name) => Object.entries(tc.headers).find(([k]) => k.toLowerCase() === name)?.[1];
    if (MODULE_RECORD_ACCESS_RE.test(tc.url)) {
        return { 'x-http-method-override': 'GET', 'Content-Type': 'application/json' };
    }
    const headers = { 'Content-Type': 'application/json' };
    const csrfToken = findHeader('x-csrf-token');
    if (csrfToken)
        headers['x-csrf-token'] = csrfToken;
    const archerSource = findHeader('x-archer-source');
    if (archerSource)
        headers['x-archer-source'] = archerSource;
    const requestedWith = findHeader('x-requested-with');
    if (requestedWith)
        headers['x-requested-with'] = requestedWith;
    return headers;
}
function toReplayRequest(tc) {
    return {
        name: tc.name,
        method: tc.method,
        path: (0, k6FromTestCases_1.toUrlPath)(tc.url),
        headers: buildReplayHeaders(tc),
        payload: tc.payload,
        payloadType: tc.payloadType ?? 'json',
        expectedStatus: tc.expectedStatus,
        responseThresholdMs: tc.responseThresholdMs,
        ...(tc.producesVars?.length ? { producesVars: tc.producesVars } : {}),
    };
}
function toLoginRequest(tc, cookieNameHint) {
    return {
        method: tc.method,
        path: (0, k6FromTestCases_1.toUrlPath)(tc.url),
        headers: { 'Content-Type': 'application/json', ...stripAuthHeaders(tc.headers) },
        payload: tc.payload,
        payloadType: tc.payloadType ?? 'json',
        cookieNameHint,
    };
}
function detectBaseUrl(testCases) {
    for (const tc of testCases) {
        try {
            return new URL(tc.url).origin;
        }
        catch { /* relative URL — keep scanning */ }
    }
    return null;
}
function describeLoadProfile(profile) {
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
function buildHarSystemPrompt(baseUrl, loadProfile, totalCalls, hasLogin, useCsvCredentials, validationConfig) {
    return `You are an expert performance engineer specializing in k6 load testing with InfluxDB v2 integration. You are writing a REPLAY HARNESS for a captured browser session (HAR export) — a small, fixed amount of code that iterates generically over an already-extracted array of API calls. You do NOT write one code block per captured call; the calls themselves are supplied to you as a runtime data array, not something you transcribe.
${describeLoadProfile(loadProfile)}${describeValidationConfig(validationConfig)}
LOGIN_REQUEST and CAPTURED_REQUESTS are constants that will be injected into your script automatically — do NOT declare or redeclare them yourself, do NOT attempt to enumerate, copy, or transcribe their contents. Their shapes are:
  LOGIN_REQUEST: ${useCsvCredentials
        ? `null — login credentials come from an uploaded CSV pool instead (see CSV-BASED PER-VU CREDENTIALS below); the captured session's own login call, if any, is excluded from CAPTURED_REQUESTS and unused.`
        : hasLogin ? `{ method: string, path: string, headers: object, payload: string|null, payloadType: 'json'|'form', cookieNameHint: string|null } — a single detected login/auth call` : `null — no login/auth call was detected in the captured session`}
  CAPTURED_REQUESTS: Array<{ name: string, method: string, path: string, headers: object, payload: string|null, payloadType: 'json'|'form', expectedStatus: number, responseThresholdMs: number, producesVars?: Array<{ token: string, jsonPath: string }> }> — the ${totalCalls} non-login calls to replay, in the order they were captured.
  payloadType 'form' means payload is a JSON-encoded {field: value} object that was originally submitted as application/x-www-form-urlencoded — it MUST be sent as a real form body (see requestBody() helper in the REPLAY HARNESS PATTERN below), never re-encoded as JSON.

  ID CORRELATION — some captured sessions are stateful CRUD flows: a POST/PUT creates or mutates a resource and a LATER captured call references that exact id in ITS path or payload (e.g. a created content id showing up in a later /contents/{id}/fields call). Replaying such a flow with the bare capture-time id verbatim drifts the moment that id no longer exists (a fresh run creates a different id; an earlier run's own DELETE removed it) — the entire downstream chain fails even though the flow itself is fine. To avoid this, any entry's \`path\`/\`payload\` may contain a \`__CORR_<token>_<capturedValue>__\` placeholder (this exact underscore-delimited format, never \`{{...}}\` — curly braces get corrupted by k6's URL handling) in place of a literal id, and the call that PRODUCES that value is tagged with \`producesVars: [{ token, jsonPath }]\`. You MUST implement the correlation exactly as shown in the REPLAY HARNESS PATTERN below (substituteCorrelationVars() / getByJsonPath(), correlationVars scoped fresh per iteration inside sessionReplay — never module-level/shared across VUs, since each VU/iteration creates and must reference its OWN resources): resolve placeholders from values actually extracted from that VU's own prior responses this iteration, falling back to the captured literal only if extraction failed.

MANDATORY RULES — every rule must be followed exactly:
1. Output ONLY valid JavaScript — no markdown, no code fences, no explanation text.
2. Structure, in this exact order: (a) imports — http from 'k6/http', { check, group, sleep, fail } from 'k6' (fail is MANDATORY, not optional — ensureAuth()/getVuCredential() in the REPLAY HARNESS PATTERN below call fail() when login credentials are missing or a login request fails; omitting it from the import crashes the ENTIRE script with "fail is not defined" the moment that path is hit, aborting every VU instead of failing just that one login attempt), metrics from 'k6/metrics', textSummary from the jslib summary URL; (b) the single line ${k6PromptBlocks_1.DATA_PLACEHOLDER} on its own line, verbatim, immediately after the imports — this is where the real captured-request data gets spliced in; (c) the InfluxDB v2 integration block shown below, word for word; (d) the REPLAY HARNESS PATTERN shown below; (e) handleSummary.
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
8. PASS/FAIL POLICY — MANDATORY, applies uniformly across console output, options.thresholds, check(), and recordCustomMetrics: (a) EVERY 4xx/5xx response status is ALWAYS a real failure — there is no "this endpoint is known to legitimately 404" or "DELETE landing on 404/409 is fine" tolerance anymore; every non-2xx/3xx response counts against http_req_failed and errorCount unconditionally, no exceptions, not even for CAPTURED_REQUESTS entries whose expectedStatus itself was a 4xx/5xx (isResponseStatusExpected below governs check()/warning labeling only, never the failure/errorCount computation). Do NOT set a responseCallback param on any request — leave it unset so k6's own default status-based failure determination (>=400 = failed) applies directly; do NOT write a custom function for it (unsupported in this k6 build — fails every request outright with "unsupported responseCallback") and do NOT use http.expectedStatuses() to tolerate anything either. (b) options.thresholds is the SLA/SLO gate for the WHOLE RUN — set 'http_req_duration{endpoint_type:app}': ['p(95)<1000'] and 'http_req_failed{endpoint_type:app}': ['rate<0.05'] as sensible defaults unless told otherwise above; breaching either FAILS the test. The {endpoint_type:app} scope is MANDATORY on both (every replayed request in doRequest is tagged endpoint_type: 'app'; the InfluxDB write/precheck calls in the InfluxDB block below are deliberately left untagged so they never pollute this SLA signal). Do NOT add a 'checks' entry to options.thresholds — checks must never gate pass/fail (see (c)). (c) Checks (the status/response-time assertions built from CAPTURED_REQUESTS' expectedStatus/responseThresholdMs, and any user-configured Validation entries) are informational validations ONLY — check() still runs and still populates the 'checks' metric for visibility in the report, but a failing check must be logged via console.warn (a WARNING), never console.error, and must never be wired into options.thresholds or otherwise fail the run by itself. A request can simultaneously log an ERROR (its status was 4xx/5xx, per (a)) and/or a WARNING (its check() failed, per (c)) — these are independent signals, log both when both apply.
9. The InfluxDB block below already declares isResponseStatusExpected(response, expectedStatus) — reuse it verbatim, but ONLY for check()'s pass/fail label and the WARNING log text (per rule 8(c)) — never for deciding whether a response counts as a failure (that's rule 8(a): raw status >= 400, unconditionally, no isResponseStatusExpected involved). Do not redeclare isResponseStatusExpected, and do not reintroduce any per-endpoint or per-method tolerance function — none is needed anymore.
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
17. CSRF PROPAGATION IS MANDATORY for every captured session, regardless of whether it happens to include a call to .../api/internal/Permission/GetModuleRecordAccess — reproduce the module-level \`__csrfToken\` variable and \`captureCsrfToken(reqDef, response)\` from the REPLAY HARNESS PATTERN below verbatim, call it in replayStep right after EVERY response comes back (both the initial and any 401-retry response, from ANY captured call, not just GetModuleRecordAccess — Archer's classic /api/* gateway rotates the csrf token on responses generally, and GetModuleRecordAccess is only a common source of it, not the sole one; a captured session that happens not to include it must still be able to obtain a valid token from whichever calls it DOES have), and override the request's x-csrf-token header with \`__csrfToken\` whenever it is non-empty — this MUST take priority over any x-csrf-token value baked into reqDef.headers from the HAR capture, which is a stale snapshot from capture time bound to a completely different (dead) session; a script that never overrides it for lack of a GetModuleRecordAccess call in the capture will send that stale literal on every classic /api/* call and 403 permanently. Do not scope __csrfToken per-iteration (unlike correlationVars) — like the session cookie, it stays valid across iterations once obtained. A csrf token is bound to the specific session that produced it — reproduce \`findCsrfPrimingRequest()\`/\`refreshCsrfToken(jar, authHeaders)\` verbatim too, and call \`refreshCsrfToken(jar, authHeadersFromAuth(__vuAuth))\` at the END of reauth(), right after \`__vuAuth\` is reassigned to the fresh session — otherwise the retried request after a reauth() sends a (new session, old csrf) pair, which Archer's classic /api/* gateway rejects with a generic IIS 403 that looks like a permissions error but is actually this exact mismatch.
18. EXECUTION ORDER MUST MATCH THE HAR CAPTURE ORDER — CAPTURED_REQUESTS is already injected in the exact order the calls were captured (see its shape description above). Reproduce sessionReplay's loop EXACTLY as shown in the REPLAY HARNESS PATTERN below: a plain sequential \`for (let i = 0; i < replayRequests.length; i++)\` over the array as given, calling replayStep(replayRequests[i], ...) and letting that request's response come back (k6's http.request() is already synchronous/blocking, so this happens naturally) before moving on to i+1. Do NOT sort, group by method/endpoint, batch, deduplicate further, reverse, or otherwise reorder CAPTURED_REQUESTS or replayRequests in any way — a captured Login→CreateRecord→DeleteRecord flow depends on that exact sequence (e.g. DeleteRecord referencing an id CreateRecord just produced via ID CORRELATION per rule 13); replaying out of order breaks the flow even if every individual request is otherwise correct.

${(0, k6PromptBlocks_1.buildInfluxBlock)(baseUrl)}
${useCsvCredentials ? (0, k6PromptBlocks_1.buildCsvCredentialAuthPatternBlock)() : ''}
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
  // user-agent/origin/referer are stripped outright too — per requirement,
  // requests must never carry these, and k6 supplies its own default
  // User-Agent when none is set rather than the request being sent bare.
  // cookie is ALSO stripped unconditionally — Cookie must come from the
  // runtime cookie jar exclusively (see buildReplayHeaders' comment above),
  // never from a captured/static value, so any Cookie key that somehow ends
  // up in reqDef.headers must never reach the actual request.
  const sanitized = {};
  if (!headers) return sanitized;
  Object.keys(headers).forEach(function (name) {
    const value = headers[name];
    if (value === undefined || value === null || String(value).trim() === '') return;
    const normalizedName = String(name).toLowerCase();
    if (normalizedName === 'content-length' || normalizedName === 'transfer-encoding'
      || normalizedName === 'user-agent' || normalizedName === 'origin' || normalizedName === 'referer'
      || normalizedName === 'cookie') return;
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

// Archer's classic /api/* gateway rotates the csrf token on responses —
// GetModuleRecordAccess is a common source of it (it's usually the first
// classic-API call a session makes), but it is NOT the only one and is NOT
// guaranteed to be present in every captured session (e.g. a session that
// starts mid-flow, or where the app cached that lookup client-side). Treating
// it as the sole source means a capture that happens to omit it has NO way to
// ever obtain a valid token — every classic /api/* call then falls back to
// the stale literal baked into reqDef.headers from HAR capture time, which is
// bound to a completely different (dead) session and gets rejected outright.
// Capture the header from ANY authenticated response that has one instead —
// module-scoped (not correlationVars-scoped) because it behaves like the
// session cookie: once obtained it stays valid for the rest of this VU's
// session, not just the current iteration. NEVER falls back to a captured/HAR
// literal — a stale csrf token gets rejected by the server just like an
// expired session would.
let __csrfToken = '';
function captureCsrfToken(reqDef, response) {
  const token = response.headers['csrf-token'] || response.headers['Csrf-Token'] || response.headers['CSRF-Token'];
  if (token && token !== __csrfToken) {
    __csrfToken = token;
    console.log('VU ' + __VU + ': captured fresh csrf-token from ' + reqDef.name);
  }
}

// Picks a request to replay standalone in order to obtain a fresh csrf token
// after reauth() — prefers GetModuleRecordAccess when the capture has one
// (a lightweight, side-effect-free lookup), otherwise falls back to the
// first captured entry (any authenticated classic /api/* or /ngrx/* call's
// response can carry a rotated token). Never throws — returns null only if
// CAPTURED_REQUESTS is itself empty.
function findCsrfPrimingRequest() {
  return CAPTURED_REQUESTS.find(function (r) { return /GetModuleRecordAccess/i.test(String(r.path || '')); })
    || CAPTURED_REQUESTS[0]
    || null;
}

// A csrf token is bound to the session that produced it — the moment reauth()
// obtains a NEW session cookie, the OLD __csrfToken becomes invalid for it,
// even though it still looks like a normal-shaped token. Sending a mismatched
// (session, csrf) pair to Archer's classic /api/* gateway gets rejected with a
// generic IIS 403 "Forbidden: Access is denied" page — NOT a 401, so it is
// easy to mistake for a permissions issue rather than what it actually is:
// a stale csrf token left over from the session that just expired. Re-running
// a captured request with the FRESH session immediately after reauth() fixes
// this by re-priming __csrfToken to match (see findCsrfPrimingRequest above
// for which request gets used).
function refreshCsrfToken(jar, authHeaders) {
  const reqDef = findCsrfPrimingRequest();
  if (!reqDef) return;
  const headers = Object.assign({}, sanitizeHeaders(reqDef.headers), authHeaders);
  const res = http.request(
    reqDef.method,
    BASE_URL + reqDef.path,
    requestBody(reqDef.payload, reqDef.payloadType),
    { headers: headers, redirects: 5, tags: { name: (reqDef.name || reqDef.path) + ' (csrf-refresh)', endpoint_type: 'app' }, jar: jar }
  );
  captureCsrfToken(reqDef, res);
}

// PASS/FAIL POLICY (mirrors the Test Authoring "Validation and Threshold"
// section exactly — see rule 8/9 below for the full rationale):
//   - Every 4xx/5xx status is ALWAYS a real failure. There is no "benign
//     404"/"idempotent DELETE" tolerance anymore — a captured endpoint that
//     legitimately varies by environment/record state must be reflected as a
//     failure when it happens, not silently absorbed. This is unconditional
//     and applies to k6's own http_req_failed metric (its default behavior,
//     since no responseCallback is set — see doRequest below),
//     recordCustomMetrics()'s errorCount (requestsRaw/the report), and the
//     console error log.
//   - Threshold/SLA/SLO (options.thresholds — http_req_duration,
//     http_req_failed) are the pass/fail gate for the whole run: breaching
//     one fails the test.
//   - Checks (the free-text Validation entries from Section D, e.g. "status
//     is 200") are informational only — a failing check is logged as a
//     WARNING (console.warn), never as an error, and never gates pass/fail.

// Captured HAR timings reflect ONE real user's single request, often 500ms —
// too tight a bar to hold replay traffic to under concurrent load without
// generating noisy false-positive check failures unrelated to real
// regressions. Floor every per-request threshold at a stable minimum instead
// of trusting the raw captured value verbatim.
const RESPONSE_THRESHOLD_FLOOR_MS = 1000;
function effectiveResponseThreshold(reqDef) {
  return Math.max(reqDef.responseThresholdMs, RESPONSE_THRESHOLD_FLOOR_MS);
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

// Returns [{name, value}] from a login-shaped response's real Set-Cookie
// values — k6 exposes response.cookies regardless of whether the request
// used a jar, which matters for setup()'s ONE jar-less shared login call.
// Falls back to a single synthetic pair built from the extracted token (using
// cookieNameHint, or 'session') ONLY when the login returned it purely in the
// JSON body with no Set-Cookie at all. Callers seed a cookie jar from this —
// see ensureAuth()/reauth() below — rather than ever building a static Cookie
// header string (a frozen header always wins over the jar and would silently
// hide any OTHER cookie the app sets later, e.g. an ngrx JWT cookie minted by
// a bootstrap call after login rather than by login itself).
function extractLoginCookies(response, fallbackToken, loginRequest) {
  const pairs = [];
  if (response && response.cookies) {
    Object.keys(response.cookies).forEach(function (cookieName) {
      const cookie = response.cookies[cookieName][0];
      if (cookie) pairs.push({ name: cookieName, value: cookie.value });
    });
  }
  if (pairs.length === 0 && fallbackToken) {
    pairs.push({ name: (loginRequest && loginRequest.cookieNameHint) ? loginRequest.cookieNameHint : 'session', value: fallbackToken });
  }
  return pairs;
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
// Deliberately never sets a Cookie header — Cookie comes exclusively from the
// per-VU cookie jar (seeded/refreshed by ensureAuth()/reauth() above), which
// every request already carries via { jar: jar }. Setting one here would
// override the jar's actual contents (an explicit Cookie header always wins),
// silently hiding any cookie the app sets mid-session (see extractLoginCookies'
// comment above).
function authHeadersFromAuth(auth) {
  const headers = {};
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
only the resulting cookies array/jwt (immutable data, safe to share — each VU
seeds ITS OWN jar from the cookies array via ensureAuth(), see below) are
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
      tags: { name: effectiveLoginRequest.name || effectiveLoginRequest.path, endpoint_type: 'app' },
    }
  );

  const body = getResponseBody(res);
  const sessionToken = extractSessionToken(body);
  const jwt = extractJwt(body);
  const cookies = extractLoginCookies(res, sessionToken, effectiveLoginRequest);

  // NEVER throw here, even when the login produced nothing usable — a broken
  // or expired captured login must degrade to "requests run unauthenticated"
  // (later calls will now correctly surface as REAL 401/403 failures — see
  // isResponseStatusExpected — instead of stopping the whole run before any
  // other request gets a chance to execute).
  if (cookies.length === 0 && !jwt && !(res.status >= 300 && res.status < 400)) {
    console.warn('Setup: authentication request returned no session data; continuing without auth headers.');
    return null;
  }

  console.log('Setup: authentication completed with status ' + res.status + '.' + (jwt ? ' (session cookie + bearer JWT)' : ''));
  return { cookies: cookies, jwt: jwt };
}

Write these two helpers once, before setup() — every VU starts from the ONE
shared login setup() already performed (no extra network calls if that session
stays valid all run), but each VU independently refreshes ITS OWN copy the
moment its session actually expires, via reauth() (see replayStep's 401 retry
below) — never a second run-wide relogin shared by every VU:

let __vuAuth = null; // per-VU cache — module scope is per-VU in k6, so this is NOT shared across VUs
function ensureAuth(setupData, jar) {
  if (__vuAuth) return __vuAuth;
  // Seed THIS VU's own jar from setup()'s single shared login (setup() has no
  // jar of its own — see its comment above — so this is the first time these
  // cookies attach to any jar). Every later request passes { jar: jar }, so
  // from here on the jar is the sole source of Cookie — never a static string.
  if (setupData && Array.isArray(setupData.cookies)) {
    setupData.cookies.forEach(function (c) { jar.set(BASE_URL, c.name, c.value); });
  }
  __vuAuth = { jwt: (setupData && setupData.jwt) || '' };
  return __vuAuth;
}
function reauth() {
  console.warn('VU ' + __VU + ': got 401 — re-authenticating.');
  const effectiveLoginRequest = findLoginRequest(CAPTURED_REQUESTS);
  const jar = getVuJar();
  if (!effectiveLoginRequest) {
    __vuAuth = { jwt: '' };
    return __vuAuth;
  }
  // The server responds to an unauthenticated/expired-session call by setting
  // its OWN session-state cookie (e.g. archer_ngrx_*) to a "logged-out" value
  // via Set-Cookie — and since every request runs through the same VU jar
  // (getVuJar()), that stale logged-out cookie would otherwise keep riding
  // along next to the brand-new session cookie on every subsequent request,
  // causing an immediate re-401 regardless of how valid the fresh session is.
  // Wipe the jar for BASE_URL before re-login so only the fresh cookie survives.
  const stale = jar.cookiesForURL(BASE_URL) || {};
  Object.keys(stale).forEach(function (name) {
    jar.set(BASE_URL, name, '', { expires: new Date(0).toUTCString() });
  });
  const res = http.request(
    effectiveLoginRequest.method,
    BASE_URL + effectiveLoginRequest.path,
    requestBody(effectiveLoginRequest.payload, effectiveLoginRequest.payloadType),
    { headers: sanitizeHeaders(effectiveLoginRequest.headers), redirects: 5, tags: { name: 'Reauth', endpoint_type: 'app' }, jar: jar }
  );
  const body = getResponseBody(res);
  const sessionToken = extractSessionToken(body);
  const jwt = extractJwt(body);
  // Set-Cookie from this response already landed in the jar automatically since
  // the request above ran with { jar } — this loop only matters for the
  // fallback case (session token returned purely in the JSON body, no
  // Set-Cookie at all); re-setting already-present cookies here is harmless.
  extractLoginCookies(res, sessionToken, effectiveLoginRequest).forEach(function (c) {
    jar.set(BASE_URL, c.name, c.value);
  });
  __vuAuth = { jwt: jwt };
  console.log('VU ' + __VU + ': re-authenticated (status ' + res.status + ').');

  // The OLD __csrfToken (from the session that just expired) is invalid for
  // this brand-new session — re-priming it now (see refreshCsrfToken's
  // comment above) prevents the retried request right after this from
  // failing again with a 403 due to a (new session, old csrf) mismatch.
  refreshCsrfToken(jar, authHeadersFromAuth(__vuAuth));

  return __vuAuth;
}`}

Write exactly ONE generic step-executor function — it is called once per entry
in CAPTURED_REQUESTS, so it must not reference any specific captured call. Reuse
isResponseStatusExpected(response, expectedStatus) from the InfluxDB block above
instead of a strict === comparison for the check()/WARNING label ONLY (rule
8(c)) — replayed sessions can legitimately land on a matching-class redirect,
but NEVER on a 401/403 (see isResponseStatusExpected's own comment — those must
always surface as real failures). This does NOT affect whether the response
counts as a failure — per rule 8(a), ANY 4xx/5xx status is unconditionally a
failure, with no per-endpoint or per-method exceptions.
correlationVars (see ID CORRELATION above and getByJsonPath/substituteCorrelationVars/
captureCorrelationVars helpers above) MUST be threaded through here — resolve
placeholders in path/payload before sending, then capture this step's own
produced values after the response comes back.
CSRF PROPAGATION IS MANDATORY (see captureCsrfToken/__csrfToken above) — every
request's x-csrf-token header MUST be overridden with __csrfToken whenever it
is non-empty, taking priority over any x-csrf-token baked into reqDef.headers
from the HAR capture; that baked value is a snapshot from capture time and
becomes stale/invalid the moment a fresh one is issued during replay.
RE-AUTH ON 401 is MANDATORY (rule 15) — build auth headers via ensureAuth()${useCsvCredentials ? '' : '(setupData, jar)'}/authHeadersFromAuth() fresh for every request (not once per iteration — a cached auth object can be replaced mid-iteration by reauth()), and on a 401 call reauth() and retry the SAME request exactly once with the refreshed headers before falling through to normal check()/metrics/error-logging:

function replayStep(reqDef, jar, ${useCsvCredentials ? '' : 'setupData, '}correlationVars) {
  const path = substituteCorrelationVars(reqDef.path, correlationVars);
  const payload = substituteCorrelationVars(reqDef.payload, correlationVars);
  const url = BASE_URL + path;

  // Origin/Referer/User-Agent are deliberately NEVER sent — per requirement,
  // requests must carry only the headers captured from the HAR (see
  // sanitizeHeaders, which strips these outright if they ever appear). The
  // x-csrf-token override below MUST run after the Object.assign so a fresh
  // __csrfToken always wins over whatever x-csrf-token value was captured in
  // the HAR — the captured one is a stale snapshot from capture time.
  function doRequest(authHeaders) {
    const headers = Object.assign(
      {},
      sanitizeHeaders(reqDef.headers),
      authHeaders,
    );
    if (__csrfToken) headers['x-csrf-token'] = __csrfToken;
    const params = {
      headers: headers,
      redirects: 5,
      // endpoint_type: 'app' lets options.thresholds scope http_req_duration/
      // http_req_failed to {endpoint_type:app} — excluding the InfluxDB
      // write/precheck traffic from the InfluxDB block below, which is
      // deliberately left untagged for endpoint_type so it never matches.
      tags: { name: reqDef.name, endpoint_type: 'app' },
      jar: jar,
      // Deliberately NO responseCallback — leave k6's default failure
      // determination in place (status >= 400 = failed) so every 4xx/5xx is
      // unconditionally a failure, per rule 8(a). Do NOT set one here.
    };
    return http.request(reqDef.method, url, requestBody(payload, reqDef.payloadType), params);
  }

  let auth = ensureAuth(${useCsvCredentials ? '' : 'setupData, jar'});
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

  // Must run before check()/metrics below — if THIS response carries a fresh
  // csrf-token (any call can, not just GetModuleRecordAccess), every
  // subsequent replayStep() call (including later ones in this same loop)
  // needs the token it just produced.
  captureCsrfToken(reqDef, res);

  // Checks are validations only (rule 8(c)) — they never change whether this
  // response counts as a failure (that's rule 8(a): raw status >= 400,
  // unconditional, computed independently below).
  const responseThresholdMs = effectiveResponseThreshold(reqDef);
  const statusCheckPassed = isResponseStatusExpected(res, reqDef.expectedStatus);
  const responseTimeCheckPassed = res.timings.duration < responseThresholdMs;
  check(res, {
    [reqDef.name + ' status is ' + reqDef.expectedStatus]: function () { return statusCheckPassed; },
    [reqDef.name + ' response time < ' + responseThresholdMs + 'ms']: function () { return responseTimeCheckPassed; },
  });
  // A failing check is a WARNING (a validation the response didn't meet),
  // never an ERROR — errors are reserved for actual 4xx/5xx failures below.
  if (!statusCheckPassed) {
    console.warn(reqDef.name + ' validation warning: expected status ' + reqDef.expectedStatus + ' but got ' + res.status);
  }
  if (!responseTimeCheckPassed) {
    console.warn(reqDef.name + ' validation warning: response time ' + res.timings.duration + 'ms exceeded ' + responseThresholdMs + 'ms');
  }

  recordCustomMetrics(res, SCENARIO_NAME, reqDef.name, path, getByteLength(payload || ''), reqDef.name, reqDef.expectedStatus);

  // Rule 8(a) — EVERY 4xx/5xx is unconditionally a real failure, logged as an
  // ERROR. No per-endpoint or per-method tolerance; isResponseStatusExpected
  // above is used only for the check()/WARNING label, never here.
  if (res.status >= 400) {
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

  // Sequential, index order, exactly as captured (rule 18) — .filter() above
  // only removes the login entry, it never reorders; do NOT sort/group/batch
  // replayRequests before this loop. A stateful flow (e.g. Login -> Create ->
  // Delete) depends on this exact sequence.
  for (let i = 0; i < replayRequests.length; i++) {
    const reqDef = replayRequests[i];
    group(reqDef.name, function () {
      replayStep(reqDef, jar, ${useCsvCredentials ? '' : 'setupData, '}correlationVars);
    });
    sleep(1);
  }

  // Force-flush this iteration's buffered InfluxDB lines NOW, at the end of
  // every iteration — do NOT rely on teardown() for this. teardown() runs in
  // its own fresh VU context in k6 (see InfluxDB block above), so it can only
  // ever flush an empty buffer of its own; it can never reach the buffer this
  // VU actually accumulated. Without an explicit flush here, up to
  // INFLUX_FLUSH_THRESHOLD-1 trailing requestsRaw points are silently dropped
  // every time a VU's last iteration ends mid-batch — which is exactly why a
  // script's own k6_http_reqs_total counter (in-memory, always exact) can end
  // up higher than the request count the report derives from requestsRaw.
  flushInfluxLines();
}

MANDATORY — always close the pattern with a default export that delegates to
sessionReplay, even though the scenario's exec already names it by name. This
is a required safety net: a k6 script with no exported function at all refuses
to start (a hard error before any request runs), rather than failing normally:

export default function (setupData) {
  sessionReplay(setupData);
}

════════════════════════════════════════════════════════════════

${k6PromptBlocks_1.HANDLE_SUMMARY_BLOCK}
Generate the k6 replay harness now. Output ONLY JavaScript, starting with the first import line.`;
}
function safeParseJson(content) {
    try {
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
async function streamHarness(baseUrl, loadProfile, totalCalls, hasLogin, useCsvCredentials, userMessage, sendEvent, validationConfig) {
    let stream = null;
    for (let attempt = 0; attempt < anthropicClient_1.MAX_STREAM_ATTEMPTS; attempt++) {
        try {
            stream = await (0, anthropicClient_1.getAnthropicClient)().messages.stream({
                model: anthropicClient_1.CLAUDE_MODEL,
                max_tokens: 16000,
                system: buildHarSystemPrompt(baseUrl, loadProfile, totalCalls, hasLogin, useCsvCredentials, validationConfig),
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
        throw new Error('Failed to start generation after retries');
    let fullScript = '';
    for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            const text = chunk.delta.text;
            fullScript += text;
            sendEvent('chunk', { text });
        }
    }
    return (0, anthropicClient_1.stripCodeFences)(fullScript);
}
// POST /api/har-generate — streaming SSE endpoint. Accepts one or more .har /
// .json files (field name "files"). HAR-shaped files are parsed with the
// structured parser (dedupe disabled, so every captured call survives); non-HAR
// .json files are passed through as raw supplementary context. The backend
// deterministically splits the login call from the rest and injects both as
// literal data into the script Claude writes — Claude never hand-transcribes
// the captured calls, which is what made large captures prone to truncation or
// brace-mismatch syntax errors ("export only allowed in global scope").
router.post('/har-generate', upload.any(), async (req, res) => {
    const files = req.files ?? [];
    if (!(0, anthropicClient_1.hasAnthropicCredentials)()) {
        res.status(500).json({
            error: 'Anthropic API credentials not configured. Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in backend/.env or as an environment variable.',
        });
        return;
    }
    if (files.length === 0) {
        res.status(400).json({ error: 'No files uploaded. Use multipart/form-data with field name "files".' });
        return;
    }
    let loadProfile = null;
    try {
        loadProfile = req.body.loadProfile ? JSON.parse(req.body.loadProfile) : null;
    }
    catch { /* ignore */ }
    let validationConfig = null;
    try {
        validationConfig = req.body.validationConfig ? JSON.parse(req.body.validationConfig) : null;
    }
    catch { /* ignore */ }
    const useCsvCredentials = req.body.useCsvCredentials === true || req.body.useCsvCredentials === 'true';
    const credentialBatchId = req.body.credentialBatchId;
    let csvCredentials = [];
    if (useCsvCredentials) {
        if (typeof credentialBatchId !== 'string' || !credentialBatchId.trim()) {
            res.status(422).json({
                error: 'CSV-based credentials were requested but no credential batch was uploaded. Upload a login credentials CSV before generating the script.',
            });
            return;
        }
        csvCredentials = await (0, credentialStore_1.fetchScriptCredentials)(credentialBatchId);
        if (csvCredentials.length === 0) {
            res.status(422).json({
                error: 'The uploaded credentials CSV/batch resolved to zero usable rows (check that it has URL, Username, Password, and InstanceName columns). Re-upload a valid credentials file.',
            });
            return;
        }
    }
    const allTestCases = [];
    const warnings = [];
    const rawJsonBlocks = [];
    let totalSkipped = 0;
    for (const file of files) {
        const content = file.buffer.toString('utf-8');
        try {
            const { testCases, warnings: fileWarnings, skipped } = (0, harParser_1.parseHar)(content, file.originalname, { dedupe: false });
            allTestCases.push(...testCases);
            warnings.push(...fileWarnings);
            totalSkipped += skipped;
        }
        catch (err) {
            if (String(err.message).includes('no HAR entries found')) {
                // Not a HAR document — treat as arbitrary JSON context (e.g. a Postman
                // collection or custom export) and let Claude interpret its shape.
                const parsed = safeParseJson(content);
                if (parsed !== null) {
                    rawJsonBlocks.push(`// From ${file.originalname}:\n${JSON.stringify(parsed, null, 2)}`);
                }
                else {
                    warnings.push(`${file.originalname}: not a valid HAR export or JSON file — skipped`);
                }
            }
            else {
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
    const loginCase = cappedTestCases.find(k6FromTestCases_1.isAuthEntry) ?? null;
    const replayCases = cappedTestCases.filter(tc => tc !== loginCase);
    const cookieNameHint = replayCases.map(tc => tc.cookieNames?.[0]).find((n) => !!n) ?? null;
    // When CSV-based credentials are in play, login comes from the uploaded
    // credential pool at execution time, not from anything captured in the HAR —
    // LOGIN_REQUEST is always null in that mode (the detected login-like call is
    // still excluded from replayCases above, just never used for auth).
    const loginRequest = (!useCsvCredentials && loginCase) ? toLoginRequest(loginCase, cookieNameHint) : null;
    const replayRequests = replayCases.map(toReplayRequest);
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
        userMessageParts.push('\nAdditional JSON context from non-HAR uploaded file(s) (format may vary — use only to inform TEST_NAME/thresholds, not as extra requests to replay):', rawJsonBlocks.join('\n\n'));
    }
    userMessageParts.push('\nGenerate the replay harness now, per the REPLAY HARNESS PATTERN. Output ONLY the JavaScript code.');
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
        sendEvent('status', { message: `Analyzing ${replayRequests.length} captured API calls with Claude…` });
        let fullScript = await streamHarness(baseUrl, loadProfile, replayRequests.length, !!loginRequest, useCsvCredentials, userMessage, sendEvent, validationConfig);
        fullScript = (0, k6PromptBlocks_1.injectCapturedData)(fullScript, dataBlock);
        if (!(0, k6ScriptValidator_1.isBraceBalanced)(fullScript)) {
            sendEvent('status', { message: 'Generated script failed a structural check — retrying once…' });
            fullScript = await streamHarness(baseUrl, loadProfile, replayRequests.length, !!loginRequest, useCsvCredentials, userMessage, sendEvent, validationConfig);
            fullScript = (0, k6PromptBlocks_1.injectCapturedData)(fullScript, dataBlock);
            if (!(0, k6ScriptValidator_1.isBraceBalanced)(fullScript)) {
                sendEvent('error', { message: 'Claude produced a script with mismatched braces twice in a row. Please try again — if this keeps happening, try uploading a smaller HAR file.' });
                res.end();
                return;
            }
        }
        // Bake the real uploaded CSV rows into the script now, rather than leaving
        // the CREDENTIALS placeholder for execution time — the credentials are
        // part of the generated script, not something spliced in later.
        if (useCsvCredentials && csvCredentials.length > 0) {
            fullScript = (0, k6PromptBlocks_1.injectCredentials)(fullScript, csvCredentials);
        }
        sendEvent('complete', {
            script: fullScript,
            testCases: [...(loginCase ? [loginCase] : []), ...replayCases],
            warnings,
            skipped: totalSkipped,
            filesProcessed: files.length,
        });
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
            sendEvent('error', { message: err.message || 'HAR/JSON script generation failed' });
        }
        res.end();
    }
});
exports.default = router;
