import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

// Project root is 3 levels up from backend/src/routes (and from
// backend/dist/routes after a build - same depth either way).
const DASHBOARD_FILE = path.join(__dirname, '../../../Grafana_Dashboard.json');

// Returns headers for Grafana API calls (supports optional API key)
function grafanaHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = process.env.GRAFANA_API_KEY;
  if (key) headers['Authorization'] = `Bearer ${key}`;
  return headers;
}

async function getInfluxDatasourceUid(grafanaUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${grafanaUrl}/api/datasources`, {
      headers: grafanaHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const sources = (await res.json()) as Array<{ uid: string; type: string; name: string }>;
    const influx = sources.find(s => s.type === 'influxdb');
    return influx?.uid ?? null;
  } catch {
    return null;
  }
}

function loadDashboardSpec(): any {
  const raw = fs.readFileSync(DASHBOARD_FILE, 'utf8');
  return JSON.parse(raw);
}

// The committed Grafana_Dashboard.json was exported from whoever's Grafana
// instance built it, so every panel/annotation/variable query's
// `datasource: { name: <uid> }` points at a datasource UID that only exists
// on that machine. Every fresh install provisions its own InfluxDB
// datasource with a different UID, so every one of those refs (everything
// except the built-in "grafana" datasource, used for the annotations panel)
// must be repointed at the live UID before the dashboard will render data.
function remapDatasourceRefs(spec: any, liveInfluxUid: string): any {
  const serialized = JSON.stringify(spec).replace(
    /"datasource":\{"name":"([^"]+)"\}/g,
    (match, name) => (name === 'grafana' ? match : `"datasource":{"name":"${liveInfluxUid}"}`)
  );
  return JSON.parse(serialized);
}

// The committed Grafana_Dashboard.json's Flux queries all hardcode
// `bucket: "PerfDB"` (a leftover from whoever originally exported it) —
// every generated k6 script actually writes to INFLUX_V2_BUCKET, which
// jobDispatcher sets from process.env.INFLUXDB_BUCKET. If that env var is
// set to anything other than "PerfDB" (e.g. "k6"), the dashboard queries an
// empty/wrong bucket and every panel renders with no data even though
// InfluxDB, Grafana, and the datasource are all otherwise correctly
// configured. Rewrite the literal bucket name in every query on sync so the
// dashboard always matches whatever bucket this install actually writes to,
// the same self-healing approach remapDatasourceRefs uses for datasource UIDs.
function remapBucketRefs(spec: any, bucketName: string): any {
  const serialized = JSON.stringify(spec).replace(
    /bucket: \\"PerfDB\\"/g,
    `bucket: \\"${bucketName}\\"`
  );
  return JSON.parse(serialized);
}

// Dashboards are managed as Kubernetes-style resources under
// dashboard.grafana.app/v2 (this Grafana version has no legacy
// /api/dashboards/db model compatible with the v2 panel/layout schema used
// by Grafana_Dashboard.json).
async function getDashboardResource(grafanaUrl: string, uid: string): Promise<any | null> {
  try {
    const res = await fetch(`${grafanaUrl}/apis/dashboard.grafana.app/v2/namespaces/default/dashboards/${uid}`, {
      headers: grafanaHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Dashboards created via the dashboard.grafana.app/v2 resource API don't
// automatically inherit org-wide Viewer read access the way classic
// /api/dashboards/db creation does - anonymous (Viewer org role) embedding
// gets a 403 until an explicit per-dashboard permission is granted. Re-grant
// it after every sync so this can never silently regress.
async function grantViewerAccess(grafanaUrl: string, dashboardUid: string): Promise<void> {
  try {
    await fetch(`${grafanaUrl}/api/dashboards/uid/${dashboardUid}/permissions`, {
      method: 'POST',
      headers: grafanaHeaders(),
      body: JSON.stringify({ items: [{ role: 'Viewer', permission: 1 }] }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Best-effort - sync already succeeded; embedding may just need a manual permission fix.
  }
}

// POST /api/grafana/sync-dashboard
// Pushes Grafana_Dashboard.json (the hand-built PTaaS dashboard) into
// Grafana, remapping its InfluxDB datasource references to whatever
// datasource this install actually provisioned. Idempotent: creates the
// dashboard resource if it doesn't exist yet, otherwise updates it in place
// so re-running setup/diagnostics never duplicates it.
router.post('/grafana/sync-dashboard', async (_req: Request, res: Response) => {
  const grafanaUrl = process.env.GRAFANA_URL;

  if (!grafanaUrl) {
    res.status(400).json({ error: 'GRAFANA_URL is not configured' });
    return;
  }

  let dashboardFile: any;
  try {
    dashboardFile = loadDashboardSpec();
  } catch (err: any) {
    res.status(500).json({ error: `Cannot read Grafana_Dashboard.json: ${err.message}` });
    return;
  }

  const uid = process.env.GRAFANA_DASHBOARD_UID || dashboardFile.metadata?.name;
  if (!uid) {
    res.status(400).json({ error: 'GRAFANA_DASHBOARD_UID is not configured and Grafana_Dashboard.json has no metadata.name to fall back to' });
    return;
  }

  const datasourceUid = await getInfluxDatasourceUid(grafanaUrl);
  if (!datasourceUid) {
    res.status(400).json({
      error: 'No InfluxDB datasource found in Grafana. Add one in Grafana → Connections → Data sources, then retry.',
    });
    return;
  }

  const bucketName = process.env.INFLUXDB_BUCKET || 'PerfDB';
  const spec = remapBucketRefs(remapDatasourceRefs(dashboardFile.spec, datasourceUid), bucketName);
  const existing = await getDashboardResource(grafanaUrl, uid);

  const payload: any = {
    apiVersion: 'dashboard.grafana.app/v2',
    kind: 'Dashboard',
    metadata: { name: uid, namespace: 'default' },
    spec,
  };

  let pushRes: globalThis.Response;
  try {
    if (existing) {
      payload.metadata.resourceVersion = existing.metadata.resourceVersion;
      pushRes = await fetch(`${grafanaUrl}/apis/dashboard.grafana.app/v2/namespaces/default/dashboards/${uid}`, {
        method: 'PUT',
        headers: grafanaHeaders(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
    } else {
      pushRes = await fetch(`${grafanaUrl}/apis/dashboard.grafana.app/v2/namespaces/default/dashboards`, {
        method: 'POST',
        headers: grafanaHeaders(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
    }
  } catch (err: any) {
    res.status(502).json({ error: `Cannot reach Grafana: ${err.message}` });
    return;
  }

  const body: any = await pushRes.json().catch(() => null);

  if (!pushRes.ok) {
    const hint = pushRes.status === 401 || pushRes.status === 403
      ? ' (GRAFANA_API_KEY missing/invalid? Anonymous access is Viewer-only and cannot write dashboards.)'
      : '';
    res.status(pushRes.status).json({ error: (body?.message ?? 'Grafana API error') + hint, detail: body });
    return;
  }

  const resultUid = body?.metadata?.name ?? uid;
  await grantViewerAccess(grafanaUrl, resultUid);

  res.json({
    uid: resultUid,
    grafanaUrl: `${grafanaUrl}/d/${resultUid}`,
  });
});

export default router;
