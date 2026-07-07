import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import multer from 'multer';
import { parseHar } from '../services/harParser';
import {
  ParsedTestCase, isAuthEntry, isAuthHeader, toUrlPath,
} from '../services/k6FromTestCases';
import { buildInfluxBlock, HANDLE_SUMMARY_BLOCK, DATA_PLACEHOLDER, injectCapturedData } from '../services/k6PromptBlocks';
import { isBraceBalanced } from '../services/k6ScriptValidator';
import {
  getAnthropicClient, hasAnthropicCredentials, isOverloadedError,
  CLAUDE_MODEL, MAX_STREAM_ATTEMPTS, STREAM_BACKOFF_MS, stripCodeFences,
} from '../services/anthropicClient';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
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
const MAX_CAPTURED_CALLS = 1000;

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
    return `\nLOAD PROFILE — none was configured; use a sensible default: ramping-vus with stages [{ target: 10, duration: '2m' }, { target: 10, duration: '5m' }, { target: 0, duration: '1m' }].\n`;
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

function buildHarSystemPrompt(baseUrl: string | null, loadProfile: LoadProfileConfig | null, totalCalls: number, hasLogin: boolean): string {
  return `You are an expert performance engineer specializing in k6 load testing with InfluxDB v2 integration. You are writing a REPLAY HARNESS for a captured browser session (HAR export) — a small, fixed amount of code that iterates generically over an already-extracted array of API calls. You do NOT write one code block per captured call; the calls themselves are supplied to you as a runtime data array, not something you transcribe.
${describeLoadProfile(loadProfile)}
LOGIN_REQUEST and CAPTURED_REQUESTS are constants that will be injected into your script automatically — do NOT declare or redeclare them yourself, do NOT attempt to enumerate, copy, or transcribe their contents. Their shapes are:
  LOGIN_REQUEST: ${hasLogin ? `{ method: string, path: string, headers: object, payload: string|null, payloadType: 'json'|'form', cookieNameHint: string|null } — a single detected login/auth call` : `null — no login/auth call was detected in the captured session`}
  CAPTURED_REQUESTS: Array<{ name: string, method: string, path: string, headers: object, payload: string|null, payloadType: 'json'|'form', expectedStatus: number, responseThresholdMs: number }> — the ${totalCalls} non-login calls to replay, in the order they were captured.
  payloadType 'form' means payload is a JSON-encoded {field: value} object that was originally submitted as application/x-www-form-urlencoded — it MUST be sent as a real form body (see requestBody() helper in the REPLAY HARNESS PATTERN below), never re-encoded as JSON.

MANDATORY RULES — every rule must be followed exactly:
1. Output ONLY valid JavaScript — no markdown, no code fences, no explanation text.
2. Structure, in this exact order: (a) imports — http from 'k6/http', { check, group, sleep } from 'k6', metrics from 'k6/metrics', textSummary from the jslib summary URL; (b) the single line ${DATA_PLACEHOLDER} on its own line, verbatim, immediately after the imports — this is where the real captured-request data gets spliced in; (c) the InfluxDB v2 integration block shown below, word for word; (d) the REPLAY HARNESS PATTERN shown below; (e) handleSummary.
3. Use __ENV.BASE_URL for all request base URLs, defaulting to ${baseUrl ? `'${baseUrl}' (this is the origin the captured calls were made against — do NOT use localhost)` : `'http://localhost:3000'`}.
4. Do NOT write a separate function or group() per captured call. Write exactly the generic replayStep()/sessionReplay() functions shown in the REPLAY HARNESS PATTERN below — they already iterate over every entry in CAPTURED_REQUESTS, which guarantees complete coverage without you needing to enumerate anything.
5. SCENARIO_MAX_VUS must be computed with Math.max and ?? (not ||): const SCENARIO_MAX_VUS = Math.max(...Object.values(options.scenarios).flatMap(s => (s.stages||[]).map(st => st.target ?? 0)), 1);
6. Use ?? instead of || when the right-hand side is a fallback for null/undefined.
7. handleSummary must output ONLY stdout — do NOT write any file (no summary.json).
8. Pick a descriptive TEST_NAME and SCENARIO_NAME based on the nature of the captured session (e.g. inferred from the request paths), and set options.thresholds to sensible defaults (p(95)<800, http_req_failed rate<0.8) unless told otherwise above. Keep http_req_failed very lenient — setup() never aborts the run on a failed login (see rule 11), so when auth genuinely fails every subsequent authenticated call can legitimately 401/403 for the rest of the run; the real per-step pass/fail signal comes from the isResponseStatusExpected()-based check() in replayStep below, not from this blanket threshold.
9. The InfluxDB block below already declares isResponseStatusExpected(response, expectedStatus) — reuse it verbatim in replayStep's check()/error-logging. Do not redeclare it.
10. ALWAYS include the closing 'export default function (setupData) { sessionReplay(setupData); }' shown at the end of the REPLAY HARNESS PATTERN, even though the scenario's own exec already names sessionReplay. It is a required safety net: a k6 script with no exported function at all fails to start with an opaque error instead of running.
11. Detect the login/auth call with the findLoginRequest() helper shown below (LOGIN_REQUEST if present, else the first CAPTURED_REQUESTS entry whose name/path mentions login/auth/signin, else none) — call it identically in both setup() and sessionReplay() so both agree on which entry is "the login" and which entries are ordinary replay steps. Never fall back to blindly treating CAPTURED_REQUESTS[0] as the login — an arbitrary first request (e.g. a homepage GET) is not necessarily auth-related.
12. setup() must NEVER throw when authentication doesn't yield a session — log a warning and return the jar so the run continues without auth headers instead of aborting the whole test. A broken/expired captured login must degrade to "requests run unauthenticated" (likely surfacing as tolerated 401/403s per rule 8), not stop execution entirely.

${buildInfluxBlock(baseUrl)}
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

Merge the login handling into the setup() shown above (do not write a second
setup()) — after the InfluxDB bootstrap lines. Create ONE shared http.cookieJar()
here and thread it through every request (login and replay alike) so cookies set
by any step carry forward. Use findLoginRequest() to find it — if it returns
null, there is genuinely nothing to authenticate with, so log that and continue:

export function setup() {
  if (INFLUX_V2_ENABLED) { ensureInfluxBucket(); }
  k6VusMax.add(SCENARIO_MAX_VUS, { testid: TEST_ID });
  const ts = String(Date.now()) + '000000';
  writeInfluxLines([
    'testStartEnd,' + buildInfluxTagSet({ runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, type: 'started' }) + ' value=1i ' + ts,
    'k6_vus_max,testid=' + escapeTagValue(TEST_ID) + ' value=' + SCENARIO_MAX_VUS + 'i ' + ts,
  ]);

  const jar = http.cookieJar();
  const effectiveLoginRequest = findLoginRequest(CAPTURED_REQUESTS);
  if (!effectiveLoginRequest) {
    console.log('Setup: no login/auth request found; continuing without authentication.');
    return { jar: jar };
  }

  const res = http.request(
    effectiveLoginRequest.method,
    BASE_URL + effectiveLoginRequest.path,
    requestBody(effectiveLoginRequest.payload, effectiveLoginRequest.payloadType),
    {
      headers: sanitizeHeaders(effectiveLoginRequest.headers),
      redirects: 5,
      tags: { name: effectiveLoginRequest.name || effectiveLoginRequest.path },
      jar: jar,
    }
  );

  const body = getResponseBody(res);
  const sessionToken = (
    (body.RequestedObject && body.RequestedObject.SessionToken) ||
    body.access_token || body.token || body.sessionToken ||
    (body.data && body.data.token) || (body.data && body.data.access_token) || ''
  );
  const cookieHeader = buildCookieHeader(res, sessionToken, effectiveLoginRequest);

  // NEVER throw here, even when the login produced nothing usable — a broken
  // or expired captured login must degrade to "requests run unauthenticated"
  // (later calls may legitimately 401/403, tolerated by the lenient threshold
  // and isResponseStatusExpected()), not abort the entire run before any
  // other request gets a chance to execute.
  if (!cookieHeader && !sessionToken && !(res.status >= 300 && res.status < 400)) {
    console.warn('Setup: authentication request returned no session data; continuing without auth headers.');
    return { jar: jar };
  }

  console.log('Setup: authentication completed with status ' + res.status + '.');
  return { jar: jar, cookieHeader: cookieHeader };
}

Write exactly ONE generic step-executor function — it is called once per entry
in CAPTURED_REQUESTS, so it must not reference any specific captured call. Reuse
isResponseStatusExpected(response, expectedStatus) from the InfluxDB block above
instead of a strict === comparison — replayed sessions can legitimately land on
a matching-class redirect or a 401/403 auth-probe that isn't a real failure:

function replayStep(reqDef, jar, authHeaders) {
  const url = BASE_URL + reqDef.path;
  const params = {
    headers: Object.assign({}, sanitizeHeaders(reqDef.headers), authHeaders),
    redirects: 5,
    tags: { name: reqDef.name },
    jar: jar,
  };
  const res = http.request(reqDef.method, url, requestBody(reqDef.payload, reqDef.payloadType), params);

  check(res, {
    [reqDef.name + ' status is ' + reqDef.expectedStatus]: function (r) { return isResponseStatusExpected(r, reqDef.expectedStatus); },
    [reqDef.name + ' response time < ' + reqDef.responseThresholdMs + 'ms']: function (r) { return r.timings.duration < reqDef.responseThresholdMs; },
  });

  recordCustomMetrics(res, SCENARIO_NAME, reqDef.name, reqDef.path, getByteLength(reqDef.payload || ''), reqDef.name, reqDef.expectedStatus);

  if (res.status >= 400 && !isResponseStatusExpected(res, reqDef.expectedStatus)) {
    const responseBody = String(res.body || '').substring(0, 800);
    const responseHeaders = JSON.stringify(res.headers || {});
    console.error(reqDef.name + ' failed: ' + res.status + ' body=' + responseBody + ' headers=' + responseHeaders);
  }
}

Write exactly ONE exported iteration function — this is the scenario's exec
function. It loops over the injected CAPTURED_REQUESTS array (do not write any
other exec function, and do not unroll this loop). Reuse the cookie jar from
setup() so cookies set during login (or by earlier replay steps) carry forward,
and call findLoginRequest() again (same helper, same result) to exclude that
exact entry from replay — it already ran once in setup(). Do NOT substitute a
different heuristic here (e.g. CAPTURED_REQUESTS[0]): setup() and sessionReplay()
must agree on exactly which entry is "the login", or the login step ends up
replayed twice while an unrelated entry is silently dropped:

export function sessionReplay(setupData) {
  const jar = (setupData && setupData.jar) ? setupData.jar : http.cookieJar();
  const authHeaders = (setupData && setupData.cookieHeader) ? { Cookie: setupData.cookieHeader } : {};
  const _ts = String(Date.now()) + '000000';
  k6IterationsTotal.add(1, { testid: TEST_ID, scenario: SCENARIO_NAME });
  k6Vus.add(1, { testid: TEST_ID, scenario: SCENARIO_NAME, vu: String(__VU) });
  writeInfluxLines([
    'k6_iterations_total,testid=' + escapeTagValue(TEST_ID) + ',scenario=' + escapeTagValue(SCENARIO_NAME) + ' value=1i ' + _ts,
    'k6_vus,testid=' + escapeTagValue(TEST_ID) + ',scenario=' + escapeTagValue(SCENARIO_NAME) + ',vu=' + escapeTagValue(__VU) + ' value=1 ' + _ts,
    'virtualUsers,' + buildInfluxTagSet({ runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, scenario: SCENARIO_NAME }) + ' meanActiveThreads=1,finishedThreads=' + __ITER + ' ' + _ts,
  ]);

  const effectiveLoginRequest = findLoginRequest(CAPTURED_REQUESTS);
  const replayRequests = effectiveLoginRequest
    ? CAPTURED_REQUESTS.filter(function (reqDef) {
        return !(reqDef.name === effectiveLoginRequest.name && reqDef.method === effectiveLoginRequest.method && reqDef.path === effectiveLoginRequest.path);
      })
    : CAPTURED_REQUESTS;

  for (let i = 0; i < replayRequests.length; i++) {
    const reqDef = replayRequests[i];
    group(reqDef.name, function () {
      replayStep(reqDef, jar, authHeaders);
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
  userMessage: string,
  sendEvent: (type: string, data: any) => void,
): Promise<string> {
  let stream: Awaited<ReturnType<Anthropic['messages']['stream']>> | null = null;
  for (let attempt = 0; attempt < MAX_STREAM_ATTEMPTS; attempt++) {
    try {
      stream = await getAnthropicClient().messages.stream({
        model: CLAUDE_MODEL,
        max_tokens: 8096,
        system: buildHarSystemPrompt(baseUrl, loadProfile, totalCalls, hasLogin),
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

  const loginRequest: LoginRequest | null = loginCase ? toLoginRequest(loginCase, cookieNameHint) : null;
  const replayRequests: ReplayRequest[] = replayCases.map(toReplayRequest);

  const dataBlock = `const LOGIN_REQUEST = ${JSON.stringify(loginRequest)};
const CAPTURED_REQUESTS = ${JSON.stringify(replayRequests)};`;

  const userMessageParts = [
    loginRequest
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

    let fullScript = await streamHarness(baseUrl, loadProfile, replayRequests.length, !!loginRequest, userMessage, sendEvent);
    fullScript = injectCapturedData(fullScript, dataBlock);

    if (!isBraceBalanced(fullScript)) {
      sendEvent('status', { message: 'Generated script failed a structural check — retrying once…' });
      fullScript = await streamHarness(baseUrl, loadProfile, replayRequests.length, !!loginRequest, userMessage, sendEvent);
      fullScript = injectCapturedData(fullScript, dataBlock);

      if (!isBraceBalanced(fullScript)) {
        sendEvent('error', { message: 'Claude produced a script with mismatched braces twice in a row. Please try again — if this keeps happening, try uploading a smaller HAR file.' });
        res.end();
        return;
      }
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
