const fs = require('fs');
const filePath = 'testNGRX_HAR.js';
const text = fs.readFileSync(filePath, 'utf8');
const head = text.slice(0, 400);
console.log('===== HEAD =====');
console.log(head);
console.log('===== INDEX OF LOGIN_CREDENTIALS =====');
console.log(text.indexOf('const LOGIN_CREDENTIALS'));
console.log('===== INDEX OF const CAPTURED_REQUESTS =====');
console.log(text.indexOf('const CAPTURED_REQUESTS'));
const loginStart = text.indexOf('const LOGIN_CREDENTIALS');
const capStart = text.indexOf('const CAPTURED_REQUESTS');
if (loginStart >= 0 && capStart > loginStart) {
  console.log('===== BETWEEN LOGIN_CREDENTIALS AND CAPTURED_REQUESTS =====');
  console.log(text.slice(loginStart, Math.min(text.length, loginStart + 350)));
}
if (capStart >= 0) {
  console.log('===== CAPTURED_REQUESTS START =====');
  console.log(text.slice(capStart, capStart + 350));
}
