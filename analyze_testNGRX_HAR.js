const fs = require('fs');
const path = 'testNGRX_HAR.js';
const text = fs.readFileSync(path, 'utf8');
const markers = [
  'const LOGIN_CREDENTIALS =',
  'const CAPTURED_REQUESTS =',
  'export default function',
  'export function handleSummary',
  'function buildLoginClientState',
  'function buildLoginRequestPayload',
];
for (const m of markers) {
  const idx = text.indexOf(m);
  console.log('MARKER', m, 'idx', idx);
}
const start = text.indexOf('const LOGIN_CREDENTIALS =');
if (start >= 0) {
  console.log('=== LOGIN_CREDENTIALS SNIPPET ===');
  console.log(text.slice(start, Math.min(text.length, start + 400)));
}
const cstart = text.indexOf('const CAPTURED_REQUESTS =');
if (cstart >= 0) {
  console.log('=== CAPTURED_REQUESTS SNIPPET ===');
  console.log(text.slice(cstart, Math.min(text.length, cstart + 400)));
}
const after = text.indexOf('function buildLoginClientState');
if (after >= 0) {
  console.log('=== BUILD FUNCTIONS SNIPPET ===');
  console.log(text.slice(after, Math.min(text.length, after + 400)));
}
const dup = text.indexOf('const CAPTURED_REQUESTS =', cstart + 1);
console.log('duplicate CAPTURED_REQUESTS idx', dup);
const dup2 = text.indexOf('function buildLoginClientState', after + 1);
console.log('duplicate buildLoginClientState idx', dup2);
