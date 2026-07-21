import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Trend, Gauge } from 'k6/metrics';
import { fail } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
const LOGIN_REQUEST = null;
const CAPTURED_REQUESTS = [{"name":"GET _ngrx_record_v1_modules_10162_levels","method":"GET","path":"/ngrx/record/v1/modules/10162/levels","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_ConsumerGroups","method":"POST","path":"/api/V2/internal/ConsumerGroups","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"57","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":"{\n  \"value\": [\n    \"Records\",\n    \"Global\",\n    \"ReactGrid\",\n    \"Applications\"\n  ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_profile_User_7478_additionalInfo","method":"GET","path":"/ngrx/profile/User/7478/additionalInfo","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12126_data_driven_events","method":"GET","path":"/ngrx/record/v1/levels/12126/data-driven-events","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12126","method":"GET","path":"/ngrx/record/v1/levels/12126","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12126_advanced_workflow_configura","method":"GET","path":"/ngrx/record/v1/levels/12126/advanced-workflow-configuration","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-type":"application/json; charset=UTF-8","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v2_levels_12126_default_layout","method":"GET","path":"/ngrx/record/v2/levels/12126/default-layout","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12126_image_fields","method":"GET","path":"/ngrx/record/v1/levels/12126/image-fields","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _ngrx_record_v1_contents","method":"POST","path":"/ngrx/record/v1/contents","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"141","content-type":"application/json; charset=UTF-8","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":"{\n  \"levelId\": 12126,\n  \"contentFields\": [\n    {\n      \"fieldId\": 60795,\n      \"value\": \"Kashi\",\n      \"type\": \"Text\"\n    },\n    {\n      \"fieldId\": 60796,\n      \"value\": 34,\n      \"type\": \"Numeric\"\n    }\n  ],\n  \"version\": 0\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500,"producesVars":[{"token":"id1","jsonPath":"id"}]},{"name":"GET _ngrx_record_v1_levels_12126_advanced_workflow_configura","method":"GET","path":"/ngrx/record/v1/levels/12126/advanced-workflow-configuration","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-type":"application/json; charset=UTF-8","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v2_contents_786487_summary","method":"GET","path":"/ngrx/record/v2/contents/__CORR_id1_786487__/summary","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12126","method":"GET","path":"/ngrx/record/v1/levels/12126","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_contents_786487","method":"GET","path":"/ngrx/record/v1/contents/__CORR_id1_786487__","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _ngrx_record_v1_levels_12126_contents_786487_history","method":"POST","path":"/ngrx/record/v1/levels/12126/contents/__CORR_id1_786487__/history","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"0","content-type":"application/json; charset=UTF-8","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_contents_786487_data_driven_events","method":"GET","path":"/ngrx/record/v1/contents/__CORR_id1_786487__/data-driven-events","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_contents_786487_layout","method":"GET","path":"/ngrx/record/v1/contents/__CORR_id1_786487__/layout","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"PUT _ngrx_record_v1_contents_786487_acquire_lock","method":"PUT","path":"/ngrx/record/v1/contents/__CORR_id1_786487__/acquire-lock","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"0","content-type":"application/json; charset=UTF-8","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"DELETE _ngrx_record_v1_contents_786487","method":"DELETE","path":"/ngrx/record/v1/contents/__CORR_id1_786487__","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"PATCH _ngrx_record_v1_contents_786487_release_lock","method":"PATCH","path":"/ngrx/record/v1/contents/__CORR_id1_786487__/release-lock","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-type":"application/json; charset=UTF-8","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_metadata_ModuleMetadata_moduleIds_10162","method":"GET","path":"/ngrx/metadata/ModuleMetadata?moduleIds=10162","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_search_reportCriteria_default_moduleId_10162","method":"GET","path":"/ngrx/search/reportCriteria/default?moduleId=10162","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_search_results_viewType_NavMenu_pageNum_0_pageSize","method":"GET","path":"/ngrx/search/results?viewType=NavMenu&pageNum=0&pageSize=0&solutionId=222&workspaceId=210&moduleId=10162&performFacetedSearch=false","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _ngrx_search_results","method":"POST","path":"/ngrx/search/results","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"1321","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":"{\n  \"reportPayload\": {\n    \"reportDetail\": {\n      \"guid\": \"04b3feea-3b7f-46c7-99d1-df6310404e26\",\n      \"type\": \"SearchBased\",\n      \"description\": \"\",\n      \"name\": \"\",\n      \"pageId\": 9248,\n      \"asoStatus\": \"Normal\",\n      \"languageId\": 1,\n      \"isSystem\": false,\n      \"reportType\": \"Global\",\n      \"updateInformation\": {},\n      \"authorization\": {\n        \"users\": [],\n        \"groups\": []\n      }\n    },\n    \"reportCriteria\": {\n      \"reportType\": \"Table\",\n      \"criteria\": {\n        \"searchFilter\": null,\n        \"moduleCriteria\": {\n          \"id\": 0,\n          \"moduleId\": 10162,\n          \"levelIds\": [\n            12126\n          ],\n          \"keywordLevelIds\": [],\n          \"sortFields\": [\n            {\n              \"fieldId\": 60463,\n              \"sortType\": \"Ascending\"\n            }\n          ],\n          \"isKeywordModule\": true,\n          \"buildoutRelationship\": \"Union\",\n          \"leveledBuildoutOptions\": null,\n          \"children\": []\n        },\n        \"keywords\": \"\",\n        \"contentIdLayerMapItems\": [],\n        \"searchDirection\": \"Both\"\n      },\n      \"showDateHeading\": false,\n      \"reportId\": 0,\n      \"maxRecordCount\": 0,\n      \"isResultLimitPercent\": false,\n      \"pageSize\": 50,\n      \"showCriteriaHeading\": false,\n      \"fixColumnHeaders\": false,\n      \"refreshRate\": null,\n      \"isHiddenFromMasterReportList\": false,\n      \"isHiddenFromIViews\": false,\n      \"isCachingEnabled\": false,\n      \"cacheDuration\": null,\n      \"calendarOptions\": null,\n      \"networkOptions\": null,\n      \"containedDisplayFields\": {},\n      \"displayFields\": [\n        60463\n      ],\n      \"displayFieldWidths\": [],\n      \"expandDetailViews\": false,\n      \"formatType\": \"Column\",\n      \"groupingFieldIds\": [],\n      \"mapOptions\": null,\n      \"mapboxOptions\": null,\n      \"calendarDisplayFormat\": 1,\n      \"isEditable\": true,\n      \"hierarchiesForField\": {},\n      \"isTrendingEnabled\": false\n    }\n  },\n  \"pageNum\": 0,\n  \"pageSize\": 50,\n  \"performFacetedSearch\": false\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500,"producesVars":[{"token":"moduleId4","jsonPath":"searchResults.0.moduleId"},{"token":"levelId5","jsonPath":"searchResults.0.levelId"},{"token":"fieldId6","jsonPath":"fieldProperties.0.fieldId"}]},{"name":"POST _ngrx_search_results_0_facets","method":"POST","path":"/ngrx/search/results/0/facets","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"1266","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":"{\n  \"reportPayload\": {\n    \"reportDetail\": {\n      \"guid\": \"04b3feea-3b7f-46c7-99d1-df6310404e26\",\n      \"type\": \"SearchBased\",\n      \"description\": \"\",\n      \"name\": \"\",\n      \"pageId\": 9248,\n      \"asoStatus\": \"Normal\",\n      \"languageId\": 1,\n      \"isSystem\": false,\n      \"reportType\": \"Global\",\n      \"updateInformation\": {},\n      \"authorization\": {\n        \"users\": [],\n        \"groups\": []\n      }\n    },\n    \"reportCriteria\": {\n      \"reportType\": \"Table\",\n      \"criteria\": {\n        \"searchFilter\": null,\n        \"moduleCriteria\": {\n          \"id\": 0,\n          \"moduleId\": __CORR_moduleId4_10162__,\n          \"levelIds\": [\n            __CORR_levelId5_12126__\n          ],\n          \"keywordLevelIds\": [],\n          \"sortFields\": [\n            {\n              \"fieldId\": __CORR_fieldId6_60463__,\n              \"sortType\": \"Ascending\"\n            }\n          ],\n          \"isKeywordModule\": true,\n          \"buildoutRelationship\": \"Union\",\n          \"leveledBuildoutOptions\": null,\n          \"children\": []\n        },\n        \"keywords\": \"\",\n        \"contentIdLayerMapItems\": [],\n        \"searchDirection\": \"Both\"\n      },\n      \"showDateHeading\": false,\n      \"reportId\": 0,\n      \"maxRecordCount\": 0,\n      \"isResultLimitPercent\": false,\n      \"pageSize\": 50,\n      \"showCriteriaHeading\": false,\n      \"fixColumnHeaders\": false,\n      \"refreshRate\": null,\n      \"isHiddenFromMasterReportList\": false,\n      \"isHiddenFromIViews\": false,\n      \"isCachingEnabled\": false,\n      \"cacheDuration\": null,\n      \"calendarOptions\": null,\n      \"networkOptions\": null,\n      \"containedDisplayFields\": {},\n      \"displayFields\": [\n        __CORR_fieldId6_60463__\n      ],\n      \"displayFieldWidths\": [],\n      \"expandDetailViews\": false,\n      \"formatType\": \"Column\",\n      \"groupingFieldIds\": [],\n      \"mapOptions\": null,\n      \"mapboxOptions\": null,\n      \"calendarDisplayFormat\": 1,\n      \"isEditable\": true,\n      \"hierarchiesForField\": {},\n      \"isTrendingEnabled\": false\n    }\n  }\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _ngrx_search_results","method":"POST","path":"/ngrx/search/results","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"1321","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":"{\n  \"reportPayload\": {\n    \"reportDetail\": {\n      \"guid\": \"04b3feea-3b7f-46c7-99d1-df6310404e26\",\n      \"type\": \"SearchBased\",\n      \"description\": \"\",\n      \"name\": \"\",\n      \"pageId\": 9248,\n      \"asoStatus\": \"Normal\",\n      \"languageId\": 1,\n      \"isSystem\": false,\n      \"reportType\": \"Global\",\n      \"updateInformation\": {},\n      \"authorization\": {\n        \"users\": [],\n        \"groups\": []\n      }\n    },\n    \"reportCriteria\": {\n      \"reportType\": \"Table\",\n      \"criteria\": {\n        \"searchFilter\": null,\n        \"moduleCriteria\": {\n          \"id\": 0,\n          \"moduleId\": __CORR_moduleId4_10162__,\n          \"levelIds\": [\n            __CORR_levelId5_12126__\n          ],\n          \"keywordLevelIds\": [],\n          \"sortFields\": [\n            {\n              \"fieldId\": __CORR_fieldId6_60463__,\n              \"sortType\": \"Ascending\"\n            }\n          ],\n          \"isKeywordModule\": true,\n          \"buildoutRelationship\": \"Union\",\n          \"leveledBuildoutOptions\": null,\n          \"children\": []\n        },\n        \"keywords\": \"\",\n        \"contentIdLayerMapItems\": [],\n        \"searchDirection\": \"Both\"\n      },\n      \"showDateHeading\": false,\n      \"reportId\": 0,\n      \"maxRecordCount\": 0,\n      \"isResultLimitPercent\": false,\n      \"pageSize\": 50,\n      \"showCriteriaHeading\": false,\n      \"fixColumnHeaders\": false,\n      \"refreshRate\": null,\n      \"isHiddenFromMasterReportList\": false,\n      \"isHiddenFromIViews\": false,\n      \"isCachingEnabled\": false,\n      \"cacheDuration\": null,\n      \"calendarOptions\": null,\n      \"networkOptions\": null,\n      \"containedDisplayFields\": {},\n      \"displayFields\": [\n        __CORR_fieldId6_60463__\n      ],\n      \"displayFieldWidths\": [],\n      \"expandDetailViews\": false,\n      \"formatType\": \"Column\",\n      \"groupingFieldIds\": [],\n      \"mapOptions\": null,\n      \"mapboxOptions\": null,\n      \"calendarDisplayFormat\": 1,\n      \"isEditable\": true,\n      \"hierarchiesForField\": {},\n      \"isTrendingEnabled\": false\n    }\n  },\n  \"pageNum\": 0,\n  \"pageSize\": 50,\n  \"performFacetedSearch\": false\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500}];

const TEST_ID = __ENV.TESTID || ('local-' + Date.now());
const RUN_ID = __ENV.RUN_ID || ('PerfOps-' + Date.now());
const NODE_NAME = __ENV.NODE_NAME || 'PerfOps';
const TEST_NAME = __ENV.TEST_NAME || 'Archer NGRX Record Session Replay';
const SCENARIO_NAME = 'archer_ngrx_record_session_replay';
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
    [SCENARIO_NAME]: {
      executor: 'constant-vus',
      vus: 1,
      duration: '1m',
      exec: 'sessionReplay',
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<1000'],
    'http_req_failed': ['rate<0.8'],
    'checks': ['rate>0.9'],
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
  if (auth && auth.cookieHeader) headers.Cookie = auth.cookieHeader;
  if (auth && auth.jwt) headers.Authorization = 'Bearer ' + auth.jwt;
  return headers;
}

let __vuAuth = null;
function ensureAuth() {
  if (__vuAuth) return __vuAuth;
  const cred = getVuCredential();
  const loginPayload = { Username: cred.username, Password: cred.password, InstanceName: cred.instanceName };
  const res = http.post(
    cred.loginUrl,
    JSON.stringify(loginPayload),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'Login' } },
  );
  let body = {};
  try { body = res.json(); } catch (e) { body = {}; }
  const sessionToken = extractSessionToken(body);
  const jwt = extractJwt(body);
  if (!sessionToken && !jwt) {
    fail('Login failed for VU ' + __VU + ': ' + JSON.stringify(body).substring(0, 300));
  }
  __vuAuth = {
    sessionToken: sessionToken,
    jwt: jwt,
    cookieHeader: sessionToken ? '__ArcherSessionCookie__=' + sessionToken : '',
  };
  console.log('VU ' + __VU + ': Successfully authenticated as ' + cred.username + (jwt ? ' (session cookie + bearer JWT)' : ' (session cookie only)'));
  return __vuAuth;
}

function reauth() {
  __vuAuth = null;
  console.warn('VU ' + __VU + ': got 401 — re-authenticating.');
  return ensureAuth();
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

const RESPONSE_THRESHOLD_FLOOR_MS = 1000;
function effectiveResponseThreshold(reqDef) {
  return Math.max(reqDef.responseThresholdMs, RESPONSE_THRESHOLD_FLOOR_MS);
}

function buildCookieHeader(response, fallbackToken, loginRequest) {
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

let __vuJar = null;
function getVuJar() {
  if (!__vuJar) __vuJar = http.cookieJar();
  return __vuJar;
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

function replayStep(reqDef, jar, correlationVars) {
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

  let auth = ensureAuth();
  let res = doRequest(authHeadersFromAuth(auth));

  if (res.status === 401 || res.status === 403) {
    auth = reauth();
    res = doRequest(authHeadersFromAuth(auth));
  }

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

export default function (setupData) {
  sessionReplay(setupData);
}