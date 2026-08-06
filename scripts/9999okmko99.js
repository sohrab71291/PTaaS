import http from 'k6/http';
import { check, group, sleep, fail } from 'k6';
import { Counter, Trend, Gauge } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
const LOGIN_REQUEST = null;
const CAPTURED_REQUESTS = [{"name":"GET _apps_ArcherApp_ArcherApp_aspx","method":"GET","path":"/apps/ArcherApp/ArcherApp.aspx","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_instance","method":"GET","path":"/ngrx/record/v1/instance","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_modules_10145_levels","method":"GET","path":"/ngrx/record/v1/modules/10145/levels","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_ConsumerGroups","method":"POST","path":"/api/V2/internal/ConsumerGroups","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":"{\n  \"value\": [\n    \"Records\",\n    \"Global\",\n    \"ReactGrid\",\n    \"Applications\"\n  ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _plugins_json_id_1785735452772","method":"GET","path":"/plugins.json?id=1785735452772","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_UserProfile_7648__id_7648","method":"GET","path":"/api/V2/internal/UserProfile(7648)?id=7648","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_about_version_all","method":"GET","path":"/ngrx/record/v1/about/version/all","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_ConsumerGroups","method":"POST","path":"/api/V2/internal/ConsumerGroups","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1","x-archer-source":"Archer,Navigation"},"payload":"{\n  \"value\": [\n    \"Global\",\n    \"MainMenu\"\n  ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_AppearanceThemes_GetActive","method":"GET","path":"/api/V2/internal/AppearanceThemes/GetActive","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1","x-archer-source":"Archer,Navigation"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_UserProfileImage","method":"GET","path":"/api/V2/internal/UserProfileImage","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1","x-archer-source":"Archer,Navigation"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_profile_User_7648_additionalInfo","method":"GET","path":"/ngrx/profile/User/7648/additionalInfo","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12100_data_driven_events","method":"GET","path":"/ngrx/record/v1/levels/12100/data-driven-events","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12100","method":"GET","path":"/ngrx/record/v1/levels/12100","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12100_advanced_workflow_configura","method":"GET","path":"/ngrx/record/v1/levels/12100/advanced-workflow-configuration","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_ConsumerGroups","method":"POST","path":"/api/V2/internal/ConsumerGroups","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":"{\n  \"value\": [\n    \"Records\",\n    \"Global\",\n    \"ReactGrid\",\n    \"Emails\",\n    \"AdvancedFilter\",\n    \"UserProfile\",\n    \"Phones\",\n    \"MessageBox\",\n    \"DataFeeds\",\n    \"ArcherUploadModal\",\n    \"Applications\",\n    \"Search\",\n    \"GridPanel\",\n    \"PlatFormUI\",\n    \"DataImportWizard\",\n    \"RecordPage\",\n    \"MainMenu\",\n    \"BulkActionJobHistory\",\n    \"JobStatusReport\"\n  ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v2_levels_12100_default_layout","method":"GET","path":"/ngrx/record/v2/levels/12100/default-layout","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12100_image_fields","method":"GET","path":"/ngrx/record/v1/levels/12100/image-fields","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_modules_task_access_moduleIds_10145","method":"GET","path":"/ngrx/record/v1/modules/task-access?moduleIds=10145","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _ngrx_record_v1_contents","method":"POST","path":"/ngrx/record/v1/contents","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":"{\n  \"levelId\": 12100,\n  \"contentFields\": [],\n  \"version\": 0\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500,"producesVars":[{"token":"id1","jsonPath":"id"}]},{"name":"GET _ngrx_record_v1_levels_12100_advanced_workflow_configura","method":"GET","path":"/ngrx/record/v1/levels/12100/advanced-workflow-configuration","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v2_contents_788029_summary","method":"GET","path":"/ngrx/record/v2/contents/__CORR_id1_788029__/summary","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12100","method":"GET","path":"/ngrx/record/v1/levels/12100","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_contents_788029","method":"GET","path":"/ngrx/record/v1/contents/__CORR_id1_788029__","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _ngrx_record_v1_levels_12100_contents_788029_history","method":"POST","path":"/ngrx/record/v1/levels/12100/contents/__CORR_id1_788029__/history","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_contents_788029_data_driven_events","method":"GET","path":"/ngrx/record/v1/contents/__CORR_id1_788029__/data-driven-events","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_contents_788029_layout","method":"GET","path":"/ngrx/record/v1/contents/__CORR_id1_788029__/layout","headers":{"Content-Type":"application/json","x-csrf-token":"_FTIyV6dg8LKgReP0FsG4HCxa7aAIM4jqzNMbD4QDCmRPsTE6M6dz4n-LfkK7VydlkviuAYdNl2fY5uJJdQYuyDCoPCWsYlAx5CFrUUzTQU1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500}];





