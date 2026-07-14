const fs = require('fs');
const filePath = 'testNGRX_HAR.js';
let text = fs.readFileSync(filePath, 'utf8');
const loginRequestMarker = '"name":"POST _default_aspx"';
const loginStart = text.indexOf(loginRequestMarker);
if (loginStart < 0) {
  throw new Error('Login request marker not found');
}
const nextRequestMarker = '"name":"GET _apps_ArcherApp_Home_aspx"';
const nextStart = text.indexOf(nextRequestMarker, loginStart);
if (nextStart < 0) {
  throw new Error('Next request marker not found after login request');
}
const loginSegment = text.slice(loginStart, nextStart);
const sanitizedLoginSegment = loginSegment
  .replace(/"loginCsrfToken":\s*"[^"]*"/, '"loginCsrfToken": ""')
  .replace(/"txtUserName":\s*"[^"]*"/, '"txtUserName": ""')
  .replace(/"txtUserName_ClientState":\s*"[^"]*"/, '"txtUserName_ClientState": ""')
  .replace(/"txtpassword":\s*"[^"]*"/, '"txtpassword": ""')
  .replace(/"txtpassword_ClientState":\s*"[^"]*"/, '"txtpassword_ClientState": ""');
text = text.slice(0, loginStart) + sanitizedLoginSegment + text.slice(nextStart);

const loginRequestConst = `const LOGIN_REQUEST = null;

const LOGIN_CREDENTIALS = {
  loginCsrfToken: __ENV.LOGIN_CSRF_TOKEN || '',
  username: __ENV.LOGIN_USERNAME || 'PerfUser1',
  password: __ENV.LOGIN_PASSWORD || 'Password123$',
};

function buildLoginClientState(value) {
  return JSON.stringify({
    enabled: true,
    emptyMessage: '',
    validationText: value || '',
    valueAsString: value || '',
    lastSetTextBoxValue: value || '',
  });
}

function buildLoginRequestPayload(reqDef) {
  let payload = requestBody(reqDef.payload, reqDef.payloadType);
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      return payload;
    }
  }
  if (!payload || typeof payload !== 'object') return payload;
  const loginPayload = Object.assign({}, payload);
  if (LOGIN_CREDENTIALS.loginCsrfToken) {
    loginPayload.loginCsrfToken = LOGIN_CREDENTIALS.loginCsrfToken;
  }
  if (LOGIN_CREDENTIALS.username) {
    loginPayload.txtUserName = LOGIN_CREDENTIALS.username;
    loginPayload.txtUserName_ClientState = buildLoginClientState(LOGIN_CREDENTIALS.username);
  }
  if (LOGIN_CREDENTIALS.password) {
    loginPayload.txtpassword = LOGIN_CREDENTIALS.password;
    loginPayload.txtpassword_ClientState = buildLoginClientState(LOGIN_CREDENTIALS.password);
  }
  return loginPayload;
}

`;
text = text.replace('const LOGIN_REQUEST = null;', loginRequestConst.trim());

text = text.replace(
  '    requestBody(effectiveLoginRequest.payload, effectiveLoginRequest.payloadType),',
  '    buildLoginRequestPayload(effectiveLoginRequest),'
);

fs.writeFileSync(filePath, text, 'utf8');
console.log('Updated', filePath);
