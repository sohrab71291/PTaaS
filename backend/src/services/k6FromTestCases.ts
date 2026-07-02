import {
  influxImports,
  influxEnvAndMetrics,
  influxHelperFunctions,
  influxSetup,
  influxTeardown,
  influxRecordCall,
} from './k6InfluxTemplate';

export interface ParsedTestCase {
  name: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  payload: string | null;
  expectedStatus: number;
  responseThresholdMs: number;
  weight: number;
  tags: string[];
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
}

function toApiTag(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function detectBaseUrl(testCases: ParsedTestCase[]): string {
  for (const tc of testCases) {
    try {
      const parsed = new URL(tc.url);
      return parsed.origin;
    } catch {
      // not an absolute URL — keep scanning
    }
  }
  return 'http://localhost:3000';
}

function toUrlPath(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname + parsed.search;
  } catch {
    return rawUrl.startsWith('/') ? rawUrl : '/' + rawUrl;
  }
}

// ── Auth detection ────────────────────────────────────────────────────────────

// POST requests to these URL patterns are treated as auth/login calls.
// They are moved to setup() so tokens are captured once and shared with all VUs.
const AUTH_URL_PATTERNS = /\/login\b|\/signin\b|\/auth\b|\/security\/login|\/api-session|\/oauth\/token|\/token\b/i;

// Header names that carry session or CSRF tokens — these expire between runs,
// so they are stripped from the static header block and supplied dynamically
// from the data object returned by setup().
const AUTH_HEADER_NAMES = new Set([
  'x-csrf-token',
  'authorization',
  'x-auth-token',
  'x-access-token',
  'x-session-token',
  'rsa-session-token',
  'rsa-archer-session-token',
]);

function isAuthEntry(tc: ParsedTestCase): boolean {
  return tc.method.toUpperCase() === 'POST' && AUTH_URL_PATTERNS.test(tc.url);
}

function isAuthHeader(name: string): boolean {
  return AUTH_HEADER_NAMES.has(name.toLowerCase());
}

// Returns the JS expression that provides the dynamic value for an auth header
// taken from the setup() return object.
function authHeaderDataExpr(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'x-csrf-token') return 'data.csrfToken';
  if (lower === 'authorization') return "data.sessionToken ? ('Bearer ' + data.sessionToken) : ''";
  return 'data.sessionToken';
}

// ── Setup generation with auth pre-call ───────────────────────────────────────

