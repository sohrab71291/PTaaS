import {
  influxImports,
  influxEnvAndMetrics,
  influxHelperFunctions,
  influxSetup,
  influxTeardown,
  influxIterationTracking,
  influxRecordCall,
} from './k6InfluxTemplate';

interface Header {
  key: string;
  value: string;
}

interface Stage {
  duration: string;
  target: number;
}

interface LoadProfile {
  type: 'staged' | 'constant' | 'arrival-rate';
  stages: Stage[];
  thinkTime: number;
}

interface ThresholdCondition {
  condition: string;
  abortOnFail: boolean;
}

interface Request {
  url: string;
  method: string;
  headers: Header[];
  payload: string | null;
  auth: {
    type: string;
    tokenSecret?: string;
    headerName?: string;
  };
}

interface TestSpec {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  request: Request;
  loadProfile: LoadProfile;
  thresholds: Record<string, ThresholdCondition[]>;
  checks: string[];
  environmentId: string;
}

export function generateK6Script(spec: TestSpec, baseUrl = 'https://api.example.com'): string {
  const { name, request, loadProfile, thresholds, checks, tags } = spec;

  const scenarioName = toScenarioName(name);

  // ── options block ──────────────────────────────────────────────────────────
  const stagesJson = (loadProfile.stages ?? [])
    .map(s => `    { duration: '${s.duration}', target: ${s.target} }`)
    .join(',\n');

  const thresholdEntries = Object.entries(thresholds)
    .map(([metric, conditions]) => {
      const condArr = conditions.map(c => `'${c.condition}'`).join(', ');
      return `    '${metric}': [${condArr}]`;
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
  } else if (loadProfile.type === 'constant') {
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
  } else {
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
  const headerLines: string[] = [
    "  'Content-Type': 'application/json'",
    "  'Accept': 'application/json'",
  ];
  for (const h of request.headers) {
    headerLines.push(`  '${h.key}': '${h.value}'`);
  }
  if (request.auth.type === 'bearer' && request.auth.tokenSecret) {
    headerLines.push(`  'Authorization': 'Bearer ' + __ENV.${request.auth.tokenSecret.toUpperCase()}`);
  } else if (request.auth.type === 'apikey' && request.auth.tokenSecret && request.auth.headerName) {
    headerLines.push(`  '${request.auth.headerName}': __ENV.${request.auth.tokenSecret.toUpperCase()}`);
  }
  const headersBlock = `const commonHeaders = {\n${headerLines.join(',\n')},\n};`;

  // ── request path ──────────────────────────────────────────────────────────
  const urlPath = extractPath(request.url);
  const apiTag  = toApiTag(name);
  const stepName = `01_${name}`;

  let httpCall = '';
  let sentBytesExpr = '0';

  if (request.method === 'GET' || request.method === 'DELETE') {
    httpCall = `  const res = http.${request.method.toLowerCase()}(BASE_URL + '${urlPath}', {
    headers: commonHeaders,
    tags: { scenario: SCENARIO_NAME, api: '${apiTag}', name: '${request.method} ${urlPath}' },
  });`;
  } else {
    const payloadVal = request.payload
      ? `JSON.stringify(${request.payload.trim()})`
      : 'JSON.stringify({})';
    httpCall = `  const payload = ${payloadVal};
  const res = http.${request.method.toLowerCase()}(BASE_URL + '${urlPath}', payload, {
    headers: commonHeaders,
    tags: { scenario: SCENARIO_NAME, api: '${apiTag}', name: '${request.method} ${urlPath}' },
  });`;
    sentBytesExpr = 'getByteLength(payload)';
  }

  // ── checks ────────────────────────────────────────────────────────────────
  const checkLines = checks.map(c => {
    if (c.includes('status is 200')) return "    'status is 200': (r) => r.status === 200";
    if (c.includes('status is 201')) return "    'status is 201': (r) => r.status === 201";
    if (c.match(/response time/i)) {
      const match = c.match(/(\d+)/);
      const ms = match ? parseInt(match[1]) : 500;
      return `    'response time < ${ms}ms': (r) => r.timings.duration < ${ms}`;
    }
    return `    '${c}': (r) => r.status < 400`;
  }).join(',\n');

  const recordCall = influxRecordCall('res', 'SCENARIO_NAME', apiTag, urlPath, sentBytesExpr, stepName);

  // Peak VUs written once in setup() – avoids the unreliable __VU===1 per-iteration guard.
  const maxVus = Math.max(...(loadProfile.stages ?? []).map(s => s.target ?? 0), firstStage?.target ?? 1);

  return `${influxImports()}

const SCENARIO_NAME = '${scenarioName}';

${influxEnvAndMetrics(name, baseUrl)}

${headersBlock}

${optionsBlock}

${influxHelperFunctions()}
${influxSetup(maxVus)}
${influxTeardown()}

export default function () {
${influxIterationTracking('SCENARIO_NAME')}
  group('${stepName}', () => {
${httpCall}

    check(res, {
${checkLines}
    });

    ${recordCall}

    if (res.status >= 400) {
      console.error('Request failed: ' + res.status + ' ' + res.body);
    }
  });

  sleep(${loadProfile.thinkTime || 1});
}

export function handleSummary(data) {
  return { stdout: textSummary(data, { indent: '  ', enableColors: true }) };
}
`;
}

function extractPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url.startsWith('/') ? url : '/' + url;
  }
}

function toScenarioName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function toApiTag(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