const TEST_ID = __ENV.TESTID || ('local-' + Date.now());
const RUN_ID = __ENV.RUN_ID || ('PerfOps-' + Date.now());
const NODE_NAME = __ENV.NODE_NAME || 'PerfOps';
const TEST_NAME = __ENV.TEST_NAME || 'Archer Record Instance Replay';
const BASE_URL = __ENV.BASE_URL || 'https://9185004.classic-dev.internal.archerirm.net';
const INFLUX_V2_URL = __ENV.INFLUX_V2_URL || 'http://localhost:8086';
const INFLUX_V2_ORG = __ENV.INFLUX_V2_ORG || '';
const INFLUX_V2_ORG_ID = __ENV.INFLUX_V2_ORG_ID || '';
const INFLUX_V2_BUCKET = __ENV.INFLUX_V2_BUCKET || 'PerfDB';
const INFLUX_V2_TOKEN = __ENV.INFLUX_V2_TOKEN || '';
const INFLUX_V2_AUTO_CREATE_BUCKET = (__ENV.INFLUX_V2_AUTO_CREATE_BUCKET || 'false').toLowerCase() === 'true';
const INFLUX_V2_ENABLED = !!(INFLUX_V2_ORG && INFLUX_V2_BUCKET && INFLUX_V2_TOKEN);

const CREDENTIALS = [{"loginUrl":"https://9185004.classic-dev.internal.archerirm.net/api/core/security/login","username":"Nitesh","password":"Password123$","instanceName":"9185004"}];
// Each entry has the shape: { loginUrl, username, password, instanceName } —
// these come verbatim from the uploaded CSV's URL / Username / Password /
// InstanceName columns. InstanceName is REQUIRED by the login API (Archer IRM
// throws ArgumentNullException: request.Credentials.InstanceName when it is
// missing/null) — every row in the CSV must supply a non-empty value.

const TEST_NAME_CONST = TEST_NAME;
const SCENARIO_NAME = 'archer_record_instance_replay';

const k6HttpReqsTotal = new Counter('k6_http_reqs_total');
const k6HttpReqFailedTotal = new Counter('k6_http_req_failed_total');
const k6IterationsTotal = new Counter('k6_iterations_total');
const k6HttpReqDurationSeconds = new Trend('k6_http_req_duration_seconds');
const k6Vus = new Gauge('k6_vus');
const k6VusMax = new Gauge('k6_vus_max');
const k6DataSentBytesTotal = new Counter('k6_data_sent_bytes_total');
const k6DataReceivedBytesTotal = new Counter('k6_data_received_bytes_total');

export const options = {
  scenarios: {
    archer_record_instance_replay: {
      executor: 'constant-vus',
      vus: 1,
      duration: '1m',
      exec: 'sessionReplay',
    },
  },
  thresholds: {
    'http_req_duration{endpoint_type:app}': ['p(95)<2000'],
    'http_req_failed{endpoint_type:app}': ['rate<0.05'],
    'checks': ['rate>0.95'],
  },
};

