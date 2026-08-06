import http from 'k6/http';
import { check, group, sleep, fail } from 'k6';
import { Counter, Trend, Gauge } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
const LOGIN_REQUEST = null;
const CAPTURED_REQUESTS = [{"name":"GET _default_aspx","method":"GET","path":"/default.aspx","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _StyleResourceHandler_axd_p_fH4vZGVmYXVsdC5hc3B40_t_6391","method":"GET","path":"/StyleResourceHandler.axd?p=fH4vZGVmYXVsdC5hc3B40&t=639195229846619884&ArcherVersion=c3cb260b3e5a5591a6f1c6c5d0191df391f13bc22729d2740de02c612531d0f4","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _WebResource_axd_d_pynGkmcFUV13He1Qd6_TZIxkEYB6RI1YIrETS","method":"GET","path":"/WebResource.axd?d=pynGkmcFUV13He1Qd6_TZIxkEYB6RI1YIrETSxN6NpxbZJgCpN-U6cquvI2s8idV8bACyTqrdS87eAmahfv7qg2&t=638901536248157332","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ScriptResource_axd_d_NJmAwtEo3Ipnlaxl6CMhvmQiZnK9lqwXEZ","method":"GET","path":"/ScriptResource.axd?d=NJmAwtEo3Ipnlaxl6CMhvmQiZnK9lqwXEZ0Xg_YiWwygcUInIrDOIrj_dfqx6w610cO-DqpfwOKHirwLO_A0u_DsvCf4C3bLqB0YIUIGEYjJ_kKUXli_4mayySu4_lTxZqOMdD0wCQevUUsXDyLJRTEn8pNHZ08Qs0FIED3FpAY1&t=5c0e0825","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ScriptResource_axd_d_dwY9oWetJoJoVpgL6Zq8OMUN48DIY0ZYOD","method":"GET","path":"/ScriptResource.axd?d=dwY9oWetJoJoVpgL6Zq8OMUN48DIY0ZYODLqlbV33aKuZfdVVVJWoI01SX3s_1CXNBiNgfc80Dul_rMchPOOtIHLerwuyDiJQ8x8mHXOHvZW6xvgp1HptNhZDUFjvdOntrL0yS2uOXtHcoGBy1H7qsCSNTfqcxdPn6M5QJi8_T41&t=5c0e0825","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ScriptResource_axd_d_VL_I2BbK22NYeoOk7XFelnZjZaG5gBciBm","method":"GET","path":"/ScriptResource.axd?d=VL_I2BbK22NYeoOk7XFelnZjZaG5gBciBmBe2CBwyV7Wo5HM8EPcAWyIkdgGXg7ozkBbCqonv7jFyamcgT11kZpotCQ60OKK61bTaWOuip2JEhsrb_LEvxGjNG53GZCJEmh1kvXGTfnc4VbTfv4xDA2&t=23d42d05","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ScriptResource_axd_d_yJfeaaHSeQ_C_usISYYG59KkFdMmZEZoFf","method":"GET","path":"/ScriptResource.axd?d=yJfeaaHSeQ_C-usISYYG59KkFdMmZEZoFfYsWkxvOLylUB3ohmF7hQndntCQyvSW4SWzZiilhkCrms5CmIm8VkjQSbeBa7mRbhWT31qrhqyHm3ZOk7QqyCHc3_tlVJGJSHrhpghrAqQJLyxnz_WwOA2&t=23d42d05","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ScriptResource_axd_d_7reVa4cpYf7F76iqi3c0ub0TncYUOR6dJ1","method":"GET","path":"/ScriptResource.axd?d=7reVa4cpYf7F76iqi3c0ub0TncYUOR6dJ143_ug73vLDk5P_p2e-CiXQbdzSjIaRDp8XLOOyrUoZQLvv4swX1pFLAb0ZU7t4v17EhEhCCVZsTtttinG5BDOkCXBHoTTfEm470WIymPhibpLsJNDocQ2&t=23d42d05","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _default_aspx","method":"POST","path":"/default.aspx","headers":{"Content-Type":"application/json"},"payload":"{\n  \"scriptManager_TSM\": \"\",\n  \"__EVENTTARGET\": \"btnLogin\",\n  \"__EVENTARGUMENT\": \"\",\n  \"__VIEWSTATE\": \"5TDhYaro7n7IXDKATRrQyaPTa6rQc9qBMYiryNCPD9JNEOgwaBXVzE87U2sTboaDlfixbJY7TiK07C4Srtjs20NJE7Jgh3f4XwAOg0FjOlytgI8+9rXT7di94SIz8ePrMlADQl0o+PGs+ls70XP2QaRwkVzT5O8akdT8zh5gr4oYrjumjSP4wPJezWEFuwheZLGAB+qHE6ZcU3vdo85Ets2oTJ5TILorToCrRpdZux3wlHgRLsQEXF7vsCKIvByAiW7cDOKLuyW2e/v1n7Sz/uEk5tqukY7OGTYP54lI5wenUJPO40s7MpjA/lLcv9WBSezp+g3jEEj0TP7RDVJfoZ08UiWdPbCLjh6g5xh4VmGcNC5Ix5Vsu8H/cWrmq8fgkrO95gI5grfu7EvQRpkl59/ZYVP0kSJH07ocDLAtuC1vETUJ8+fihKKsJT7U/YmKDUuEi7ghBdsyQV2fOkIb2SZzEkjHSk8z68O20X7VZr7mkN0A/akCXbuNwj1q53Kq\",\n  \"__VIEWSTATEGENERATOR\": \"CA0B0334\",\n  \"loginCsrfToken\": \"08f2e58c-9118-4940-ba92-9a9784351c96\",\n  \"showDomainRow\": \"False\",\n  \"txtUserName\": \"PerfUser1\",\n  \"txtUserName_ClientState\": \"{\\\"enabled\\\":true,\\\"emptyMessage\\\":\\\"\\\",\\\"validationText\\\":\\\"PerfUser1\\\",\\\"valueAsString\\\":\\\"PerfUser1\\\",\\\"lastSetTextBoxValue\\\":\\\"PerfUser1\\\"}\",\n  \"txtpassword\": \"Password123$\",\n  \"txtpassword_ClientState\": \"{\\\"enabled\\\":true,\\\"emptyMessage\\\":\\\"\\\",\\\"validationText\\\":\\\"Password123$\\\",\\\"valueAsString\\\":\\\"Password123$\\\",\\\"lastSetTextBoxValue\\\":\\\"Password123$\\\"}\"\n}","payloadType":"form","expectedStatus":302,"responseThresholdMs":500},{"name":"GET _apps_ArcherApp_Home_aspx","method":"GET","path":"/apps/ArcherApp/Home.aspx","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _extstyle_axd_p_OTE4NTAwNHx_L2FwcHMvQXJjaGVyQXBwL0hvbWUu","method":"GET","path":"/extstyle.axd?p=OTE4NTAwNHx-L2FwcHMvQXJjaGVyQXBwL0hvbWUuYXNweA2&t=1783926201871&ArcherVersion=6.16.300.10302-212121176DC2","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _WebResource_axd_d_pynGkmcFUV13He1Qd6_TZIxkEYB6RI1YIrETS","method":"GET","path":"/WebResource.axd?d=pynGkmcFUV13He1Qd6_TZIxkEYB6RI1YIrETSxN6NpxbZJgCpN-U6cquvI2s8idV8bACyTqrdS87eAmahfv7qg2&t=638901536248157332","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ScriptResource_axd_d_NJmAwtEo3Ipnlaxl6CMhvmQiZnK9lqwXEZ","method":"GET","path":"/ScriptResource.axd?d=NJmAwtEo3Ipnlaxl6CMhvmQiZnK9lqwXEZ0Xg_YiWwygcUInIrDOIrj_dfqx6w610cO-DqpfwOKHirwLO_A0u_DsvCf4C3bLqB0YIUIGEYjJ_kKUXli_4mayySu4_lTxZqOMdD0wCQevUUsXDyLJRTEn8pNHZ08Qs0FIED3FpAY1&t=5c0e0825","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ScriptResource_axd_d_dwY9oWetJoJoVpgL6Zq8OMUN48DIY0ZYOD","method":"GET","path":"/ScriptResource.axd?d=dwY9oWetJoJoVpgL6Zq8OMUN48DIY0ZYODLqlbV33aKuZfdVVVJWoI01SX3s_1CXNBiNgfc80Dul_rMchPOOtIHLerwuyDiJQ8x8mHXOHvZW6xvgp1HptNhZDUFjvdOntrL0yS2uOXtHcoGBy1H7qsCSNTfqcxdPn6M5QJi8_T41&t=5c0e0825","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_internal_Permission_GetModuleRecordAccess","method":"POST","path":"/api/internal/Permission/GetModuleRecordAccess","headers":{"x-http-method-override":"GET","Content-Type":"application/json"},"payload":"{\n  \"Value\": \"?&$filter=Type eq '2' and HasCreate eq true\"\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_internal_Permission_GetModuleRecordAccess","method":"POST","path":"/api/internal/Permission/GetModuleRecordAccess","headers":{"x-http-method-override":"GET","Content-Type":"application/json"},"payload":"{\n  \"Value\": \"?&$filter=Type eq '7' and HasCreate eq true\"\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_LookUp_node_root","method":"GET","path":"/api/V2/internal/LookUp?node=root","headers":{"Content-Type":"application/json","x-requested-with":"XMLHttpRequest"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_ConsumerResources","method":"POST","path":"/api/V2/internal/ConsumerResources","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1","x-archer-source":"Archer,ConsumerResources","x-requested-with":"XMLHttpRequest"},"payload":"{\n  \"value\": [\n    \"PlatformUi\",\n    \"MessageBox\"\n  ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _plugins_json_id_1783926203424","method":"GET","path":"/plugins.json?id=1783926203424","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_Internal_SessionStates_Save","method":"POST","path":"/api/V2/Internal/SessionStates/Save","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1","x-archer-source":"Archer,SessionState","x-requested-with":"XMLHttpRequest"},"payload":"{\n  \"StateId\": null,\n  \"Url\": \"grcr/eyJ4dHlwZSI6ImxvYWRlciIsInBhY2thZ2VOYW1lIjoiUmVhY3RMb2FkZXIiLCJyb3V0ZSI6Ii90ZGxwIiwidGFza051bSI6IkFsbEFjY2Vzc1JvbGUifQ==\"\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_ConsumerGroups","method":"POST","path":"/api/V2/internal/ConsumerGroups","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1","x-archer-source":"Archer,Translations"},"payload":"{\n  \"value\": [\n    \"Global\"\n  ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_ConsumerGroups","method":"POST","path":"/api/V2/internal/ConsumerGroups","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1","x-archer-source":"Archer,Translations"},"payload":"{\n  \"value\": [\n    \"Global\"\n  ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_NavMenuWorkspaceDashboards_id_header_na","method":"GET","path":"/api/V2/internal/NavMenuWorkspaceDashboards?id=header.navigation.WorkspaceModel-1","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1","x-archer-source":"Archer,TDLP"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_UserProfile_7646__id_7646","method":"GET","path":"/api/V2/internal/UserProfile(7646)?id=7646","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_NavigationTopBar","method":"GET","path":"/api/V2/internal/NavigationTopBar","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1","x-archer-source":"Archer,Navigation"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_ConsumerGroups","method":"POST","path":"/api/V2/internal/ConsumerGroups","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1","x-archer-source":"Archer,Navigation"},"payload":"{\n  \"value\": [\n    \"Global\",\n    \"MainMenu\"\n  ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_AppearanceThemes_GetActive","method":"GET","path":"/api/V2/internal/AppearanceThemes/GetActive","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1","x-archer-source":"Archer,Navigation"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_NavigationMenuWorkspaces","method":"GET","path":"/api/V2/internal/NavigationMenuWorkspaces","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1","x-archer-source":"Archer,Navigation"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_UserProfileImage","method":"GET","path":"/api/V2/internal/UserProfileImage","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1","x-archer-source":"Archer,Navigation"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_NavigationMenuWorkspaceDetails","method":"POST","path":"/api/V2/internal/NavigationMenuWorkspaceDetails","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1","x-archer-source":"Archer,Navigation"},"payload":"{\n  \"WorkspaceIds\": [\n    210\n  ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_ui_","method":"GET","path":"/ngrx-ui/","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _apps_ArcherApp_ArcherApp_aspx","method":"GET","path":"/apps/ArcherApp/ArcherApp.aspx","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_metadata_ModuleMetadata_moduleIds_10162","method":"GET","path":"/ngrx/metadata/ModuleMetadata?moduleIds=10162","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_ConsumerGroups","method":"POST","path":"/api/V2/internal/ConsumerGroups","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":"{\n  \"value\": [\n    \"Records\",\n    \"Global\",\n    \"ReactGrid\",\n    \"Emails\",\n    \"AdvancedFilter\",\n    \"UserProfile\",\n    \"Phones\",\n    \"MessageBox\",\n    \"DataFeeds\",\n    \"ArcherUploadModal\",\n    \"Applications\",\n    \"Search\",\n    \"GridPanel\",\n    \"PlatFormUI\",\n    \"DataImportWizard\",\n    \"RecordPage\",\n    \"MainMenu\",\n    \"BulkActionJobHistory\",\n    \"JobStatusReport\"\n  ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_instance","method":"GET","path":"/ngrx/record/v1/instance","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _plugins_json_id_1783926215817","method":"GET","path":"/plugins.json?id=1783926215817","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_profile_ModulePermission_moduleId_10162_TaskClassT","method":"GET","path":"/ngrx/profile/ModulePermission?moduleId=10162&TaskClassTypes=ViewMode&TaskClassTypes=Export&TaskClassTypes=Schedule&TaskClassTypes=Print&TaskClassTypes=SaveReport&TaskClassTypes=Email&TaskClassTypes=BulkUpdate","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_search_results_viewType_NavMenu_pageNum_0_pageSize","method":"GET","path":"/ngrx/search/results?viewType=NavMenu&pageNum=0&pageSize=0&solutionId=222&workspaceId=210&moduleId=10162&performFacetedSearch=false","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_UserProfile_7646__id_7646","method":"GET","path":"/api/V2/internal/UserProfile(7646)?id=7646","headers":{"Content-Type":"application/json"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_about_version_all","method":"GET","path":"/ngrx/record/v1/about/version/all","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_ConsumerGroups","method":"POST","path":"/api/V2/internal/ConsumerGroups","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1","x-archer-source":"Archer,Navigation"},"payload":"{\n  \"value\": [\n    \"Global\",\n    \"MainMenu\"\n  ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_AppearanceThemes_GetActive","method":"GET","path":"/api/V2/internal/AppearanceThemes/GetActive","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1","x-archer-source":"Archer,Navigation"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _api_V2_internal_UserProfileImage","method":"GET","path":"/api/V2/internal/UserProfileImage","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1","x-archer-source":"Archer,Navigation"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_search_reportCriteria_default_moduleId_10162","method":"GET","path":"/ngrx/search/reportCriteria/default?moduleId=10162","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _ngrx_search_results_0_facets","method":"POST","path":"/ngrx/search/results/0/facets","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":"{\n  \"reportPayload\": {\n    \"reportCriteria\": {\n      \"reportType\": \"Table\",\n      \"criteria\": {\n        \"searchFilter\": null,\n        \"moduleCriteria\": {\n          \"id\": 0,\n          \"moduleId\": 10162,\n          \"levelIds\": [\n            12126\n          ],\n          \"keywordLevelIds\": [],\n          \"sortFields\": [],\n          \"isKeywordModule\": false,\n          \"buildoutRelationship\": \"Union\",\n          \"leveledBuildoutOptions\": null,\n          \"children\": []\n        },\n        \"keywords\": \"\",\n        \"contentIdLayerMapItems\": [],\n        \"searchDirection\": \"Both\"\n      },\n      \"showDateHeading\": false,\n      \"reportId\": 0,\n      \"maxRecordCount\": 0,\n      \"isResultLimitPercent\": false,\n      \"pageSize\": 50,\n      \"showCriteriaHeading\": false,\n      \"fixColumnHeaders\": false,\n      \"refreshRate\": null,\n      \"isHiddenFromMasterReportList\": false,\n      \"isHiddenFromIViews\": false,\n      \"isCachingEnabled\": false,\n      \"cacheDuration\": null,\n      \"calendarOptions\": {\n        \"calendarFields\": []\n      },\n      \"networkOptions\": null,\n      \"containedDisplayFields\": {},\n      \"displayFields\": [\n        60463\n      ],\n      \"displayFieldWidths\": [],\n      \"expandDetailViews\": false,\n      \"formatType\": \"Column\",\n      \"groupingFieldIds\": [],\n      \"mapOptions\": null,\n      \"mapboxOptions\": null,\n      \"calendarDisplayFormat\": 1,\n      \"isEditable\": true,\n      \"hierarchiesForField\": {},\n      \"isTrendingEnabled\": false\n    },\n    \"reportDetail\": {\n      \"guid\": \"67838ade-e7c3-455a-aa32-ff30f504811c\",\n      \"type\": \"SearchBased\",\n      \"description\": \"Display All\",\n      \"name\": \"Display All\",\n      \"asoStatus\": \"Normal\",\n      \"isHiddenFromMasterReportList\": false,\n      \"isHiddenFromIViews\": false,\n      \"languageId\": 1,\n      \"isSystem\": false,\n      \"reportType\": \"NavMenuItem\",\n      \"updateInformation\": {},\n      \"authorization\": {\n        \"users\": [],\n        \"groups\": []\n      }\n    }\n  }\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_modules_10162_levels","method":"GET","path":"/ngrx/record/v1/modules/10162/levels","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _api_V2_internal_ConsumerGroups","method":"POST","path":"/api/V2/internal/ConsumerGroups","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":"{\n  \"value\": [\n    \"Records\",\n    \"Global\",\n    \"ReactGrid\",\n    \"Applications\"\n  ]\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_profile_User_7646_additionalInfo","method":"GET","path":"/ngrx/profile/User/7646/additionalInfo","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12126_data_driven_events","method":"GET","path":"/ngrx/record/v1/levels/12126/data-driven-events","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12126","method":"GET","path":"/ngrx/record/v1/levels/12126","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12126_advanced_workflow_configura","method":"GET","path":"/ngrx/record/v1/levels/12126/advanced-workflow-configuration","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v2_levels_12126_default_layout","method":"GET","path":"/ngrx/record/v2/levels/12126/default-layout","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12126_image_fields","method":"GET","path":"/ngrx/record/v1/levels/12126/image-fields","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_modules_task_access_moduleIds_10162","method":"GET","path":"/ngrx/record/v1/modules/task-access?moduleIds=10162","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _ngrx_record_v1_contents","method":"POST","path":"/ngrx/record/v1/contents","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":"{\n  \"levelId\": 12126,\n  \"contentFields\": [\n    {\n      \"fieldId\": 60795,\n      \"value\": \"Nitesh Kishore Kashi\",\n      \"type\": \"Text\"\n    },\n    {\n      \"fieldId\": 60796,\n      \"value\": 35,\n      \"type\": \"Numeric\"\n    }\n  ],\n  \"version\": 0\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500,"producesVars":[{"token":"id1","jsonPath":"id"}]},{"name":"GET _ngrx_record_v1_levels_12126_advanced_workflow_configura","method":"GET","path":"/ngrx/record/v1/levels/12126/advanced-workflow-configuration","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v2_contents_786450_summary","method":"GET","path":"/ngrx/record/v2/contents/__CORR_id1_786450__/summary","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_levels_12126","method":"GET","path":"/ngrx/record/v1/levels/12126","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_contents_786450","method":"GET","path":"/ngrx/record/v1/contents/__CORR_id1_786450__","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _ngrx_record_v1_levels_12126_contents_786450_history","method":"POST","path":"/ngrx/record/v1/levels/12126/contents/__CORR_id1_786450__/history","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_contents_786450_data_driven_events","method":"GET","path":"/ngrx/record/v1/contents/__CORR_id1_786450__/data-driven-events","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_record_v1_contents_786450_layout","method":"GET","path":"/ngrx/record/v1/contents/__CORR_id1_786450__/layout","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"PUT _ngrx_record_v1_contents_786450_acquire_lock","method":"PUT","path":"/ngrx/record/v1/contents/__CORR_id1_786450__/acquire-lock","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"DELETE _ngrx_record_v1_contents_786450","method":"DELETE","path":"/ngrx/record/v1/contents/__CORR_id1_786450__","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"PATCH _ngrx_record_v1_contents_786450_release_lock","method":"PATCH","path":"/ngrx/record/v1/contents/__CORR_id1_786450__/release-lock","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_metadata_ModuleMetadata_moduleIds_10162","method":"GET","path":"/ngrx/metadata/ModuleMetadata?moduleIds=10162","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_search_reportCriteria_default_moduleId_10162","method":"GET","path":"/ngrx/search/reportCriteria/default?moduleId=10162","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"GET _ngrx_search_results_viewType_NavMenu_pageNum_0_pageSize","method":"GET","path":"/ngrx/search/results?viewType=NavMenu&pageNum=0&pageSize=0&solutionId=222&workspaceId=210&moduleId=10162&performFacetedSearch=false","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":null,"payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _ngrx_search_results","method":"POST","path":"/ngrx/search/results","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":"{\n  \"reportPayload\": {\n    \"reportDetail\": {\n      \"guid\": \"04b3feea-3b7f-46c7-99d1-df6310404e26\",\n      \"type\": \"SearchBased\",\n      \"description\": \"\",\n      \"name\": \"\",\n      \"pageId\": 9248,\n      \"asoStatus\": \"Normal\",\n      \"languageId\": 1,\n      \"isSystem\": false,\n      \"reportType\": \"Global\",\n      \"updateInformation\": {},\n      \"authorization\": {\n        \"users\": [],\n        \"groups\": []\n      }\n    },\n    \"reportCriteria\": {\n      \"reportType\": \"Table\",\n      \"criteria\": {\n        \"searchFilter\": null,\n        \"moduleCriteria\": {\n          \"id\": 0,\n          \"moduleId\": 10162,\n          \"levelIds\": [\n            12126\n          ],\n          \"keywordLevelIds\": [],\n          \"sortFields\": [\n            {\n              \"fieldId\": 60463,\n              \"sortType\": \"Ascending\"\n            }\n          ],\n          \"isKeywordModule\": true,\n          \"buildoutRelationship\": \"Union\",\n          \"leveledBuildoutOptions\": null,\n          \"children\": []\n        },\n        \"keywords\": \"\",\n        \"contentIdLayerMapItems\": [],\n        \"searchDirection\": \"Both\"\n      },\n      \"showDateHeading\": false,\n      \"reportId\": 0,\n      \"maxRecordCount\": 0,\n      \"isResultLimitPercent\": false,\n      \"pageSize\": 50,\n      \"showCriteriaHeading\": false,\n      \"fixColumnHeaders\": false,\n      \"refreshRate\": null,\n      \"isHiddenFromMasterReportList\": false,\n      \"isHiddenFromIViews\": false,\n      \"isCachingEnabled\": false,\n      \"cacheDuration\": null,\n      \"calendarOptions\": null,\n      \"networkOptions\": null,\n      \"containedDisplayFields\": {},\n      \"displayFields\": [\n        60463\n      ],\n      \"displayFieldWidths\": [],\n      \"expandDetailViews\": false,\n      \"formatType\": \"Column\",\n      \"groupingFieldIds\": [],\n      \"mapOptions\": null,\n      \"mapboxOptions\": null,\n      \"calendarDisplayFormat\": 1,\n      \"isEditable\": true,\n      \"hierarchiesForField\": {},\n      \"isTrendingEnabled\": false\n    }\n  },\n  \"pageNum\": 0,\n  \"pageSize\": 50,\n  \"performFacetedSearch\": false\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _ngrx_search_results_0_facets","method":"POST","path":"/ngrx/search/results/0/facets","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":"{\n  \"reportPayload\": {\n    \"reportDetail\": {\n      \"guid\": \"04b3feea-3b7f-46c7-99d1-df6310404e26\",\n      \"type\": \"SearchBased\",\n      \"description\": \"\",\n      \"name\": \"\",\n      \"pageId\": 9248,\n      \"asoStatus\": \"Normal\",\n      \"languageId\": 1,\n      \"isSystem\": false,\n      \"reportType\": \"Global\",\n      \"updateInformation\": {},\n      \"authorization\": {\n        \"users\": [],\n        \"groups\": []\n      }\n    },\n    \"reportCriteria\": {\n      \"reportType\": \"Table\",\n      \"criteria\": {\n        \"searchFilter\": null,\n        \"moduleCriteria\": {\n          \"id\": 0,\n          \"moduleId\": 10162,\n          \"levelIds\": [\n            12126\n          ],\n          \"keywordLevelIds\": [],\n          \"sortFields\": [\n            {\n              \"fieldId\": 60463,\n              \"sortType\": \"Ascending\"\n            }\n          ],\n          \"isKeywordModule\": true,\n          \"buildoutRelationship\": \"Union\",\n          \"leveledBuildoutOptions\": null,\n          \"children\": []\n        },\n        \"keywords\": \"\",\n        \"contentIdLayerMapItems\": [],\n        \"searchDirection\": \"Both\"\n      },\n      \"showDateHeading\": false,\n      \"reportId\": 0,\n      \"maxRecordCount\": 0,\n      \"isResultLimitPercent\": false,\n      \"pageSize\": 50,\n      \"showCriteriaHeading\": false,\n      \"fixColumnHeaders\": false,\n      \"refreshRate\": null,\n      \"isHiddenFromMasterReportList\": false,\n      \"isHiddenFromIViews\": false,\n      \"isCachingEnabled\": false,\n      \"cacheDuration\": null,\n      \"calendarOptions\": null,\n      \"networkOptions\": null,\n      \"containedDisplayFields\": {},\n      \"displayFields\": [\n        60463\n      ],\n      \"displayFieldWidths\": [],\n      \"expandDetailViews\": false,\n      \"formatType\": \"Column\",\n      \"groupingFieldIds\": [],\n      \"mapOptions\": null,\n      \"mapboxOptions\": null,\n      \"calendarDisplayFormat\": 1,\n      \"isEditable\": true,\n      \"hierarchiesForField\": {},\n      \"isTrendingEnabled\": false\n    }\n  }\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500},{"name":"POST _ngrx_search_results","method":"POST","path":"/ngrx/search/results","headers":{"Content-Type":"application/json","x-csrf-token":"xbXHtrqFDUcyPm16D7sCvFyP_io--NMcrzJFdHtKqu33e9oTs7moktpA82txRO2w_0L1yQ-OB2jo0Um8gQ1GP5rZ8sKMukI-0VOGOsZHeUY1"},"payload":"{\n  \"reportPayload\": {\n    \"reportDetail\": {\n      \"guid\": \"04b3feea-3b7f-46c7-99d1-df6310404e26\",\n      \"type\": \"SearchBased\",\n      \"description\": \"\",\n      \"name\": \"\",\n      \"pageId\": 9248,\n      \"asoStatus\": \"Normal\",\n      \"languageId\": 1,\n      \"isSystem\": false,\n      \"reportType\": \"Global\",\n      \"updateInformation\": {},\n      \"authorization\": {\n        \"users\": [],\n        \"groups\": []\n      }\n    },\n    \"reportCriteria\": {\n      \"reportType\": \"Table\",\n      \"criteria\": {\n        \"searchFilter\": null,\n        \"moduleCriteria\": {\n          \"id\": 0,\n          \"moduleId\": 10162,\n          \"levelIds\": [\n            12126\n          ],\n          \"keywordLevelIds\": [],\n          \"sortFields\": [\n            {\n              \"fieldId\": 60463,\n              \"sortType\": \"Ascending\"\n            }\n          ],\n          \"isKeywordModule\": true,\n          \"buildoutRelationship\": \"Union\",\n          \"leveledBuildoutOptions\": null,\n          \"children\": []\n        },\n        \"keywords\": \"\",\n        \"contentIdLayerMapItems\": [],\n        \"searchDirection\": \"Both\"\n      },\n      \"showDateHeading\": false,\n      \"reportId\": 0,\n      \"maxRecordCount\": 0,\n      \"isResultLimitPercent\": false,\n      \"pageSize\": 50,\n      \"showCriteriaHeading\": false,\n      \"fixColumnHeaders\": false,\n      \"refreshRate\": null,\n      \"isHiddenFromMasterReportList\": false,\n      \"isHiddenFromIViews\": false,\n      \"isCachingEnabled\": false,\n      \"cacheDuration\": null,\n      \"calendarOptions\": null,\n      \"networkOptions\": null,\n      \"containedDisplayFields\": {},\n      \"displayFields\": [\n        60463\n      ],\n      \"displayFieldWidths\": [],\n      \"expandDetailViews\": false,\n      \"formatType\": \"Column\",\n      \"groupingFieldIds\": [],\n      \"mapOptions\": null,\n      \"mapboxOptions\": null,\n      \"calendarDisplayFormat\": 1,\n      \"isEditable\": true,\n      \"hierarchiesForField\": {},\n      \"isTrendingEnabled\": false\n    }\n  },\n  \"pageNum\": 0,\n  \"pageSize\": 50,\n  \"performFacetedSearch\": false\n}","payloadType":"json","expectedStatus":200,"responseThresholdMs":500}];

const TEST_ID = __ENV.TESTID || ('local-' + Date.now());
const RUN_ID = __ENV.RUN_ID || ('PerfOps-' + Date.now());
const NODE_NAME = __ENV.NODE_NAME || 'PerfOps';
const TEST_NAME = __ENV.TEST_NAME || 'Archer Classic Session Replay';
const BASE_URL = __ENV.BASE_URL || 'https://9185004.classic-dev.internal.archerirm.net';
const INFLUX_V2_URL = __ENV.INFLUX_V2_URL || 'http://localhost:8086';
const INFLUX_V2_ORG = __ENV.INFLUX_V2_ORG || '';
const INFLUX_V2_ORG_ID = __ENV.INFLUX_V2_ORG_ID || '';
const INFLUX_V2_BUCKET = __ENV.INFLUX_V2_BUCKET || 'PerfDB';
const INFLUX_V2_TOKEN = __ENV.INFLUX_V2_TOKEN || '';
const INFLUX_V2_AUTO_CREATE_BUCKET = (__ENV.INFLUX_V2_AUTO_CREATE_BUCKET || 'false').toLowerCase() === 'true';
const INFLUX_V2_ENABLED = !!(INFLUX_V2_ORG && INFLUX_V2_BUCKET && INFLUX_V2_TOKEN);

const SCENARIO_NAME = 'archer_session_replay';

const CREDENTIALS = [{"loginUrl":"https://9185004.classic-dev.internal.archerirm.net/api/core/security/login","username":"Sohrab","password":"Password123$","instanceName":"9185004"}];
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
    archer_session_replay: {
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
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'Login' }, jar: jar },
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
  if (!/GetModuleRecordAccess/i.test(String(reqDef.path || ''))) return;
  const token = response.headers['csrf-token'] || response.headers['Csrf-Token'] || response.headers['CSRF-Token'];
  if (token) {
    __csrfToken = token;
    console.log('VU ' + __VU + ': captured fresh csrf-token from ' + reqDef.name);
  }
}

function findModuleRecordAccessRequest() {
  return CAPTURED_REQUESTS.find(function (r) { return /GetModuleRecordAccess/i.test(String(r.path || '')); }) || null;
}

function refreshCsrfToken(jar, authHeaders) {
  const reqDef = findModuleRecordAccessRequest();
  if (!reqDef) return;
  const headers = Object.assign({}, sanitizeHeaders(reqDef.headers), authHeaders);
  const res = http.request(
    reqDef.method,
    BASE_URL + reqDef.path,
    requestBody(reqDef.payload, reqDef.payloadType),
    { headers: headers, redirects: 5, tags: { name: (reqDef.name || reqDef.path) + ' (csrf-refresh)' }, jar: jar }
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

  captureCsrfToken(reqDef, res);

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

export default function (setupData) {
  sessionReplay(setupData);
}

export function handleSummary(data) {
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}