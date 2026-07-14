import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Trend, Gauge } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
const LOGIN_REQUEST = null;
const LOGIN_CREDENTIALS = {
  loginCsrfToken: __ENV.LOGIN_CSRF_TOKEN || '',
  username: __ENV.LOGIN_USERNAME || 'PerfUser1',
  password: __ENV.LOGIN_PASSWORD || 'Password123$',
};

const CAPTURED_REQUESTS = [{"name":"GET _default_aspx","method":"GET","path":"/default.aspx","headers":{"accept":"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=0, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _StyleResourceHandler_axd_p_fH4vZGVmYXVsdC5hc3B40_t_6391","method":"GET","path":"/StyleResourceHandler.axd?p=fH4vZGVmYXVsdC5hc3B40&t=639195229846619884&ArcherVersion=c3cb260b3e5a5591a6f1c6c5d0191df391f13bc22729d2740de02c612531d0f4","headers":{"accept":"text/css,*/*;q=0.1","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=0","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _WebResource_axd_d_pynGkmcFUV13He1Qd6_TZIxkEYB6RI1YIrETS","method":"GET","path":"/WebResource.axd?d=pynGkmcFUV13He1Qd6_TZIxkEYB6RI1YIrETSxN6NpxbZJgCpN-U6cquvI2s8idV8bACyTqrdS87eAmahfv7qg2&t=638901536248157332","headers":{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ScriptResource_axd_d_NJmAwtEo3Ipnlaxl6CMhvmQiZnK9lqwXEZ","method":"GET","path":"/ScriptResource.axd?d=NJmAwtEo3Ipnlaxl6CMhvmQiZnK9lqwXEZ0Xg_YiWwygcUInIrDOIrj_dfqx6w610cO-DqpfwOKHirwLO_A0u_DsvCf4C3bLqB0YIUIGEYjJ_kKUXli_4mayySu4_lTxZqOMdD0wCQevUUsXDyLJRTEn8pNHZ08Qs0FIED3FpAY1&t=5c0e0825","headers":{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ScriptResource_axd_d_dwY9oWetJoJoVpgL6Zq8OMUN48DIY0ZYOD","method":"GET","path":"/ScriptResource.axd?d=dwY9oWetJoJoVpgL6Zq8OMUN48DIY0ZYODLqlbV33aKuZfdVVVJWoI01SX3s_1CXNBiNgfc80Dul_rMchPOOtIHLerwuyDiJQ8x8mHXOHvZW6xvgp1HptNhZDUFjvdOntrL0yS2uOXtHcoGBy1H7qsCSNTfqcxdPn6M5QJi8_T41&t=5c0e0825","headers":{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ScriptResource_axd_d_VL_I2BbK22NYeoOk7XFelnZjZaG5gBciBm","method":"GET","path":"/ScriptResource.axd?d=VL_I2BbK22NYeoOk7XFelnZjZaG5gBciBmBe2CBwyV7Wo5HM8EPcAWyIkdgGXg7ozkBbCqonv7jFyamcgT11kZpotCQ60OKK61bTaWOuip2JEhsrb_LEvxGjNG53GZCJEmh1kvXGTfnc4VbTfv4xDA2&t=23d42d05","headers":{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ScriptResource_axd_d_yJfeaaHSeQ_C_usISYYG59KkFdMmZEZoFf","method":"GET","path":"/ScriptResource.axd?d=yJfeaaHSeQ_C-usISYYG59KkFdMmZEZoFfYsWkxvOLylUB3ohmF7hQndntCQyvSW4SWzZiilhkCrms5CmIm8VkjQSbeBa7mRbhWT31qrhqyHm3ZOk7QqyCHc3_tlVJGJSHrhpghrAqQJLyxnz_WwOA2&t=23d42d05","headers":{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ScriptResource_axd_d_7reVa4cpYf7F76iqi3c0ub0TncYUOR6dJ1","method":"GET","path":"/ScriptResource.axd?d=7reVa4cpYf7F76iqi3c0ub0TncYUOR6dJ143_ug73vLDk5P_p2e-CiXQbdzSjIaRDp8XLOOyrUoZQLvv4swX1pFLAb0ZU7t4v17EhEhCCVZsTtttinG5BDOkCXBHoTTfEm470WIymPhibpLsJNDocQ2&t=23d42d05","headers":{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _default_aspx","method":"POST","path":"/default.aspx","headers":{"accept":"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"1191","content-type":"application/x-www-form-urlencoded","priority":"u=0, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":"{\n \"scriptManager_TSM\": \"\",\n \"__EVENTTARGET\": \"btnLogin\",\n \"__EVENTARGUMENT\": \"\",\n \"__VIEWSTATE\": \"5TDhYaro7n7IXDKATRrQyaPTa6rQc9qBMYiryNCPD9JNEOgwaBXVzE87U2sTboaDlfixbJY7TiK07C4Srtjs20NJE7Jgh3f4XwAOg0FjOlytgI8+9rXT7di94SIz8ePrMlADQl0o+PGs+ls70XP2QaRwkVzT5O8akdT8zh5gr4oYrjumjSP4wPJezWEFuwheZLGAB+qHE6ZcU3vdo85Ets2oTJ5TILorToCrRpdZux3wlHgRLsQEXF7vsCKIvByAiW7cDOKLuyW2e/v1n7Sz/uEk5tqukY7OGTYP54lI5wenUJPO40s7MpjA/lLcv9WBSezp+g3jEEj0TP7RDVJfoZ08UiWdPbCLjh6g5xh4VmGcNC5Ix5Vsu8H/cWrmq8fgkrO95gI5grfu7EvQRpkl59/ZYVP0kSJH07ocDLAtuC1vETUJ8+fihKKsJT7U/YmKDUuEi7ghBdsyQV2fOkIb2SZzEkjHSk8z68O20X7VZr7mkN0A/akCXbuNwj1q53Kq\",\n \"__VIEWSTATEGENERATOR\": \"CA0B0334\",\n \"loginCsrfToken\": \"08f2e58c-9118-4940-ba92-9a9784351c96\",\n \"showDomainRow\": \"False\",\n \"txtUserName\": \"PerfUser1\",\n \"txtUserName_ClientState\": \"{\\\"enabled\\\":true,\\\"emptyMessage\\\":\\\"\\\",\\\"validationText\\\":\\\"PerfUser1\\\",\\\"valueAsString\\\":\\\"PerfUser1\\\",\\\"lastSetTextBoxValue\\\":\\\"PerfUser1\\\"}\",\n \"txtpassword\": \"Password123$\",\n \"txtpassword_ClientState\": \"{\\\"enabled\\\":true,\\\"emptyMessage\\\":\\\"\\\",\\\"validationText\\\":\\\"Password123$\\\",\\\"valueAsString\\\":\\\"Password123$\\\",\\\"lastSetTextBoxValue\\\":\\\"Password123$\\\"}\"\n}","payloadType":"form","expectedStatus":302,"responseThresholdMs":500},{"name":"GET _apps_ArcherApp_Home_aspx","method":"GET","path":"/apps/ArcherApp/Home.aspx","headers":{"accept":"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=0, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _extstyle_axd_p_OTE4NTAwNHx_L2FwcHMvQXJjaGVyQXBwL0hvbWUu","method":"GET","path":"/extstyle.axd?p=OTE4NTAwNHx-L2FwcHMvQXJjaGVyQXBwL0hvbWUuYXNweA2&t=1783926201871&ArcherVersion=6.16.300.10302-212121176DC2","headers":{"accept":"text/css,*/*;q=0.1","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=0","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _WebResource_axd_d_pynGkmcFUV13He1Qd6_TZIxkEYB6RI1YIrETS","method":"GET","path":"/WebResource.axd?d=pynGkmcFUV13He1Qd6_TZIxkEYB6RI1YIrETSxN6NpxbZJgCpN-U6cquvI2s8idV8bACyTqrdS87eAmahfv7qg2&t=638901536248157332","headers":{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ScriptResource_axd_d_NJmAwtEo3Ipnlaxl6CMhvmQiZnK9lqwXEZ","method":"GET","path":"/ScriptResource.axd?d=NJmAwtEo3Ipnlaxl6CMhvmQiZnK9lqwXEZ0Xg_YiWwygcUInIrDOIrj_dfqx6w610cO-DqpfwOKHirwLO_A0u_DsvCf4C3bLqB0YIUIGEYjJ_kKUXli_4mayySu4_lTxZqOMdD0wCQevUUsXDyLJRTEn8pNHZ08Qs0FIED3FpAY1&t=5c0e0825","headers":{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ScriptResource_axd_d_dwY9oWetJoJoVpgL6Zq8OMUN48DIY0ZYOD","method":"GET","path":"/ScriptResource.axd?d=dwY9oWetJoJoVpgL6Zq8OMUN48DIY0ZYODLqlbV33aKuZfdVVVJWoI01SX3s_1CXNBiNgfc80Dul_rMchPOOtIHLerwuyDiJQ8x8mHXOHvZW6xvgp1HptNhZDUFjvdOntrL0yS2uOXtHcoGBy1H7qsCSNTfqcxdPn6M5QJi8_T41&t=5c0e0825","headers":{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_internal_Permission_GetModuleRecordAccess","method":"POST","path":"/api/internal/Permission/GetModuleRecordAccess","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"55","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36","x-archer-source":"Archer,OData","x-http-method-override":"GET","x-requested-with":"XMLHttpRequest"},"payload":"{\n \"Value\": \"?&$filter=Type eq '2' and HasCreate eq true\"\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_internal_Permission_GetModuleRecordAccess","method":"POST","path":"/api/internal/Permission/GetModuleRecordAccess","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"55","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36","x-archer-source":"Archer,OData","x-http-method-override":"GET","x-requested-with":"XMLHttpRequest"},"payload":"{\n \"Value\": \"?&$filter=Type eq '7' and HasCreate eq true\"\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_LookUp_node_root","method":"GET","path":"/api/V2/internal/LookUp?node=root","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36","x-requested-with":"XMLHttpRequest"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_ConsumerResources","method":"POST","path":"/api/V2/internal/ConsumerResources","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"37","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36","x-archer-source":"Archer,ConsumerResources","x-requested-with":"XMLHttpRequest"},"payload":"{\n \"value\": [\n \"PlatformUi\",\n \"MessageBox\"\n ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _plugins_json_id_1783926203424","method":"GET","path":"/plugins.json?id=1783926203424","headers":{"accept":"*/*","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_Internal_SessionStates_Save","method":"POST","path":"/api/V2/Internal/SessionStates/Save","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"150","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36","x-archer-source":"Archer,SessionState","x-requested-with":"XMLHttpRequest"},"payload":"{\n \"StateId\": null,\n \"Url\": \"grcr/eyJ4dHlwZSI6ImxvYWRlciIsInBhY2thZ2VOYW1lIjoiUmVhY3RMb2FkZXIiLCJyb3V0ZSI6Ii90ZGxwIiwidGFza051bSI6IkFsbEFjY2Vzc1JvbGUifQ==\"\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_ConsumerGroups","method":"POST","path":"/api/V2/internal/ConsumerGroups","headers":{"accept":"*/*","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"20","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36","x-archer-source":"Archer,Translations"},"payload":"{\n \"value\": [\n \"Global\"\n ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_ConsumerGroups","method":"POST","path":"/api/V2/internal/ConsumerGroups","headers":{"accept":"*/*","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"20","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36","x-archer-source":"Archer,Translations"},"payload":"{\n \"value\": [\n \"Global\"\n ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_NavMenuWorkspaceDashboards_id_header_na","method":"GET","path":"/api/V2/internal/NavMenuWorkspaceDashboards?id=header.navigation.WorkspaceModel-1","headers":{"accept":"*/*","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-type":"application/json","priority":"u=1, i","rsa-archer-sessioncontext-translate":"true","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36","x-archer-source":"Archer,TDLP"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_UserProfile_7646__id_7646","method":"GET","path":"/api/V2/internal/UserProfile(7646)?id=7646","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_NavigationTopBar","method":"GET","path":"/api/V2/internal/NavigationTopBar","headers":{"accept":"*/*","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36","x-archer-source":"Archer,Navigation"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_ConsumerGroups","method":"POST","path":"/api/V2/internal/ConsumerGroups","headers":{"accept":"*/*","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"31","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36","x-archer-source":"Archer,Navigation"},"payload":"{\n \"value\": [\n \"Global\",\n \"MainMenu\"\n ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_AppearanceThemes_GetActive","method":"GET","path":"/api/V2/internal/AppearanceThemes/GetActive","headers":{"accept":"*/*","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36","x-archer-source":"Archer,Navigation"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_NavigationMenuWorkspaces","method":"GET","path":"/api/V2/internal/NavigationMenuWorkspaces","headers":{"accept":"*/*","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36","x-archer-source":"Archer,Navigation"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_UserProfileImage","method":"GET","path":"/api/V2/internal/UserProfileImage","headers":{"accept":"*/*","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36","x-archer-source":"Archer,Navigation"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_NavigationMenuWorkspaceDetails","method":"POST","path":"/api/V2/internal/NavigationMenuWorkspaceDetails","headers":{"accept":"*/*","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"22","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36","x-archer-source":"Archer,Navigation"},"payload":"{\n \"WorkspaceIds\": [\n 210\n ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_ui_","method":"GET","path":"/ngrx-ui/","headers":{"accept":"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=0, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _apps_ArcherApp_ArcherApp_aspx","method":"GET","path":"/apps/ArcherApp/ArcherApp.aspx","headers":{"accept":"*/*","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_metadata_ModuleMetadata_moduleIds_10162","method":"GET","path":"/ngrx/metadata/ModuleMetadata?moduleIds=10162","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_ConsumerGroups","method":"POST","path":"/api/V2/internal/ConsumerGroups","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"269","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":"{\n \"value\": [\n \"Records\",\n \"Global\",\n \"ReactGrid\",\n \"Emails\",\n \"AdvancedFilter\",\n \"UserProfile\",\n \"Phones\",\n \"MessageBox\",\n \"DataFeeds\",\n \"ArcherUploadModal\",\n \"Applications\",\n \"Search\",\n \"GridPanel\",\n \"PlatFormUI\",\n \"DataImportWizard\",\n \"RecordPage\",\n \"MainMenu\",\n \"BulkActionJobHistory\",\n \"JobStatusReport\"\n ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_instance","method":"GET","path":"/ngrx/record/v1/instance","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _plugins_json_id_1783926215817","method":"GET","path":"/plugins.json?id=1783926215817","headers":{"accept":"*/*","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_profile_ModulePermission_moduleId_10162_TaskClassT","method":"GET","path":"/ngrx/profile/ModulePermission?moduleId=10162&TaskClassTypes=ViewMode&TaskClassTypes=Export&TaskClassTypes=Schedule&TaskClassTypes=Print&TaskClassTypes=SaveReport&TaskClassTypes=Email&TaskClassTypes=BulkUpdate","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_search_results_viewType_NavMenu_pageNum_0_pageSize","method":"GET","path":"/ngrx/search/results?viewType=NavMenu&pageNum=0&pageSize=0&solutionId=222&workspaceId=210&moduleId=10162&performFacetedSearch=false","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_UserProfile_7646__id_7646","method":"GET","path":"/api/V2/internal/UserProfile(7646)?id=7646","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_about_version_all","method":"GET","path":"/ngrx/record/v1/about/version/all","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_ConsumerGroups","method":"POST","path":"/api/V2/internal/ConsumerGroups","headers":{"accept":"*/*","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"31","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36","x-archer-source":"Archer,Navigation"},"payload":"{\n \"value\": [\n \"Global\",\n \"MainMenu\"\n ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_AppearanceThemes_GetActive","method":"GET","path":"/api/V2/internal/AppearanceThemes/GetActive","headers":{"accept":"*/*","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36","x-archer-source":"Archer,Navigation"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_UserProfileImage","method":"GET","path":"/api/V2/internal/UserProfileImage","headers":{"accept":"*/*","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36","x-archer-source":"Archer,Navigation"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_search_reportCriteria_default_moduleId_10162","method":"GET","path":"/ngrx/search/reportCriteria/default?moduleId=10162","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _ngrx_search_results_0_facets","method":"POST","path":"/ngrx/search/results/0/facets","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"1321","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":"{\n \"reportPayload\": {\n \"reportCriteria\": {\n \"reportType\": \"Table\",\n \"criteria\": {\n \"searchFilter\": null,\n \"moduleCriteria\": {\n \"id\": 0,\n \"moduleId\": 10162,\n \"levelIds\": [\n 12126\n ],\n \"keywordLevelIds\": [],\n \"sortFields\": [],\n \"isKeywordModule\": false,\n \"buildoutRelationship\": \"Union\",\n \"leveledBuildoutOptions\": null,\n \"children\": []\n },\n \"keywords\": \"\",\n \"contentIdLayerMapItems\": [],\n \"searchDirection\": \"Both\"\n },\n \"showDateHeading\": false,\n \"reportId\": 0,\n \"maxRecordCount\": 0,\n \"isResultLimitPercent\": false,\n \"pageSize\": 50,\n \"showCriteriaHeading\": false,\n \"fixColumnHeaders\": false,\n \"refreshRate\": null,\n \"isHiddenFromMasterReportList\": false,\n \"isHiddenFromIViews\": false,\n \"isCachingEnabled\": false,\n \"cacheDuration\": null,\n \"calendarOptions\": {\n \"calendarFields\": []\n },\n \"networkOptions\": null,\n \"containedDisplayFields\": {},\n \"displayFields\": [\n 60463\n ],\n \"displayFieldWidths\": [],\n \"expandDetailViews\": false,\n \"formatType\": \"Column\",\n \"groupingFieldIds\": [],\n \"mapOptions\": null,\n \"mapboxOptions\": null,\n \"calendarDisplayFormat\": 1,\n \"isEditable\": true,\n \"hierarchiesForField\": {},\n \"isTrendingEnabled\": false\n },\n \"reportDetail\": {\n \"guid\": \"67838ade-e7c3-455a-aa32-ff30f504811c\",\n \"type\": \"SearchBased\",\n \"description\": \"Display All\",\n \"name\": \"Display All\",\n \"asoStatus\": \"Normal\",\n \"isHiddenFromMasterReportList\": false,\n \"isHiddenFromIViews\": false,\n \"languageId\": 1,\n \"isSystem\": false,\n \"reportType\": \"NavMenuItem\",\n \"updateInformation\": {},\n \"authorization\": {\n \"users\": [],\n \"groups\": []\n }\n }\n }\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_modules_10162_levels","method":"GET","path":"/ngrx/record/v1/modules/10162/levels","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_ConsumerGroups","method":"POST","path":"/api/V2/internal/ConsumerGroups","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"57","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":"{\n \"value\": [\n \"Records\",\n \"Global\",\n \"ReactGrid\",\n \"Applications\"\n ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_profile_User_7646_additionalInfo","method":"GET","path":"/ngrx/profile/User/7646/additionalInfo","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12126_data_driven_events","method":"GET","path":"/ngrx/record/v1/levels/12126/data-driven-events","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12126","method":"GET","path":"/ngrx/record/v1/levels/12126","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12126_advanced_workflow_configura","method":"GET","path":"/ngrx/record/v1/levels/12126/advanced-workflow-configuration","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-type":"application/json; charset=UTF-8","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v2_levels_12126_default_layout","method":"GET","path":"/ngrx/record/v2/levels/12126/default-layout","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12126_image_fields","method":"GET","path":"/ngrx/record/v1/levels/12126/image-fields","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_modules_task_access_moduleIds_10162","method":"GET","path":"/ngrx/record/v1/modules/task-access?moduleIds=10162","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _ngrx_record_v1_contents","method":"POST","path":"/ngrx/record/v1/contents","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"156","content-type":"application/json; charset=UTF-8","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":"{\n \"levelId\": 12126,\n \"contentFields\": [\n {\n \"fieldId\": 60795,\n \"value\": \"Nitesh Kishore Kashi\",\n \"type\": \"Text\"\n },\n {\n \"fieldId\": 60796,\n \"value\": 35,\n \"type\": \"Numeric\"\n }\n ],\n \"version\": 0\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12126_advanced_workflow_configura","method":"GET","path":"/ngrx/record/v1/levels/12126/advanced-workflow-configuration","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-type":"application/json; charset=UTF-8","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v2_contents_786450_summary","method":"GET","path":"/ngrx/record/v2/contents/786450/summary","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12126","method":"GET","path":"/ngrx/record/v1/levels/12126","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_contents_786450","method":"GET","path":"/ngrx/record/v1/contents/786450","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _ngrx_record_v1_levels_12126_contents_786450_history","method":"POST","path":"/ngrx/record/v1/levels/12126/contents/786450/history","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36","content-length":"0","content-type":"application/json; charset=UTF-8"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_contents_786450_data_driven_events","method":"GET","path":"/ngrx/record/v1/contents/786450/data-driven-events","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_contents_786450_layout","method":"GET","path":"/ngrx/record/v1/contents/786450/layout","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"PUT _ngrx_record_v1_contents_786450_acquire_lock","method":"PUT","path":"/ngrx/record/v1/contents/786450/acquire-lock","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"0","content-type":"application/json; charset=UTF-8","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"DELETE _ngrx_record_v1_contents_786450","method":"DELETE","path":"/ngrx/record/v1/contents/786450","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"PATCH _ngrx_record_v1_contents_786450_release_lock","method":"PATCH","path":"/ngrx/record/v1/contents/786450/release-lock","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-type":"application/json; charset=UTF-8","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_metadata_ModuleMetadata_moduleIds_10162","method":"GET","path":"/ngrx/metadata/ModuleMetadata?moduleIds=10162","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_search_reportCriteria_default_moduleId_10162","method":"GET","path":"/ngrx/search/reportCriteria/default?moduleId=10162","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_search_results_viewType_NavMenu_pageNum_0_pageSize","method":"GET","path":"/ngrx/search/results?viewType=NavMenu&pageNum=0&pageSize=0&solutionId=222&workspaceId=210&moduleId=10162&performFacetedSearch=false","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _ngrx_search_results","method":"POST","path":"/ngrx/search/results","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"1321","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":"{\n \"reportPayload\": {\n \"reportDetail\": {\n \"guid\": \"04b3feea-3b7f-46c7-99d1-df6310404e26\",\n \"type\": \"SearchBased\",\n \"description\": \"\",\n \"name\": \"\",\n \"pageId\": 9248,\n \"asoStatus\": \"Normal\",\n \"languageId\": 1,\n \"isSystem\": false,\n \"reportType\": \"Global\",\n \"updateInformation\": {},\n \"authorization\": {\n \"users\": [],\n \"groups\": []\n }\n },\n \"reportCriteria\": {\n \"reportType\": \"Table\",\n \"criteria\": {\n \"searchFilter\": null,\n \"moduleCriteria\": {\n \"id\": 0,\n \"moduleId\": 10162,\n \"levelIds\": [\n 12126\n ],\n \"keywordLevelIds\": [],\n \"sortFields\": [\n {\n \"fieldId\": 60463,\n \"sortType\": \"Ascending\"\n }\n ],\n \"isKeywordModule\": true,\n \"buildoutRelationship\": \"Union\",\n \"leveledBuildoutOptions\": null,\n \"children\": []\n },\n \"keywords\": \"\",\n \"contentIdLayerMapItems\": [],\n \"searchDirection\": \"Both\"\n },\n \"showDateHeading\": false,\n \"reportId\": 0,\n \"maxRecordCount\": 0,\n \"isResultLimitPercent\": false,\n \"pageSize\": 50,\n \"showCriteriaHeading\": false,\n \"fixColumnHeaders\": false,\n \"refreshRate\": null,\n \"isHiddenFromMasterReportList\": false,\n \"isHiddenFromIViews\": false,\n \"isCachingEnabled\": false,\n \"cacheDuration\": null,\n \"calendarOptions\": null,\n \"networkOptions\": null,\n \"containedDisplayFields\": {},\n \"displayFields\": [\n 60463\n ],\n \"displayFieldWidths\": [],\n \"expandDetailViews\": false,\n \"formatType\": \"Column\",\n \"groupingFieldIds\": [],\n \"mapOptions\": null,\n \"mapboxOptions\": null,\n \"calendarDisplayFormat\": 1,\n \"isEditable\": true,\n \"hierarchiesForField\": {},\n \"isTrendingEnabled\": false\n }\n },\n \"pageNum\": 0,\n \"pageSize\": 50,\n \"performFacetedSearch\": false\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _ngrx_search_results_0_facets","method":"POST","path":"/ngrx/search/results/0/facets","headers":{"accept":"application/json","accept-encoding":"gzip, deflate, br, zstd","accept-language":"en-US,en;q=0.9","content-length":"1266","content-type":"application/json","priority":"u=1, i","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"},"payload":"{\n \"reportPayload\": {\n \"reportDetail\": {\n \"guid\": \"04b3feea-3b7f-46c7-99d1-df6310404e26\",\n \"type\": \"SearchBased\",\n \"description\": \"\",\n \"name\": \"\",\n \"pageId\": 9248,\n \"asoStatus\": \"Normal\",\n \"languageId\": 1,\n \"isSystem\": false,\n \"reportType\": \"Global\",\n \"updateInformation\": {},\n \"authorization\": {\n \"users\": [],\n \"groups\": []\n }\n },\n \"reportCriteria\": {\n \"reportType\": \"Table\",\n \"criteria\": {\n \"searchFilter\": null,\n \"moduleCriteria\": {\n \"id\": 0,\n \"moduleId\": 10162,\n \"levelIds\": [\n 12126\n ],\n \"keywordLevelIds\": [],\n \"sortFields\": [\n {\n \"fieldId\": 60463,\n \"sortType\": \"Ascending\"\n }\n ],\n \"isKeywordModule\": true,\n \"buildoutRelationship\": \"Union\",\n \"leveledBuildoutOptions\": null,\n \"children\": []\n },\n \"keywords\": \"\",\n \"contentIdLayerMapItems\": [],\n \"searchDirection\": \"Both\"\n },\n \"showDateHeading\": false,\n \"reportId\": 0,\n \"maxRecordCount\": 0,\n \"isResultLimitPercent\": false,\n \"pageSize\": 50,\n \"showCriteriaHeading\": false,\n \"fixColumnHeaders\": false,\n \"refreshRate\": null,\n \"isHiddenFromMasterReportList\": false,\n \"isHiddenFromIViews\": false,\n \"isCachingEnabled\": false,\n \"cacheDuration\": null,\n \"calendarOptions\": null,\n \"networkOptions\": null,\n \"containedDisplayFields\": {},\n \"displayFields\": [\n 60463\n ],\n \"displayFieldWidths\": [],\n \"expandDetailViews\": false,\n \"formatType\": \"Column\",\n \"groupingFieldIds\": [],\n \"mapOptions\": null,\n \"mapboxOptions\": null,\n \"calendarDisplayFormat\": 1,\n \"isEditable\": true,\n \"hierarchiesForField\": {},\n \"isTrendingEnabled\": false\n }\n }\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500}];

const TEST_ID = __ENV.TESTID || ('local-' + Date.now());
const RUN_ID = __ENV.RUN_ID || ('PerfOps-' + Date.now());
const NODE_NAME = __ENV.NODE_NAME || 'PerfOps';
const TEST_NAME = __ENV.TEST_NAME || 'Archer App Session Replay';
const BASE_URL = __ENV.BASE_URL || 'https://9185004.classic-dev.internal.archerirm.net';
const INFLUX_V2_URL = __ENV.INFLUX_V2_URL || 'http://localhost:8086';
const INFLUX_V2_ORG = __ENV.INFLUX_V2_ORG || '';
const INFLUX_V2_ORG_ID = __ENV.INFLUX_V2_ORG_ID || '';
const INFLUX_V2_BUCKET = __ENV.INFLUX_V2_BUCKET || 'PerfDB';
const INFLUX_V2_TOKEN = __ENV.INFLUX_V2_TOKEN || '';
const INFLUX_V2_AUTO_CREATE_BUCKET = (__ENV.INFLUX_V2_AUTO_CREATE_BUCKET || 'false').toLowerCase() === 'true';
const INFLUX_V2_ENABLED = !!(INFLUX_V2_ORG && INFLUX_V2_BUCKET && INFLUX_V2_TOKEN);

const SCENARIO_NAME = 'archer_session_replay';

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
    archer_session_replay: {
      executor: 'constant-vus',
      vus: 10,
      duration: '1m',
      exec: 'sessionReplay',
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<800'],
    'http_req_failed': ['rate<0.8'],
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
function isResponseStatusExpected(response, expectedStatus) {
  if (expectedStatus === undefined || expectedStatus === null) return false;
  if (response.status === expectedStatus) return true;
  if (expectedStatus >= 300 && expectedStatus < 400) {
    return response.status >= 300 && response.status < 400;
  }
  return response.status === 401 || response.status === 403;
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

function buildLoginClientState(value) {
  return JSON.stringify({
    enabled: true,
    emptyMessage: '',
    validationText: value || '',
    valueAsString: value || '',
    lastSetTextBoxValue: value || '',
  });
}

// Fresh __VIEWSTATE / __VIEWSTATEGENERATOR / __EVENTVALIDATION / loginCsrfToken are
// scraped from a live GET of the login page (see setup() below) rather than reused
// from the HAR capture — ASP.NET WebForms rejects a postback whose __VIEWSTATE
// doesn't match the one it most recently issued, so replaying the stale captured
// value fails on every run after the one it was recorded in.
function extractLoginPageTokens(html) {
  const tokens = {};
  if (!html) return tokens;
  const body = String(html);
  const viewState = body.match(/id="__VIEWSTATE"[^>]*value="([^"]*)"/);
  if (viewState) tokens.__VIEWSTATE = viewState[1];
  const viewStateGen = body.match(/id="__VIEWSTATEGENERATOR"[^>]*value="([^"]*)"/);
  if (viewStateGen) tokens.__VIEWSTATEGENERATOR = viewStateGen[1];
  const eventValidation = body.match(/id="__EVENTVALIDATION"[^>]*value="([^"]*)"/);
  if (eventValidation) tokens.__EVENTVALIDATION = eventValidation[1];
  const csrf = body.match(/loginCsrfToken['"]?\s*[:=]\s*['"]([0-9a-fA-F-]{16,})['"]/);
  if (csrf) tokens.loginCsrfToken = csrf[1];
  return tokens;
}

function buildLoginRequestPayload(reqDef, freshTokens) {
  if (!reqDef || reqDef.payloadType !== 'form') {
    return requestBody(reqDef && reqDef.payload, reqDef && reqDef.payloadType);
  }

  let payload = requestBody(reqDef.payload, reqDef.payloadType);
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      return payload;
    }
  }
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const tokens = freshTokens || {};
  // Fresh page-scraped values always win over the stale HAR-captured ones —
  // ASP.NET postback validation fails otherwise. LOGIN_CSRF_TOKEN env var, if
  // explicitly set, takes priority over both (manual override escape hatch).
  if (tokens.__VIEWSTATE) payload.__VIEWSTATE = tokens.__VIEWSTATE;
  if (tokens.__VIEWSTATEGENERATOR) payload.__VIEWSTATEGENERATOR = tokens.__VIEWSTATEGENERATOR;
  if (tokens.__EVENTVALIDATION) payload.__EVENTVALIDATION = tokens.__EVENTVALIDATION;
  payload.loginCsrfToken = LOGIN_CREDENTIALS.loginCsrfToken || tokens.loginCsrfToken || payload.loginCsrfToken;
  payload.txtUserName = LOGIN_CREDENTIALS.username;
  payload.txtUserName_ClientState = buildLoginClientState(LOGIN_CREDENTIALS.username);
  payload.txtpassword = LOGIN_CREDENTIALS.password;
  payload.txtpassword_ClientState = buildLoginClientState(LOGIN_CREDENTIALS.password);
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

// A captured login postback doesn't always have "login"/"auth"/"signin" in its
// name or URL (e.g. this app posts back to the same /default.aspx the page was
// served from) — fall back to sniffing the payload for giveaway WebForms login
// field names so the login step is still detected and parameterized correctly.
function looksLikeLoginPayload(reqDef) {
  if (!reqDef || !reqDef.payload) return false;
  const raw = String(reqDef.payload);
  return /loginCsrfToken/i.test(raw) || /txtpassword/i.test(raw) || /btnLogin/i.test(raw);
}

function findLoginRequest(requests) {
  if (!requests || requests.length === 0) return null;
  if (LOGIN_REQUEST) return LOGIN_REQUEST;
  const byNamePath = requests.filter(function (reqDef) {
    const name = String(reqDef.name || '').toLowerCase();
    const path = String(reqDef.path || '').toLowerCase();
    return name.includes('login') || name.includes('auth') || name.includes('signin') || path.includes('login') || path.includes('auth') || path.includes('signin');
  });
  if (byNamePath.length > 0) return byNamePath[0];
  const byPayload = requests.filter(function (reqDef) { return reqDef.method === 'POST' && looksLikeLoginPayload(reqDef); });
  return byPayload[0] || null;
}

// ── Created-resource id correlation ─────────────────────────────────────────
//
// A captured session that creates a record (POST to a bare collection endpoint,
// e.g. /ngrx/record/v1/contents) and then reads/updates/deletes it embeds the
// ORIGINAL run's record id as a literal path segment in every dependent call
// (…/contents/786450/summary, …/contents/786450/acquire-lock, etc). Replaying
// that literal id verbatim only works for the single record that happened to
// exist at capture time — every fresh run (and every concurrent VU) creates its
// OWN new record with a different id, so the dependent calls must be rewritten
// to use the id that THIS run's create call actually returned.
//
// Rules are derived once, statically, from the shape of CAPTURED_REQUESTS
// itself: a POST whose own path does NOT end in a numeric segment is a
// candidate "creator". Its last path segment (e.g. "contents") is used as an
// anchor — any other captured path containing "/<anchor>/<digits>" with a
// consistent numeric value is a dependent that needs that id substituted at
// runtime. Only 4+ digit ids are considered, to avoid false positives on small
// literal indices (e.g. the "0" in /ngrx/search/results/0/facets).
function buildCorrelationRules(requests) {
  const rules = [];
  requests.forEach(function (creator) {
    if (creator.method !== 'POST') return;
    const creatorCleanPath = creator.path.split('?')[0].replace(/\/$/, '');
    const creatorSegments = creatorCleanPath.split('/').filter(Boolean);
    const lastSeg = creatorSegments[creatorSegments.length - 1];
    if (!lastSeg || /^\d+$/.test(lastSeg)) return; // creator's own path already has an id — not a plain collection POST
    const anchor = '/' + lastSeg + '/';
    let oldId = null;
    const dependents = [];
    requests.forEach(function (dep) {
      if (dep === creator) return;
      const depPath = dep.path.split('?')[0];
      const idx = depPath.indexOf(anchor);
      if (idx === -1) return;
      const rest = depPath.slice(idx + anchor.length);
      const match = rest.match(/^(\d{4,})/);
      if (!match) return;
      if (oldId === null) oldId = match[1];
      if (match[1] !== oldId) return; // inconsistent id under the same anchor — skip, not a clean correlation
      dependents.push(dep);
    });
    if (oldId && dependents.length > 0) {
      rules.push({
        creatorName: creator.name,
        creatorMethod: creator.method,
        creatorPath: creator.path,
        anchor: anchor,
        oldId: oldId,
      });
    }
  });
  return rules;
}

const CORRELATION_RULES = buildCorrelationRules(CAPTURED_REQUESTS);

// Looks for a newly-created resource id in a handful of common REST response
// shapes. Returns null (never throws) when the response doesn't match any of
// them, so a rule that doesn't pan out just leaves the stale id in place
// instead of breaking the run.
function extractCreatedId(body) {
  if (!body || typeof body !== 'object') return null;
  const candidates = [
    body.RequestedObject && (body.RequestedObject.Id ?? body.RequestedObject.id),
    body.Id, body.id, body.ID,
    body.data && (body.data.Id ?? body.data.id),
  ];
  const found = candidates.find(function (v) { return v !== undefined && v !== null; });
  return found !== undefined ? String(found) : null;
}

// Rewrites reqDef.path / reqDef.payload to swap any correlated oldId for the id
// this run's create call actually returned. Returns reqDef unchanged (same
// reference) when no correlation applies, so callers can't accidentally mutate
// the shared CAPTURED_REQUESTS array — a new object is only ever produced when
// a substitution actually happens.
function applyCorrelatedIds(reqDef, correlatedIds) {
  const oldIds = Object.keys(correlatedIds);
  if (oldIds.length === 0) return reqDef;
  let path = reqDef.path;
  let payload = reqDef.payload;
  let changed = false;
  oldIds.forEach(function (oldId) {
    const newId = correlatedIds[oldId];
    const pathRe = new RegExp('(^|/)' + oldId + '(?=/|\\?|$)', 'g');
    if (pathRe.test(path)) { path = path.replace(pathRe, '$1' + newId); changed = true; }
    if (typeof payload === 'string' && payload.indexOf(oldId) !== -1) {
      payload = payload.replace(new RegExp('\\b' + oldId + '\\b', 'g'), newId);
      changed = true;
    }
  });
  return changed ? Object.assign({}, reqDef, { path: path, payload: payload }) : reqDef;
}

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

  // Fetch a fresh copy of the login page first so __VIEWSTATE / __VIEWSTATEGENERATOR
  // / loginCsrfToken reflect what the server issued for THIS run, not the stale
  // values captured in the HAR (which are single-use / expired by replay time).
  let freshTokens = {};
  try {
    const loginPageRes = http.get(BASE_URL + effectiveLoginRequest.path, {
      jar: jar,
      tags: { name: 'GET ' + effectiveLoginRequest.path + ' (login page)' },
    });
    freshTokens = extractLoginPageTokens(loginPageRes.body);
  } catch (e) {
    console.warn('Setup: failed to fetch fresh login page tokens: ' + e);
  }

  const res = http.request(
    effectiveLoginRequest.method,
    BASE_URL + effectiveLoginRequest.path,
    buildLoginRequestPayload(effectiveLoginRequest, freshTokens),
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

  if (!cookieHeader && !sessionToken && !(res.status >= 300 && res.status < 400)) {
    console.warn('Setup: authentication request returned no session data; continuing without auth headers.');
    return { jar: jar };
  }

  console.log('Setup: authentication completed with status ' + res.status + '.');
  return { jar: jar, cookieHeader: cookieHeader };
}

export function teardown() {
  const ts = String(Date.now()) + '000000';
  writeInfluxLines([
    'testStartEnd,' + buildInfluxTagSet({ runId: RUN_ID, nodeName: NODE_NAME, testName: TEST_NAME, type: 'finished' }) + ' value=1i ' + ts,
  ]);
  flushInfluxLines();
}

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

  return res;
}

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

  // Per-iteration correlation state — each VU/iteration creates its own record,
  // so the id map must never be shared across iterations or VUs.
  const correlatedIds = {};

  for (let i = 0; i < replayRequests.length; i++) {
    const reqDef = applyCorrelatedIds(replayRequests[i], correlatedIds);
    group(reqDef.name, function () {
      const res = replayStep(reqDef, jar, authHeaders);
      const rule = CORRELATION_RULES.find(function (r) {
        return r.creatorName === reqDef.name && r.creatorMethod === reqDef.method && r.creatorPath === reqDef.path;
      });
      if (rule) {
        const newId = extractCreatedId(getResponseBody(res));
        if (newId) {
          correlatedIds[rule.oldId] = newId;
        } else {
          console.warn(reqDef.name + ': expected a created-resource id in the response for correlation but none was found; steps referencing id ' + rule.oldId + ' will fall back to the stale captured value.');
        }
      }
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
