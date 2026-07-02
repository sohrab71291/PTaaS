"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
// Public — registered before requireAuth. Exposes non-sensitive config values.
router.get('/', (_req, res) => {
    res.json({
        grafanaUrl: process.env.GRAFANA_URL ?? null,
        grafanaDashboardUid: process.env.GRAFANA_DASHBOARD_UID ?? null,
        influxdbUrl: process.env.INFLUXDB_URL ?? null,
        influxdbConfigured: !!(process.env.INFLUXDB_TOKEN && process.env.INFLUXDB_ORG && process.env.INFLUXDB_BUCKET),
    });
});
// Public — tests live connectivity to InfluxDB and Grafana
router.post('/test-connections', async (_req, res) => {
    const results = {
        influxdb: { connected: false, message: 'Not configured', latencyMs: null },
        grafana: { connected: false, message: 'Not configured', latencyMs: null },
    };
    // ── InfluxDB health check ─────────────────────────────────────────────────
    const influxUrl = process.env.INFLUXDB_URL;
    const influxToken = process.env.INFLUXDB_TOKEN;
    const influxOrg = process.env.INFLUXDB_ORG;
    const influxBucket = process.env.INFLUXDB_BUCKET;
    if (influxUrl) {
        const t0 = Date.now();
        try {
            // /health works without auth; try authenticated /api/v2/buckets if token is set
            const testUrl = influxToken && influxOrg
                ? `${influxUrl}/api/v2/buckets?org=${encodeURIComponent(influxOrg)}&limit=1`
                : `${influxUrl}/health`;
            const headers = influxToken
                ? { Authorization: `Token ${influxToken}` }
                : {};
            const response = await fetch(testUrl, { headers, signal: AbortSignal.timeout(5000) });
            results.influxdb.latencyMs = Date.now() - t0;
            if (response.ok) {
                results.influxdb.connected = true;
                results.influxdb.message = influxBucket
                    ? `Connected · bucket: ${influxBucket}`
                    : 'Connected';
            }
            else {
                results.influxdb.message = `HTTP ${response.status} — check token and org`;
            }
        }
        catch (err) {
            results.influxdb.latencyMs = Date.now() - t0;
            results.influxdb.message = err.name === 'TimeoutError'
                ? 'Timed out (>5s) — is InfluxDB reachable?'
                : `Connection refused — ${err.message}`;
        }
    }
    // ── Grafana health check ──────────────────────────────────────────────────
    const grafanaUrl = process.env.GRAFANA_URL;
    if (grafanaUrl) {
        const t0 = Date.now();
        try {
            const response = await fetch(`${grafanaUrl}/api/health`, {
                signal: AbortSignal.timeout(5000),
            });
            results.grafana.latencyMs = Date.now() - t0;
            if (response.ok) {
                const body = await response.json().catch(() => ({}));
                results.grafana.connected = body.database === 'ok' || response.ok;
                results.grafana.message = body.version
                    ? `Connected · v${body.version}`
                    : 'Connected';
            }
            else {
                results.grafana.message = `HTTP ${response.status}`;
            }
        }
        catch (err) {
            results.grafana.latencyMs = Date.now() - t0;
            results.grafana.message = err.name === 'TimeoutError'
                ? 'Timed out (>5s) — is Grafana reachable?'
                : `Connection refused — ${err.message}`;
        }
    }
    res.json(results);
});
exports.default = router;
