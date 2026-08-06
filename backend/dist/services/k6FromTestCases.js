"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTH_HEADER_NAMES = exports.AUTH_URL_PATTERNS = void 0;
exports.toUrlPath = toUrlPath;
exports.isAuthEntry = isAuthEntry;
exports.isWebFormsAuthEntry = isWebFormsAuthEntry;
exports.isAuthHeader = isAuthHeader;
exports.generateK6FromTestCases = generateK6FromTestCases;
const k6InfluxTemplate_1 = require("./k6InfluxTemplate");
function safeName(name) {
    return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
}
function toApiTag(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function detectBaseUrl(testCases) {
    for (const tc of testCases) {
        try {
            const parsed = new URL(tc.url);
            return parsed.origin;
        }
        catch {
            // not an absolute URL — keep scanning
        }
    }
    return 'http://localhost:3000';
}
function toUrlPath(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        return parsed.pathname + parsed.search;
    }
    catch {
        return rawUrl.startsWith('/') ? rawUrl : '/' + rawUrl;
    }
}
// ── Auth detection ────────────────────────────────────────────────────────────
// POST requests to these URL patterns are treated as auth/login calls.
// They are moved to setup() so tokens are captured once and shared with all VUs.
exports.AUTH_URL_PATTERNS = /\/login\b|\/signin\b|\/auth\b|\/security\/login|\/api-session|\/oauth\/token|\/token\b/i;
// Header names that carry session or CSRF tokens — these expire between runs,
// so they are stripped from the static header block and supplied dynamically
// from the data object returned by setup().
exports.AUTH_HEADER_NAMES = new Set([
    'cookie',
    'x-csrf-token',
    'authorization',
    'x-auth-token',
    'x-access-token',
    'x-session-token',
    'rsa-session-token',
    'rsa-archer-session-token',
]);
function isAuthEntry(tc) {
    return tc.method.toUpperCase() === 'POST' && exports.AUTH_URL_PATTERNS.test(tc.url);
}
// ASP.NET WebForms login (e.g. Home.aspx postback with __VIEWSTATE/__EVENTTARGET
// fields): the login page must be GET'd fresh on every run to scrape a
// per-request __VIEWSTATE/__VIEWSTATEGENERATOR/loginCsrfToken — replaying the
// captured literals fails because ASP.NET rejects a stale/mismatched
// __VIEWSTATE. Detected independent of URL pattern, purely by payload shape.
function isWebFormsAuthEntry(tc) {
    if (tc.method.toUpperCase() !== 'POST' || tc.payloadType !== 'form' || !tc.payload)
        return false;
    try {
        const fields = JSON.parse(tc.payload);
        return typeof fields === 'object' && fields !== null && '__VIEWSTATE' in fields && '__EVENTTARGET' in fields;
    }
    catch {
        return false;
    }
}
function isAuthHeader(name) {
    return exports.AUTH_HEADER_NAMES.has(name.toLowerCase());
}
// Returns the JS expression that provides the dynamic value for an auth header
// taken from the setup() return object.
function authHeaderDataExpr(name) {
    const lower = name.toLowerCase();
    if (lower === 'cookie')
        return 'data.cookieHeader';
    if (lower === 'x-csrf-token')
        return 'data.csrfToken';
    if (lower === 'authorization')
        return "data.sessionToken ? ('Bearer ' + data.sessionToken) : ''";
    return 'data.sessionToken';
}
// ── Setup generation with auth pre-call ───────────────────────────────────────
function generateSetupWithAuth(authCase, defaultAspxUrl, maxVus) {
    const urlPath = toUrlPath(authCase.url);
    const payloadExpr = authCase.payload
        ? `JSON.stringify(${authCase.payload})`
        : 'null';
    return `
export function setup() {
  if (INFLUX_V2_ENABLED) { ensureInfluxBucket(); }
  k6VusMax.add(${maxVus}, { testid: TEST_ID });
  const __ts = String(Date.now()) + '000000';
  writeInfluxLines([
    'testStartEnd,' + buildInfluxTagSet({ runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, type: 'started' }) + ' value=1i ' + __ts,
    'k6_vus_max,testid=' + escapeTagValue(TEST_ID) + ' value=${maxVus}i ' + __ts,
  ]);

  // ── S1: POST security/login — session token. Sent with NO headers at all,
  // exactly as captured — the server does not require any on this call. ─────
  const __authRes = http.post(BASE_URL + '${urlPath}', ${payloadExpr}, {
    tags: { name: 'S1_SecurityLogin' },
  });

  if (__authRes.status >= 400) {
    console.error('[Auth] Login failed — status: ' + __authRes.status + ', body: ' + __authRes.body);
  }

  let __sessionToken = '';
  try {
    const __body = __authRes.json();
    // Try common token response shapes in order of specificity
    __sessionToken = (
      (__body.RequestedObject && __body.RequestedObject.SessionToken) ||
      __body.access_token ||
      __body.token ||
      __body.sessionToken ||
      (__body.data && __body.data.token) ||
      (__body.data && __body.data.access_token) ||
      ''
    );
  } catch (__e) {
    console.error('[Auth] Failed to parse login response: ' + __e);
  }

  // Build the Cookie header from the login response's real Set-Cookie values
  // when present (k6 exposes these on res.cookies regardless of the VU cookie
  // jar); fall back to the extracted session token itself.
  const __cookieParts = [];
  if (__authRes.cookies) {
    for (const __cookieName of Object.keys(__authRes.cookies)) {
      const __c = __authRes.cookies[__cookieName][0];
      if (__c) __cookieParts.push(__cookieName + '=' + __c.value);
    }
  }
  const __cookieHeader = __cookieParts.length ? __cookieParts.join('; ') : __sessionToken;

  // ── S2: GET /Default.aspx — csrf token. Also sent with NO headers. ─────────
  const __defaultRes = http.get(BASE_URL + '${defaultAspxUrl}', {
    tags: { name: 'S2_GetDefaultAspx' },
  });
  const __csrfToken = (__defaultRes.body.match(/id="loginCsrfToken" value="([^"]*)"/) || [])[1] || '';

  if (!__cookieHeader) {
    console.warn('[Auth] No session token extracted from security/login — requests may return 401.');
  }
  if (!__csrfToken) {
    console.warn('[Auth] No csrf token extracted from /Default.aspx — requests may return 403.');
  }
  if (__cookieHeader && __csrfToken) {
    console.log('[Auth] Tokens acquired successfully.');
  }

  return { sessionToken: __sessionToken, cookieHeader: __cookieHeader, csrfToken: __csrfToken };
}
`;
}
// Generates a two-step setup() for the ASP.NET WebForms login:
//   S1  GET  Default.aspx        — scrape loginCsrfToken, __VIEWSTATE, __VIEWSTATEGENERATOR
//   S2  POST Home.aspx (form)    — postback with the scraped tokens + credentials; response
//                                   carries the session cookie / auth status
// __VIEWSTATE/__VIEWSTATEGENERATOR/loginCsrfToken are single-use/session-bound —
// replaying the literals captured in the HAR is rejected by the server, so
// they MUST be re-scraped fresh from S1 on every run.
function generateWebFormsAuthSetup(authCase, maxVus) {
    const fields = JSON.parse(authCase.payload);
    const username = fields.txtUserName ?? fields.username ?? '';
    const password = fields.txtpassword ?? fields.password ?? '';
    return `
export function setup() {
  if (INFLUX_V2_ENABLED) { ensureInfluxBucket(); }
  k6VusMax.add(${maxVus}, { testid: TEST_ID });
  const __ts = String(Date.now()) + '000000';
  writeInfluxLines([
    'testStartEnd,' + buildInfluxTagSet({ runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, type: 'started' }) + ' value=1i ' + __ts,
    'k6_vus_max,testid=' + escapeTagValue(TEST_ID) + ' value=${maxVus}i ' + __ts,
  ]);

  // ── S1: GET Default.aspx — scrape loginCsrfToken, __VIEWSTATE, __VIEWSTATEGENERATOR ──
  const __loginPageRes = http.get(BASE_URL + '/Default.aspx', { tags: { name: 'S1_GetDefaultAspx' } });
  const loginCsrfToken      = (__loginPageRes.body.match(/id="loginCsrfToken" value="([^"]*)"/) || [])[1] || '';
  const viewState           = (__loginPageRes.body.match(/id="__VIEWSTATE" value="([^"]*)"/) || [])[1] || '';
  const viewStateGenerator  = (__loginPageRes.body.match(/id="__VIEWSTATEGENERATOR" value="([^"]*)"/) || [])[1] || '';
  if (!viewState || !loginCsrfToken) {
    console.warn('[Auth] Could not scrape __VIEWSTATE/loginCsrfToken from Default.aspx — login will likely fail.');
  }

  const user = {
    username: __ENV.APP_USERNAME || ${JSON.stringify(username)},
    password: __ENV.APP_PASSWORD || ${JSON.stringify(password)},
  };

  // ── S2: POST Home.aspx (form data) — session cookie / auth status ──────────
  const loginPayload = {
    scriptManager_TSM:          '',
    __EVENTTARGET:              'btnLogin',
    __EVENTARGUMENT:            '',
    __VIEWSTATE:                viewState,
    __VIEWSTATEGENERATOR:       viewStateGenerator,
    loginCsrfToken:             loginCsrfToken,
    showDomainRow:              'False',
    txtUserName:                user.username,
    txtUserName_ClientState:    JSON.stringify({
      enabled: true,
      emptyMessage: '',
      validationText: user.username,
      valueAsString: user.username,
      lastSetTextBoxValue: user.username,
    }),
    txtpassword:                user.password,
    txtpassword_ClientState:    JSON.stringify({
      enabled: true,
      emptyMessage: '',
      validationText: user.password,
      valueAsString: user.password,
      lastSetTextBoxValue: user.password,
    }),
  };

  const loginRes = http.post(BASE_URL + '/Home.aspx', loginPayload, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    tags: { name: 'S2_T01_Login' },
  });

  if (loginRes.status >= 400) {
    console.error('[Auth] Login failed — status: ' + loginRes.status);
  } else {
    console.log('[Auth] Login postback completed — status: ' + loginRes.status);
  }

  // Build the Cookie header from the login response's real Set-Cookie values
  // (this is the session cookie / auth status S2 is captured for above).
  const __cookieParts = [];
  if (loginRes.cookies) {
    for (const __cookieName of Object.keys(loginRes.cookies)) {
      const __c = loginRes.cookies[__cookieName][0];
      if (__c) __cookieParts.push(__cookieName + '=' + __c.value);
    }
  }
  const cookieHeader = __cookieParts.join('; ');
  if (!cookieHeader) {
    console.warn('[Auth] No session cookie returned from Home.aspx — requests may be unauthenticated.');
  }

  return { sessionToken: '', cookieHeader: cookieHeader, csrfToken: loginCsrfToken };
}
`;
}
function generateK6FromTestCases(testCases, loadProfile) {
    if (testCases.length === 0)
        return '// No test cases provided';
    const suiteName = 'test_suite';
    const baseUrl = detectBaseUrl(testCases);
    const stages = loadProfile?.stages ?? [
        { duration: '1m', target: 10 },
        { duration: '3m', target: 50 },
        { duration: '1m', target: 0 },
    ];
    const totalWeight = testCases.reduce((s, tc) => s + tc.weight, 0);
    // Separate auth/login entries from load-test entries.
    // Auth entries are called once in setup() to capture fresh tokens;
    // they are NOT included as load-test scenarios.
    const webFormsAuthCase = testCases.find(isWebFormsAuthEntry) ?? null;
    const authCase = webFormsAuthCase ?? testCases.find(isAuthEntry) ?? null;
    const hasAuth = authCase !== null;
    // Both auth flows GET .../Default.aspx themselves inside setup() (WebForms
    // for S1's token scrape, the generic flow for its csrf token) — a captured
    // GET to that same page must be excluded from the load-test scenarios so
    // it isn't redundantly replayed as a scenario too.
    const defaultAspxCase = hasAuth
        ? testCases.find(tc => tc !== authCase && tc.method.toUpperCase() === 'GET' && /Default\.aspx/i.test(tc.url)) ?? null
        : null;
    const mainCases = testCases.filter(tc => tc !== authCase && tc !== defaultAspxCase);
    // Build unique safe names for the main (non-auth) test cases.
    const usedNames = new Map();
    const uniqueNames = mainCases.map(tc => {
        const base = safeName(tc.name);
        const count = usedNames.get(base) ?? 0;
        usedNames.set(base, count + 1);
        return count === 0 ? base : `${base}_${count}`;
    });
    // ── scenarios ──────────────────────────────────────────────────────────────
    const scenariosObj = {};
    mainCases.forEach((tc, idx) => {
        const n = uniqueNames[idx];
        const scaledStages = stages.map((s) => ({
            duration: s.duration,
            target: Math.max(1, Math.round(((s.target ?? 0) * tc.weight) / Math.max(totalWeight, 1))),
        }));
        scenariosObj[n] = {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: scaledStages,
            exec: `${n}Test`,
            tags: { scenario: n },
        };
    });
    // ── thresholds ─────────────────────────────────────────────────────────────
    const thresholdEntries = mainCases.map((tc, idx) => {
        const n = uniqueNames[idx];
        return `    'k6_http_req_duration_seconds{scenario:${n}}': ['p(95)<${tc.responseThresholdMs / 1000}'],`;
    });
    thresholdEntries.push(`    'http_req_failed': ['rate<0.01'],`);
    // ── test functions ─────────────────────────────────────────────────────────
    const testFunctions = mainCases.map((tc, idx) => {
        const n = uniqueNames[idx];
        const apiTag = toApiTag(tc.name);
        const stepName = `${String(idx + 1).padStart(2, '0')}_${tc.name}`;
        const urlPath = toUrlPath(tc.url);
        // Split headers into static (safe to hardcode) and dynamic (auth tokens).
        const staticHeaders = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        };
        const dynamicAuthKeys = [];
        for (const [k, v] of Object.entries(tc.headers)) {
            if (isAuthHeader(k)) {
                // Only emit a dynamic auth entry if auth setup is active.
                // If no auth was detected in the HAR, keep the header static as a fallback.
                if (hasAuth) {
                    dynamicAuthKeys.push({ key: k, expr: authHeaderDataExpr(k) });
                }
                else {
                    staticHeaders[k] = v;
                }
            }
            else {
                staticHeaders[k] = v;
            }
        }
        const staticHeadersJson = JSON.stringify(staticHeaders, null, 6)
            .replace(/^/gm, '      ')
            .trim();
        // Build the dynamic auth merge block when auth setup is active
        let dynamicHeadersMerge = '';
        if (hasAuth && dynamicAuthKeys.length > 0) {
            const dynEntries = dynamicAuthKeys
                .map(({ key, expr }) => `        '${key}': ${expr}`)
                .join(',\n');
            dynamicHeadersMerge = `, Object.assign({}, data ? {\n${dynEntries}\n      } : {})`;
        }
        const headersExpr = hasAuth && dynamicAuthKeys.length > 0
            ? `Object.assign({\n      ${staticHeadersJson}\n    }${dynamicHeadersMerge})`
            : staticHeadersJson;
        // k6 exposes DELETE as http.del() — 'delete' is a reserved JS keyword
        const k6Method = (m) => m === 'DELETE' ? 'del' : m.toLowerCase();
        const upperMethod = tc.method.toUpperCase();
        const urlExpr = `BASE_URL + '${urlPath}'`;
        let httpCall = '';
        let sentBytesExpr = '0';
        if (upperMethod === 'GET' || upperMethod === 'DELETE') {
            httpCall = `    const res = http.${k6Method(upperMethod)}(${urlExpr}, {
      headers: ${headersExpr},
      tags: { scenario: '${n}', api: '${apiTag}', name: '${upperMethod} ${urlPath}' },
    });`;
        }
        else {
            // 'form' payloads are already a real {field: value} object literal (see
            // harParser.ts) — pass it to http.post as-is so k6 auto-urlencodes it,
            // instead of JSON.stringify-ing it into a broken JSON body.
            const payloadStr = tc.payload
                ? (tc.payloadType === 'form' ? tc.payload : `JSON.stringify(${tc.payload})`)
                : 'null';
            httpCall = `    const payload = ${payloadStr};
    const res = http.${k6Method(upperMethod)}(${urlExpr}, payload, {
      headers: ${headersExpr},
      tags: { scenario: '${n}', api: '${apiTag}', name: '${upperMethod} ${urlPath}' },
    });`;
            sentBytesExpr = tc.payload ? 'getByteLength(payload)' : '0';
        }
        const recordCall = (0, k6InfluxTemplate_1.influxRecordCall)('res', `'${n}'`, apiTag, urlPath, sentBytesExpr, stepName);
        // When auth is active, every exec function receives the setup() return value as `data`
        const fnParam = hasAuth ? 'data' : '';
        return `export function ${n}Test(${fnParam}) {
  const _ts = String(Date.now()) + '000000';
  k6IterationsTotal.add(1, { testid: TEST_ID, scenario: '${n}' });
  k6Vus.add(1,             { testid: TEST_ID, scenario: '${n}', vu: String(__VU) });
  writeInfluxLines([
    'k6_iterations_total,testid=' + escapeTagValue(TEST_ID) + ',scenario=${n} value=1i ' + _ts,
    'k6_vus,testid='              + escapeTagValue(TEST_ID) + ',scenario=${n},vu=' + escapeTagValue(__VU) + ' value=1 ' + _ts,
    'virtualUsers,runId='         + escapeTagValue(RUN_ID)  + ',nodeName=' + escapeTagValue(NODE_NAME) + ',testName=' + escapeTagValue(TEST_NAME) +
      ' meanActiveThreads=1,finishedThreads=' + __ITER + ' ' + _ts,
  ]);

  group('${stepName}', () => {
${httpCall}

    check(res, {
      'status is ${tc.expectedStatus}': (r) => r.status === ${tc.expectedStatus},
      'response time < ${tc.responseThresholdMs}ms': (r) => r.timings.duration < ${tc.responseThresholdMs},
    });

    ${recordCall}

    if (res.status >= 400) {
      console.error('${tc.name} failed: ' + res.status);
    }
  });
  sleep(1);
}`;
    }).join('\n\n');
    const maxVus = Math.max(...stages.map((s) => s.target ?? 0), 1);
    const setupBlock = webFormsAuthCase
        ? generateWebFormsAuthSetup(webFormsAuthCase, maxVus)
        : hasAuth
            ? generateSetupWithAuth(authCase, defaultAspxCase ? toUrlPath(defaultAspxCase.url) : '/Default.aspx', maxVus)
            : (0, k6InfluxTemplate_1.influxSetup)(maxVus);
    return `${(0, k6InfluxTemplate_1.influxImports)()}

const SCENARIO_NAME = '${suiteName}';

${(0, k6InfluxTemplate_1.influxEnvAndMetrics)('Test Suite', baseUrl)}

export const options = {
  scenarios: ${JSON.stringify(scenariosObj, null, 2)},
  thresholds: {
${thresholdEntries.join('\n')}
  },
  tags: { testid: TEST_ID },
};

${(0, k6InfluxTemplate_1.influxHelperFunctions)()}
${setupBlock}
${(0, k6InfluxTemplate_1.influxTeardown)()}

${testFunctions}

export default function () {
  // Default function is unused — scenarios call named exec functions directly.
  // Included to satisfy k6 script validation.
}

export function handleSummary(data) {
  return { stdout: textSummary(data, { indent: '  ', enableColors: true }) };
}
`;
}
