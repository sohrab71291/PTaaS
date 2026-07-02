import http from 'k6/http';
import { check, group, sleep, fail } from 'k6';
import { Counter, Trend, Gauge } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

const TEST_ID = __ENV.TESTID || ('local-' + Date.now());
const RUN_ID = __ENV.RUN_ID || ('PerfOps-' + Date.now());
const NODE_NAME = __ENV.NODE_NAME || 'PerfOps';
const TEST_NAME = __ENV.TEST_NAME || 'ExportReport';
const BASE_URL = __ENV.BASE_URL || 'https://9190002.classic-dev.internal.archerirm.net';
const INFLUX_V2_URL = __ENV.INFLUX_V2_URL || 'http://localhost:8086';
const INFLUX_V2_ORG = __ENV.INFLUX_V2_ORG || '';
const INFLUX_V2_ORG_ID = __ENV.INFLUX_V2_ORG_ID || '';
const INFLUX_V2_BUCKET = __ENV.INFLUX_V2_BUCKET || 'PerfDB';
const INFLUX_V2_TOKEN = __ENV.INFLUX_V2_TOKEN || '';
const INFLUX_V2_AUTO_CREATE_BUCKET = (__ENV.INFLUX_V2_AUTO_CREATE_BUCKET || 'false').toLowerCase() === 'true';
const INFLUX_V2_ENABLED = !!(INFLUX_V2_ORG && INFLUX_V2_BUCKET && INFLUX_V2_TOKEN);

const USERNAME = __ENV.APP_USERNAME || 'PerfUser_1';
const PASSWORD = __ENV.APP_PASSWORD || 'Password123$';
const INSTANCE_NAME = __ENV.APP_INSTANCE || '9190002';

const k6HttpReqsTotal = new Counter('k6_http_reqs_total');
const k6HttpReqFailedTotal = new Counter('k6_http_req_failed_total');
const k6IterationsTotal = new Counter('k6_iterations_total');
const k6HttpReqDurationSeconds = new Trend('k6_http_req_duration_seconds');
const k6Vus = new Gauge('k6_vus');
const k6VusMax = new Gauge('k6_vus_max');
const k6DataSentBytesTotal = new Counter('k6_data_sent_bytes_total');
const k6DataReceivedBytesTotal = new Counter('k6_data_received_bytes_total');

const loginTrend = new Trend('login_duration', true);
const exportReportTrend = new Trend('export_report_duration', true);

const SCENARIO_NAME = 'export_report_smoke';

