#!/usr/bin/env node
// Frees a TCP port before the dev server binds to it — run automatically via
// the "predev" npm lifecycle hook so a leftover/zombie backend process from a
// previous run (crashed nodemon child, killed terminal, etc.) never causes
// EADDRINUSE or leaves a stale process silently answering requests instead
// of the one you just started.
const { execSync } = require('child_process');

const port = process.argv[2] || '3001';

function run(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return ''; }
}

function killWindows(port) {
  const out = run(`netstat -ano -p tcp`);
  const lineRe = new RegExp(`^\\s*TCP\\s+\\S*[:.]${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, 'i');
  const pids = new Set();
  for (const line of out.split('\n')) {
    const m = line.match(lineRe);
    if (m) pids.add(m[1]);
  }
  for (const pid of pids) {
    console.log(`[kill-port] Freeing port ${port} — stopping PID ${pid}`);
    run(`taskkill /F /PID ${pid}`);
  }
}

function killUnix(port) {
  const out = run(`lsof -ti tcp:${port}`).trim();
  if (!out) return;
  for (const pid of out.split('\n').filter(Boolean)) {
    console.log(`[kill-port] Freeing port ${port} — stopping PID ${pid}`);
    run(`kill -9 ${pid}`);
  }
}

if (process.platform === 'win32') killWindows(port);
else killUnix(port);