function generateSetupWithAuth(
  authCase: ParsedTestCase,
  maxVus: number,
): string {
  const urlPath = toUrlPath(authCase.url);

  // Strip auth headers from the login call itself — we don't have a token yet.
  const loginHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  for (const [k, v] of Object.entries(authCase.headers)) {
    if (!isAuthHeader(k)) loginHeaders[k] = v;
  }
  const loginHeadersJson = JSON.stringify(loginHeaders, null, 4)
    .replace(/^/gm, '    ')
    .trim();

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

  // ── Pre-test authentication ───────────────────────────────────────────────
  // Called once before any VU starts. The returned sessionToken / csrfToken are
  // passed as the data argument to every exec function so that all requests
  // use fresh, non-expired credentials rather than the static tokens captured
  // in the HAR file.
  const __authRes = http.post(BASE_URL + '${urlPath}', ${payloadExpr}, {
    headers: ${loginHeadersJson},
    tags: { name: 'auth-setup', step: 'auth-precheck' },
  });

  if (__authRes.status >= 400) {
    console.error('[Auth] Login failed — status: ' + __authRes.status + ', body: ' + __authRes.body);
  }

  let __sessionToken = '';
  let __csrfToken = '';
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
    // CSRF token: check response header first, then fall back to session token
    // (many APIs reuse the session token as the CSRF value)
    __csrfToken = __authRes.headers['X-Csrf-Token'] ||
                  __authRes.headers['x-csrf-token'] ||
                  __sessionToken;
  } catch (__e) {
    console.error('[Auth] Failed to parse login response: ' + __e);
  }

  if (!__sessionToken && !__csrfToken) {
    console.warn('[Auth] No token extracted from login response — requests may return 401.');
  } else {
    console.log('[Auth] Tokens acquired successfully.');
  }

  return { sessionToken: __sessionToken, csrfToken: __csrfToken };
}
`;
}

export function generateK6FromTestCases(testCases: ParsedTestCase[], loadProfile?: any): string {
  if (testCases.length === 0) return '// No test cases provided';

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
  const authCase = testCases.find(isAuthEntry) ?? null;
  const mainCases = testCases.filter(tc => !isAuthEntry(tc));
  const hasAuth = authCase !== null;

  // Build unique safe names for the main (non-auth) test cases.
  const usedNames = new Map<string, number>();
  const uniqueNames = mainCases.map(tc => {
    const base = safeName(tc.name);
    const count = usedNames.get(base) ?? 0;
    usedNames.set(base, count + 1);
    return count === 0 ? base : `${base}_${count}`;
  });

  // ── scenarios ──────────────────────────────────────────────────────────────
  const scenariosObj: Record<string, any> = {};
  mainCases.forEach((tc, idx) => {
    const n = uniqueNames[idx];
    const scaledStages = stages.map((s: any) => ({
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
    const n        = uniqueNames[idx];
    const apiTag   = toApiTag(tc.name);
    const stepName = `${String(idx + 1).padStart(2, '0')}_${tc.name}`;
    const urlPath  = toUrlPath(tc.url);

    // Split headers into static (safe to hardcode) and dynamic (auth tokens).
    const staticHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const dynamicAuthKeys: Array<{ key: string; expr: string }> = [];

    for (const [k, v] of Object.entries(tc.headers)) {
      if (isAuthHeader(k)) {
        // Only emit a dynamic auth entry if auth setup is active.
        // If no auth was detected in the HAR, keep the header static as a fallback.
        if (hasAuth) {
          dynamicAuthKeys.push({ key: k, expr: authHeaderDataExpr(k) });
        } else {
          staticHeaders[k] = v;
        }
      } else {
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
    const k6Method = (m: string) => m === 'DELETE' ? 'del' : m.toLowerCase();
    const upperMethod = tc.method.toUpperCase();
    const urlExpr = `BASE_URL + '${urlPath}'`;

    let httpCall = '';
    let sentBytesExpr = '0';

    if (upperMethod === 'GET' || upperMethod === 'DELETE') {
      httpCall = `    const res = http.${k6Method(upperMethod)}(${urlExpr}, {
      headers: ${headersExpr},
      tags: { scenario: '${n}', api: '${apiTag}', name: '${upperMethod} ${urlPath}' },
    });`;
    } else {
      const payloadStr = tc.payload ? `JSON.stringify(${tc.payload})` : 'null';
      httpCall = `    const payload = ${payloadStr};
    const res = http.${k6Method(upperMethod)}(${urlExpr}, payload, {
      headers: ${headersExpr},
      tags: { scenario: '${n}', api: '${apiTag}', name: '${upperMethod} ${urlPath}' },
    });`;
      sentBytesExpr = tc.payload ? 'getByteLength(payload)' : '0';
    }

    const recordCall = influxRecordCall('res', `'${n}'`, apiTag, urlPath, sentBytesExpr, stepName);

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

  const maxVus = Math.max(...stages.map((s: any) => s.target ?? 0), 1);

  const setupBlock = hasAuth
    ? generateSetupWithAuth(authCase!, maxVus)
    : influxSetup(maxVus);

  return `${influxImports()}

const SCENARIO_NAME = '${suiteName}';

${influxEnvAndMetrics('Test Suite', baseUrl)}

export const options = {
  scenarios: ${JSON.stringify(scenariosObj, null, 2)},
  thresholds: {
${thresholdEntries.join('\n')}
  },
  tags: { testid: TEST_ID },
};

${influxHelperFunctions()}
${setupBlock}
${influxTeardown()}

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
