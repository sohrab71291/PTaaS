import { spawnSync } from 'child_process';
import { spawn } from 'child_process';
import * as fs from 'fs';

const HEAL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

// Resolved install paths (Chocolatey on Windows)
const INFLUX_EXE   = 'C:\\influxdata\\influxdb2-2.1.1-windows-amd64\\influxd.exe';
const GRAFANA_DIR  = 'C:\\ProgramData\\chocolatey\\lib\\grafana\\tools\\grafana-13.0.2';
const GRAFANA_EXE  = `${GRAFANA_DIR}\\bin\\grafana.exe`;
const GRAFANA_CFG  = `${GRAFANA_DIR}\\conf\\custom.ini`;

async function pollUntilHealthy(
  checkFn: () => Promise<boolean>,
  timeoutMs = HEAL_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkFn()) return true;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

function tryStartWindowsService(name: string): boolean {
  try {
    const r = spawnSync('sc', ['start', name], { timeout: 10_000 });
    return r.status === 0 || r.status === 1056; // 1056 = already running
  } catch {
    return false;
  }
}

function spawnDetached(exe: string, args: string[], cwd?: string): boolean {
  try {
    const child = spawn(exe, args, {
      detached: true,
      stdio:    'ignore',
      cwd:      cwd ?? undefined,
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

// ── InfluxDB self-heal ───────────────────────────────────────────────────────
export async function healInfluxDB(): Promise<boolean> {
  const url   = process.env.INFLUXDB_URL;
  const token = process.env.INFLUXDB_TOKEN;
  const org   = process.env.INFLUXDB_ORG;
  if (!url) return false;

  const healthUrl = token && org
    ? `${url}/api/v2/buckets?org=${encodeURIComponent(org)}&limit=1`
    : `${url}/health`;
  const headers: Record<string, string> = token ? { Authorization: `Token ${token}` } : {};

  const checkFn = async () => {
    try {
      const r = await fetch(healthUrl, { headers, signal: AbortSignal.timeout(3_000) });
      return r.ok;
    } catch { return false; }
  };

  if (await checkFn()) return true;

  console.log('[SelfHeal] InfluxDB unreachable — attempting to start...');

  // 1. Try Windows service first
  const svcStarted = tryStartWindowsService('influxdb2') || tryStartWindowsService('influxdb');

  // 2. Fall back to direct exe launch
  if (!svcStarted && fs.existsSync(INFLUX_EXE)) {
    spawnDetached(INFLUX_EXE, []);
  } else if (!svcStarted) {
    console.warn('[SelfHeal] InfluxDB binary not found — check installation');
    return false;
  }

  console.log('[SelfHeal] InfluxDB start issued — waiting for health...');
  const healthy = await pollUntilHealthy(checkFn);
  console.log(healthy
    ? '[SelfHeal] ✓ InfluxDB is now healthy'
    : '[SelfHeal] ✗ InfluxDB did not become healthy within timeout');
  return healthy;
}

// ── Grafana self-heal ────────────────────────────────────────────────────────
export async function healGrafana(): Promise<boolean> {
  const url = process.env.GRAFANA_URL;
  if (!url) return false;

  const checkFn = async () => {
    try {
      const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3_000) });
      if (!r.ok) return false;
      const body = await r.json().catch(() => ({})) as any;
      return body.database === 'ok' || r.ok;
    } catch { return false; }
  };

  if (await checkFn()) return true;

  console.log('[SelfHeal] Grafana unreachable — attempting to start...');

  const svcStarted = tryStartWindowsService('Grafana') || tryStartWindowsService('grafana');

  if (!svcStarted && fs.existsSync(GRAFANA_EXE)) {
    const cfgArg = fs.existsSync(GRAFANA_CFG) ? `--config=${GRAFANA_CFG}` : '';
    const args = ['server', `--homepath=${GRAFANA_DIR}`, ...(cfgArg ? [cfgArg] : [])];
    spawnDetached(GRAFANA_EXE, args, GRAFANA_DIR);
  } else if (!svcStarted) {
    console.warn('[SelfHeal] Grafana binary not found — check installation');
    return false;
  }

  console.log('[SelfHeal] Grafana start issued — waiting for health...');
  const healthy = await pollUntilHealthy(checkFn);
  console.log(healthy
    ? '[SelfHeal] ✓ Grafana is now healthy'
    : '[SelfHeal] ✗ Grafana did not become healthy within timeout');
  return healthy;
}

// ── Entry point called at server startup ─────────────────────────────────────
export async function selfHealConnections(): Promise<void> {
  const [influxOk, grafanaOk] = await Promise.all([
    healInfluxDB(),
    healGrafana(),
  ]);
  if (!influxOk) console.warn('[SelfHeal] InfluxDB unavailable — metrics push will be skipped until it recovers');
  if (!grafanaOk) console.warn('[SelfHeal] Grafana unavailable — dashboard embedding will be unavailable');
}