export const options = {
  scenarios: {
    export_report_smoke: {
      executor: 'constant-vus',
      vus: 1,
      duration: '1m',
      exec: 'exportReportFlow',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const SCENARIO_MAX_VUS = Math.max(...Object.values(options.scenarios).flatMap(s => (s.stages || []).map(st => st.target ?? 0)), 1);

function getByteLength(value) {
  if (value === null || value === undefined) return 0;
  return String(value).length;
}
function escapeTagValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/ /g, '\\ ')
    .replace(/=/g, '\\=');
}
function normalizeTagText(value, maxLength) {
  if (value === null || value === undefined) return undefined;
  const s = String(value).replace(/\s+/g, ' ').trim();
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
    batch.join('\n'),
    { headers: { Authorization: 'Token ' + INFLUX_V2_TOKEN, 'Content-Type': 'text/plain; charset=utf-8' }, tags: { api: 'influx-v2-write', step: 'metrics-publish', name: 'POST /api/v2/write' } }
  );
}
function buildMetricTagSet(t) {
  return 'testid=' + escapeTagValue(t.testid) + ',scenario=' + escapeTagValue(t.scenario) + ',api=' + escapeTagValue(t.api) + ',url=' + escapeTagValue(t.url) + ',status=' + escapeTagValue(t.status);
}
function recordCustomMetrics(response, scenario, apiTag, urlPath, sentBytes, requestName) {
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

function buildSessionHeaders(sessionToken, extraHeaders) {
  return Object.assign({
    Cookie: '__ArcherSessionCookie__=' + sessionToken,
  }, extraHeaders || {});
}

const EXPORT_PAYLOAD = JSON.stringify({
  requestType: 'Search',
  outputFormatType: 'Excel',
  includeHtmlFormatting: true,
  requestParameters: {
    performFacetedSearch: false,
    reportPayload: {
      reportCriteria: {
        reportType: 'Table',
        criteria: {
          searchFilter: null,
          moduleCriteria: {
            id: 666973,
            moduleId: 36066,
            levelIds: [49731],
            keywordLevelIds: [],
            sortFields: [{ fieldId: 529342, sortType: 'Ascending' }],
            isKeywordModule: true,
            buildoutRelationship: 'Union',
            leveledBuildoutOptions: null,
            children: [],
          },
          keywords: '',
          contentIdLayerMapItems: [],
          searchDirection: 'Both',
        },
        showDateHeading: false,
        reportId: 499028,
        maxRecordCount: 100,
        isResultLimitPercent: false,
        pageSize: 50,
        showCriteriaHeading: false,
        fixColumnHeaders: false,
        refreshRate: null,
        isHiddenFromMasterReportList: false,
        isHiddenFromIViews: false,
        isCachingEnabled: false,
        cacheDuration: null,
        calendarOptions: null,
        networkOptions: null,
        containedDisplayFields: {},
        displayFields: [529342, 529345, 531531, 531533, 531534, 531535, 531539, 531543, 531548, 531549],
        displayFieldWidths: [],
        expandDetailViews: false,
        formatType: 'Column',
        groupingFieldIds: [],
        mapOptions: null,
        mapboxOptions: null,
        calendarDisplayFormat: 3,
        isEditable: true,
        hierarchiesForField: {},
        isTrendingEnabled: false,
        statisticStepWidths: [],
      },
      reportDetail: {
        id: 499028,
        guid: '32557d13-ef04-48cf-9f15-0eb41930a0b5',
        type: 'SearchBased',
        description: '',
        name: 'PerfTestApp_100Records_Shared',
        pageId: 288952,
        asoStatus: 'Normal',
        isHiddenFromMasterReportList: false,
        isHiddenFromIViews: false,
        languageId: 1,
        isSystem: false,
        reportType: 'Shared',
        updateInformation: {
          createdDate: '2025-12-12T10:08:33.47Z',
          lastUpdatedDate: '2025-12-12T10:08:33.47Z',
          createdBy: 92365,
          updatedBy: 92365,
          createdByName: ', ',
          updatedByName: ', ',
        },
        authorization: { users: [92365, 96779], groups: [] },
      },
    },
  },
});

export function setup() {
  if (INFLUX_V2_ENABLED) { ensureInfluxBucket(); }
  k6VusMax.add(SCENARIO_MAX_VUS, { testid: TEST_ID });
  const ts = String(Date.now()) + '000000';
  writeInfluxLines([
    'testStartEnd,' + buildInfluxTagSet({ runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, type: 'started' }) + ' value=1i ' + ts,
    'k6_vus_max,testid=' + escapeTagValue(TEST_ID) + ' value=' + SCENARIO_MAX_VUS + 'i ' + ts,
  ]);

  const url = BASE_URL + '/api/core/security/login';
  const payload = JSON.stringify({ username: USERNAME, password: PASSWORD, instanceName: INSTANCE_NAME });
  const params = { headers: { 'Content-Type': 'application/json' }, tags: { name: 'User Login' } };
  const res = http.post(url, payload, params);
  recordCustomMetrics(res, SCENARIO_NAME, 'auth', '/api/core/security/login', getByteLength(payload), 'User Login');
  loginTrend.add(res.timings.duration);

  let body = {};
  try { body = res.json(); } catch (e) { body = {}; }

  const sessionToken =
    (body.RequestedObject && body.RequestedObject.SessionToken) ??
    body.SessionToken ??
    body.sessionToken ??
    body.token ??
    body.access_token ??
    (body.data && body.data.token) ??
    '';

  if (!sessionToken) {
    throw new Error('Setup failed: Could not authenticate. HTTP ' + res.status + '. Response: ' + JSON.stringify(body).substring(0, 300));
  }
  console.log('Setup: Successfully authenticated. Session token acquired.');
  return { sessionToken: sessionToken };
}

export function exportReportFlow(setupData) {
  const sessionToken = (setupData && setupData.sessionToken) ? setupData.sessionToken : '';
  if (!sessionToken) {
    fail('Session token is missing from setup. Cannot execute authenticated API calls.');
  }
  const authHeaders = buildSessionHeaders(sessionToken);

  const _ts = String(Date.now()) + '000000';
  k6IterationsTotal.add(1, { testid: TEST_ID, scenario: SCENARIO_NAME });
  k6Vus.add(1, { testid: TEST_ID, scenario: SCENARIO_NAME, vu: String(__VU) });
  writeInfluxLines([
    'k6_iterations_total,testid=' + escapeTagValue(TEST_ID) + ',scenario=' + escapeTagValue(SCENARIO_NAME) + ' value=1i ' + _ts,
    'k6_vus,testid=' + escapeTagValue(TEST_ID) + ',scenario=' + escapeTagValue(SCENARIO_NAME) + ',vu=' + escapeTagValue(__VU) + ' value=1 ' + _ts,
    'virtualUsers,' + buildInfluxTagSet({ runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, scenario: SCENARIO_NAME }) + ' meanActiveThreads=1,finishedThreads=' + __ITER + ' ' + _ts,
  ]);

  group('Export Report', function () {
    const url = BASE_URL + '/ngrx/export';
    const params = {
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      tags: { name: 'Export Report' },
    };
    const res = http.post(url, EXPORT_PAYLOAD, params);
    recordCustomMetrics(res, SCENARIO_NAME, 'export', '/ngrx/export', getByteLength(EXPORT_PAYLOAD), 'Export Report');
    exportReportTrend.add(res.timings.duration);

    check(res, {
      'Export Report status is 200': function (r) { return r.status === 200; },
      'Export Report response time < 500ms': function (r) { return r.timings.duration < 500; },
    });
  });

  group('Validate Session', function () {
    const authHeaders = buildSessionHeaders(sessionToken);
    const url = BASE_URL + '/ngrx/user/profile';
    const params = {
      headers: authHeaders,
      tags: { name: 'Validate Session' },
    };
    const res = http.get(url, params);
    recordCustomMetrics(res, SCENARIO_NAME, 'session', '/ngrx/user/profile', 0, 'Validate Session');

    check(res, {
      'Validate Session status is 200': function (r) { return r.status === 200; },
    });
  });

  sleep(1);
}

export function teardown() {
  const ts = String(Date.now()) + '000000';
  writeInfluxLines([
    'testStartEnd,' + buildInfluxTagSet({ runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, type: 'finished' }) + ' value=1i ' + ts,
  ]);
  flushInfluxLines();
}

export function handleSummary(data) {
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}