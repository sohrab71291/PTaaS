"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateK6FromTestCases = generateK6FromTestCases;
const k6InfluxTemplate_1 = require("./k6InfluxTemplate");
function safeName(name) {
    return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
}
function toApiTag(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function generateK6FromTestCases(testCases, loadProfile) {
    if (testCases.length === 0)
        return '// No test cases provided';
    const suiteName = 'test_suite';
    const stages = loadProfile?.stages ?? [
        { duration: '1m', target: 10 },
        { duration: '3m', target: 50 },
        { duration: '1m', target: 0 },
    ];
    const totalWeight = testCases.reduce((s, tc) => s + tc.weight, 0);
    // ── scenarios ──────────────────────────────────────────────────────────────
    const scenariosObj = {};
    testCases.forEach(tc => {
        const n = safeName(tc.name);
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
    const thresholdEntries = testCases.map(tc => {
        const n = safeName(tc.name);
        return `    'k6_http_req_duration_seconds{scenario:${n}}': ['p(95)<${tc.responseThresholdMs / 1000}'],`;
    });
    thresholdEntries.push(`    'http_req_failed': ['rate<0.01'],`);
    // ── test functions ─────────────────────────────────────────────────────────
    const testFunctions = testCases.map((tc, idx) => {
        const n = safeName(tc.name);
        const apiTag = toApiTag(tc.name);
        const stepName = `${String(idx + 1).padStart(2, '0')}_${tc.name}`;
        const urlPath = tc.url.startsWith('/') ? tc.url : '/' + tc.url;
        const headersObj = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...tc.headers,
        };
        const headersJson = JSON.stringify(headersObj, null, 6)
            .replace(/^/gm, '      ')
            .trim();
        let httpCall = '';
        let sentBytesExpr = '0';
        const upperMethod = tc.method.toUpperCase();
        const urlExpr = `BASE_URL + '${urlPath}'`;
        if (upperMethod === 'GET' || upperMethod === 'DELETE') {
            httpCall = `    const res = http.${upperMethod.toLowerCase()}(${urlExpr}, {
      headers: ${headersJson},
      tags: { scenario: '${n}', api: '${apiTag}', name: '${upperMethod} ${urlPath}' },
    });`;
        }
        else {
            const payloadStr = tc.payload ? `JSON.stringify(${tc.payload})` : 'null';
            httpCall = `    const payload = ${payloadStr};
    const res = http.${upperMethod.toLowerCase()}(${urlExpr}, payload, {
      headers: ${headersJson},
      tags: { scenario: '${n}', api: '${apiTag}', name: '${upperMethod} ${urlPath}' },
    });`;
            sentBytesExpr = tc.payload ? 'getByteLength(payload)' : '0';
        }
        const recordCall = (0, k6InfluxTemplate_1.influxRecordCall)('res', `'${n}'`, apiTag, urlPath, sentBytesExpr, stepName);
        return `export function ${n}Test() {
  // VU tracking for this scenario
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
    // Peak VUs = the maximum target across the shared stage profile
    const maxVus = Math.max(...stages.map((s) => s.target ?? 0), 1);
    return `${(0, k6InfluxTemplate_1.influxImports)()}

const SCENARIO_NAME = '${suiteName}';

${(0, k6InfluxTemplate_1.influxEnvAndMetrics)('Test Suite')}

export const options = {
  scenarios: ${JSON.stringify(scenariosObj, null, 2)},
  thresholds: {
${thresholdEntries.join('\n')}
  },
  tags: { testid: TEST_ID },
};

${(0, k6InfluxTemplate_1.influxHelperFunctions)()}
${(0, k6InfluxTemplate_1.influxSetup)(maxVus)}
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
