"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateK6Script = generateK6Script;
const k6InfluxTemplate_1 = require("./k6InfluxTemplate");
function generateK6Script(spec, baseUrl = 'https://api.example.com') {
    const { name, request, loadProfile, thresholds, checks, tags } = spec;
    const scenarioName = toScenarioName(name);
    // ── options block ──────────────────────────────────────────────────────────
    const stagesJson = (loadProfile.stages ?? [])
        .map(s => `    { duration: '${s.duration}', target: ${s.target} }`)
        .join(',\n');
    // http_req_duration/http_req_failed are k6 system metrics that, unscoped,
    // aggregate EVERY http call the script makes — including the InfluxDB
    // write/precheck traffic from the InfluxDB boilerplate (k6InfluxTemplate.ts).
    // Scoping to {endpoint_type:app} restricts them to the actual request under
    // test (tagged below), which never includes the InfluxDB calls (those are
    // deliberately left untagged for endpoint_type). 'checks' doesn't need this —
    // check() is only ever called against the app response, never against
    // InfluxDB's own responses, so it's already unpolluted.
    const SYSTEM_METRICS_NEEDING_APP_SCOPE = new Set(['http_req_duration', 'http_req_failed']);
    const thresholdEntries = Object.entries(thresholds)
        .map(([metric, conditions]) => {
        const condArr = conditions.map(c => `'${c.condition}'`).join(', ');
        const key = SYSTEM_METRICS_NEEDING_APP_SCOPE.has(metric) ? `${metric}{endpoint_type:app}` : metric;
        return `    '${key}': [${condArr}]`;
    })
        .join(',\n');
    const tagsStr = tags.map(t => `'${t}'`).join(', ');
    const firstStage = (loadProfile.stages ?? [])[0];
    let optionsBlock = '';
    if (loadProfile.type === 'arrival-rate') {
        optionsBlock = `export const options = {
  scenarios: {
    ${scenarioName}: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: ${firstStage?.target ?? 50},
      stages: [
${stagesJson}
      ],
      gracefulStop: '5s',
      tags: { scenario: '${scenarioName}' },
    },
  },
  thresholds: {
${thresholdEntries}
  },
  tags: { testid: TEST_ID, testName: '${name}', tags: [${tagsStr}] },
};`;
    }
    else if (loadProfile.type === 'constant') {
        optionsBlock = `export const options = {
  scenarios: {
    ${scenarioName}: {
      executor: 'constant-vus',
      vus: ${firstStage?.target ?? 10},
      duration: '${firstStage?.duration ?? '5m'}',
      gracefulStop: '5s',
      tags: { scenario: '${scenarioName}' },
    },
  },
  thresholds: {
${thresholdEntries}
  },
  tags: { testid: TEST_ID, testName: '${name}', tags: [${tagsStr}] },
};`;
    }
    else {
        optionsBlock = `export const options = {
  scenarios: {
    ${scenarioName}: {
      executor: 'ramping-vus',
      stages: [
${stagesJson}
      ],
      gracefulRampDown: '5s',
      gracefulStop: '5s',
      tags: { scenario: '${scenarioName}' },
    },
  },
  thresholds: {
${thresholdEntries}
  },
  tags: { testid: TEST_ID, testName: '${name}', tags: [${tagsStr}] },
};`;
    }
    // ── headers ────────────────────────────────────────────────────────────────
    const headerLines = [
        "  'Content-Type': 'application/json'",
        "  'Accept': 'application/json'",
    ];
    for (const h of request.headers) {
        headerLines.push(`  '${h.key}': '${h.value}'`);
    }
    if (request.auth.type === 'bearer' && request.auth.tokenSecret) {
        headerLines.push(`  'Authorization': 'Bearer ' + __ENV.${request.auth.tokenSecret.toUpperCase()}`);
    }
    else if (request.auth.type === 'apikey' && request.auth.tokenSecret && request.auth.headerName) {
        headerLines.push(`  '${request.auth.headerName}': __ENV.${request.auth.tokenSecret.toUpperCase()}`);
    }
    const headersBlock = `const commonHeaders = {\n${headerLines.join(',\n')},\n};`;
    // ── request path ──────────────────────────────────────────────────────────
    const urlPath = extractPath(request.url);
    const apiTag = toApiTag(name);
    const stepName = `01_${name}`;
    let httpCall = '';
    let sentBytesExpr = '0';
    if (request.method === 'GET' || request.method === 'DELETE') {
        httpCall = `  const res = http.${request.method.toLowerCase()}(BASE_URL + '${urlPath}', {
    headers: commonHeaders,
    tags: { scenario: SCENARIO_NAME, api: '${apiTag}', name: '${request.method} ${urlPath}', endpoint_type: 'app' },
  });`;
    }
    else {
        const payloadVal = request.payload
            ? `JSON.stringify(${request.payload.trim()})`
            : 'JSON.stringify({})';
        httpCall = `  const payload = ${payloadVal};
  const res = http.${request.method.toLowerCase()}(BASE_URL + '${urlPath}', payload, {
    headers: commonHeaders,
    tags: { scenario: SCENARIO_NAME, api: '${apiTag}', name: '${request.method} ${urlPath}', endpoint_type: 'app' },
  });`;
        sentBytesExpr = 'getByteLength(payload)';
    }
    // ── checks (VALIDATIONS ONLY — never gate pass/fail, see below) ────────────
    const checkLines = checks.map(c => {
        if (c.includes('status is 200'))
            return "    'status is 200': (r) => r.status === 200";
        if (c.includes('status is 201'))
            return "    'status is 201': (r) => r.status === 201";
        if (c.match(/response time/i)) {
            const match = c.match(/(\d+)/);
            const ms = match ? parseInt(match[1]) : 500;
            return `    'response time < ${ms}ms': (r) => r.timings.duration < ${ms}`;
        }
        return `    '${c}': (r) => r.status < 400`;
    }).join(',\n');
    const recordCall = (0, k6InfluxTemplate_1.influxRecordCall)('res', 'SCENARIO_NAME', apiTag, urlPath, sentBytesExpr, stepName);
    // Peak VUs written once in setup() – avoids the unreliable __VU===1 per-iteration guard.
    const maxVus = Math.max(...(loadProfile.stages ?? []).map(s => s.target ?? 0), firstStage?.target ?? 1);
    return `${(0, k6InfluxTemplate_1.influxImports)()}

const SCENARIO_NAME = '${scenarioName}';

${(0, k6InfluxTemplate_1.influxEnvAndMetrics)(name, baseUrl)}

${headersBlock}

${optionsBlock}

${(0, k6InfluxTemplate_1.influxHelperFunctions)()}
${(0, k6InfluxTemplate_1.influxSetup)(maxVus)}
${(0, k6InfluxTemplate_1.influxTeardown)()}

export default function () {
${(0, k6InfluxTemplate_1.influxIterationTracking)('SCENARIO_NAME')}
  group('${stepName}', () => {
${httpCall}

    // Checks are validations only — a failing one is logged as a WARNING,
    // never an error, and never affects pass/fail on its own. Thresholds
    // (options.thresholds above) are the SLA/SLO gate for the run; every
    // 4xx/5xx status below is unconditionally a real failure regardless of
    // whether these checks pass.
    const checkDefs = {
${checkLines}
    };
    check(res, checkDefs);
    Object.entries(checkDefs).forEach(function (entry) {
      if (!entry[1](res)) console.warn('${stepName} validation warning: ' + entry[0] + ' (got status ' + res.status + ')');
    });

    ${recordCall}

    if (res.status >= 400) {
      console.error('Request failed: ' + res.status + ' ' + res.body);
    }
  });

  // Force-flush this iteration's buffered InfluxDB lines now — teardown()
  // runs in its own fresh VU context in k6, so it can only flush an empty
  // buffer of its own, never the one this VU actually accumulated. Without
  // this, up to INFLUX_FLUSH_THRESHOLD-1 trailing requestsRaw points get
  // silently dropped whenever a VU's iteration ends mid-batch.
  flushInfluxLines();

  sleep(${loadProfile.thinkTime || 1});
}

export function handleSummary(data) {
  return { stdout: textSummary(data, { indent: '  ', enableColors: true }) };
}
`;
}
function extractPath(url) {
    try {
        const u = new URL(url);
        return u.pathname + u.search;
    }
    catch {
        return url.startsWith('/') ? url : '/' + url;
    }
}
function toScenarioName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
function toApiTag(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