const SCENARIO_MAX_VUS = Math.max(
  ...Object.values(options.scenarios).flatMap(s => [
    s.vus ?? 0,
    s.maxVUs ?? 0,
    s.preAllocatedVUs ?? 0,
    ...((s.stages || []).map(st => st.target ?? 0)),
  ]),
  1
);

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
function isResponseStatusExpected(response, expectedStatus) {
  if (expectedStatus === undefined || expectedStatus === null) return false;
  if (response.status === expectedStatus) return true;
  if (expectedStatus >= 300 && expectedStatus < 400) {
    return response.status >= 300 && response.status < 400;
  }
  return false;
}
function recordCustomMetrics(response, scenario, apiTag, urlPath, sentBytes, requestName, expectedStatus) {
  const failed = response.status >= 400 && !isResponseStatusExpected(response, expectedStatus) ? 1 : 0;
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

function getVuCredential() {
  if (!CREDENTIALS.length) {
    fail('No login credentials available — upload a credentials CSV on the Executor page.');
  }
  return CREDENTIALS[(__VU - 1) % CREDENTIALS.length];
}

let __vuJar = null;
function getVuJar() {
  if (!__vuJar) __vuJar = http.cookieJar();
  return __vuJar;
}

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
function authHeadersFromAuth(auth) {
  const headers = {};
  if (auth && auth.jwt) headers.Authorization = 'Bearer ' + auth.jwt;
  return headers;
}

let __vuAuth = null;
function ensureAuth() {
  if (__vuAuth) return __vuAuth;
  const cred = getVuCredential();
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
  if (sessionToken && (!res.cookies || Object.keys(res.cookies).length === 0)) {
    jar.set(BASE_URL, '__ArcherSessionCookie__', sessionToken);
  }
  __vuAuth = { jwt: jwt };
  console.log('VU ' + __VU + ': Successfully authenticated as ' + cred.username + (jwt ? ' (session cookie + bearer JWT)' : ' (session cookie only)'));
  return __vuAuth;
}

function reauth() {
  __vuAuth = null;
  console.warn('VU ' + __VU + ': got 401 — re-authenticating.');
  const jar = getVuJar();
  const stale = jar.cookiesForURL(BASE_URL) || {};
  Object.keys(stale).forEach(function (name) {
    jar.set(BASE_URL, name, '', { expires: new Date(0).toUTCString() });
  });
  const auth = ensureAuth();
  refreshCsrfToken(jar, authHeadersFromAuth(__vuAuth));
  return auth;
}

function requestBody(payload, payloadType) {
  if (!payload) return null;
  if (payloadType === 'form') {
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

function getByJsonPath(obj, jsonPath) {
  if (!obj || !jsonPath) return undefined;
  return jsonPath.split('.').reduce(function (acc, key) {
    return (acc === undefined || acc === null) ? undefined : acc[key];
  }, obj);
}

function substituteCorrelationVars(text, correlationVars) {
  if (!text) return text;
  return text.replace(/__CORR_([A-Za-z0-9]+)_(\d+)__/g, function (match, token, fallbackLiteral) {
    const resolved = correlationVars ? correlationVars[token] : undefined;
    return (resolved !== undefined && resolved !== null && resolved !== '') ? String(resolved) : fallbackLiteral;
  });
}

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

let __csrfToken = '';
function captureCsrfToken(reqDef, response) {
  const token = response.headers['csrf-token'] || response.headers['Csrf-Token'] || response.headers['CSRF-Token'];
  if (token && token !== __csrfToken) {
    __csrfToken = token;
    console.log('VU ' + __VU + ': captured fresh csrf-token from ' + reqDef.name);
  }
}

function findCsrfPrimingRequest() {
  return CAPTURED_REQUESTS.find(function (r) { return /GetModuleRecordAccess/i.test(String(r.path || '')); })
    || CAPTURED_REQUESTS[0]
    || null;
}

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

function isKnownBenignNotFound(reqDef, response) {
  if (response.status !== 404) return false;
  const p = String(reqDef.path || '').toLowerCase();
  return p.indexOf('advanced-workflow-configuration') !== -1
    || p.indexOf('release_lock') !== -1
    || p.indexOf('release-lock') !== -1;
}

function isIdempotentDeleteOutcome(reqDef, response) {
  if (String(reqDef.method || '').toUpperCase() !== 'DELETE') return false;
  return response.status === 404 || response.status === 409;
}

function isKnownBenignNotFoundPath(reqDef) {
  const p = String(reqDef.path || '').toLowerCase();
  return p.indexOf('advanced-workflow-configuration') !== -1
    || p.indexOf('release_lock') !== -1
    || p.indexOf('release-lock') !== -1;
}
function buildExpectedStatuses(reqDef) {
  const statuses = [];
  if (reqDef.expectedStatus >= 300 && reqDef.expectedStatus < 400) {
    statuses.push({ min: 300, max: 399 });
  } else {
    statuses.push(reqDef.expectedStatus);
  }
  if (isKnownBenignNotFoundPath(reqDef)) statuses.push(404);
  if (String(reqDef.method || '').toUpperCase() === 'DELETE') statuses.push(404, 409);
  return statuses;
}

const RESPONSE_THRESHOLD_FLOOR_MS = 1000;
function effectiveResponseThreshold(reqDef) {
  return Math.max(reqDef.responseThresholdMs, RESPONSE_THRESHOLD_FLOOR_MS);
}

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

function replayStep(reqDef, jar, correlationVars) {
  const path = substituteCorrelationVars(reqDef.path, correlationVars);
  const payload = substituteCorrelationVars(reqDef.payload, correlationVars);
  const url = BASE_URL + path;

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
      tags: { name: reqDef.name, endpoint_type: 'app' },
      jar: jar,
      responseCallback: http.expectedStatuses(...buildExpectedStatuses(reqDef)),
    };
    return http.request(reqDef.method, url, requestBody(payload, reqDef.payloadType), params);
  }

  let auth = ensureAuth();
  let res = doRequest(authHeadersFromAuth(auth));

  if (res.status === 401 || res.status === 403) {
    auth = reauth();
    res = doRequest(authHeadersFromAuth(auth));
  }

  captureCsrfToken(reqDef, res);

  const effectiveExpectedStatus = isKnownBenignNotFound(reqDef, res) ? 404
    : isIdempotentDeleteOutcome(reqDef, res) ? res.status
    : reqDef.expectedStatus;

  const responseThresholdMs = effectiveResponseThreshold(reqDef);
  check(res, {
    [reqDef.name + ' status is ' + reqDef.expectedStatus]: function (r) { return isResponseStatusExpected(r, effectiveExpectedStatus); },
    [reqDef.name + ' status is 404']: function (r) { return r.status === 404; },
    [reqDef.name + ' response time < 500ms']: function (r) { return r.timings.duration < 500; },
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

  const replayRequests = CAPTURED_REQUESTS;

  const correlationVars = {};

  for (let i = 0; i < replayRequests.length; i++) {
    const reqDef = replayRequests[i];
    group(reqDef.name, function () {
      replayStep(reqDef, jar, correlationVars);
    });
    sleep(1);
  }
}

export default function (setupData) {
  sessionReplay(setupData);
}

export function handleSummary(data) {
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}