"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryFromRequestsRaw = queryFromRequestsRaw;
exports.queryExecutionFromInflux = queryExecutionFromInflux;
exports.queryDashboardTrends = queryDashboardTrends;
exports.pushExecutionMetrics = pushExecutionMetrics;
const influxdb_client_1 = require("@influxdata/influxdb-client");
function getClient() {
    const url = process.env.INFLUXDB_URL;
    const token = process.env.INFLUXDB_TOKEN;
    if (!url || !token)
        return null;
    return new influxdb_client_1.InfluxDB({ url, token });
}
// sorted must be in ms (pre-converted by caller)
function percentile(sorted, q) {
    if (sorted.length === 0)
        return 0;
    const idx = Math.floor(sorted.length * q);
    return Math.round(sorted[Math.min(idx, sorted.length - 1)] * 10) / 10;
}
// ── queryFromRequestsRaw ─────────────────────────────────────────────────────
// Single authoritative query used by both the report and (implicitly) Grafana.
// Reads the same `requestsRaw` + `virtualUsers` measurements that the Grafana
// dashboard panels read, filtered by runId = executionId.
async function queryFromRequestsRaw(startedAt, finishedAt) {
    const org = process.env.INFLUXDB_ORG;
    const bucket = process.env.INFLUXDB_BUCKET;
    const client = getClient();
    if (!client || !org || !bucket)
        return null;
    // Reconstruct the runId the same way jobDispatcher builds it —
    // PerfOps-{startedAt ms} — so both Grafana and the report use the identical tag.
    const runId = `PerfOps-${startedAt.getTime()}`;
    const queryApi = client.getQueryApi(org);
    const start = new Date(startedAt.getTime() - 10000).toISOString();
    const stop = new Date((finishedAt ?? new Date()).getTime() + 60000).toISOString();
    // ── 1. All responseTime data points (same filter as Grafana panel-125 / panel-138) ──
    const rtFlux = `
    from(bucket: "${bucket}")
      |> range(start: ${start}, stop: ${stop})
      |> filter(fn: (r) => r._measurement == "requestsRaw")
      |> filter(fn: (r) => r._field == "responseTime")
      |> filter(fn: (r) => r["runId"] == "${runId}")
      |> filter(fn: (r) => r["requestName"] !~ /#/)
      |> keep(columns: ["_time", "_value", "requestName"])
  `;
    // ── 2. Error counts per requestName (same filter as Grafana panel-132) ──────
    const errFlux = `
    from(bucket: "${bucket}")
      |> range(start: ${start}, stop: ${stop})
      |> filter(fn: (r) => r._measurement == "requestsRaw")
      |> filter(fn: (r) => r._field == "errorCount")
      |> filter(fn: (r) => r["runId"] == "${runId}")
      |> filter(fn: (r) => r["requestName"] !~ /#/)
      |> group(columns: ["requestName"])
      |> sum()
      |> keep(columns: ["requestName", "_value"])
  `;
    // ── 3. Max active VUs (same as Grafana panel-124) ────────────────────────────
    const vuFlux = `
    from(bucket: "${bucket}")
      |> range(start: ${start}, stop: ${stop})
      |> filter(fn: (r) => r._measurement == "virtualUsers")
      |> filter(fn: (r) => r._field == "meanActiveThreads")
      |> filter(fn: (r) => r["runId"] == "${runId}")
      |> group()
      |> max()
      |> keep(columns: ["_value"])
  `;
    const rowMapper = (fields) => (values, meta) => {
        const out = {};
        for (const f of fields)
            out[f] = meta.get(values, f);
        if ('_value' in out)
            out._value = parseFloat(out._value) || 0;
        return out;
    };
    let rtRows = [];
    let errRows = [];
    let maxVUs = 0;
    try {
        [rtRows, errRows] = await Promise.all([
            queryApi.collectRows(rtFlux, (v, m) => ({ _time: m.get(v, '_time'), _value: parseFloat(m.get(v, '_value')) || 0, requestName: m.get(v, 'requestName') })),
            queryApi.collectRows(errFlux, (v, m) => ({ requestName: m.get(v, 'requestName'), _value: parseFloat(m.get(v, '_value')) || 0 })),
        ]);
        const vuRows = await queryApi.collectRows(vuFlux, (v, m) => ({ _value: parseFloat(m.get(v, '_value')) || 0 }));
        if (vuRows.length > 0)
            maxVUs = vuRows[0]._value;
    }
    catch {
        return null;
    }
    if (rtRows.length === 0)
        return null;
    // ── 4. Group by requestName ──────────────────────────────────────────────────
    const endpointRTs = new Map();
    const timeBuckets = new Map();
    const allRTs = [];
    for (const row of rtRows) {
        const ms = row._value; // requestsRaw stores ms directly
        allRTs.push(ms);
        const ep = row.requestName ?? 'unknown';
        if (!endpointRTs.has(ep))
            endpointRTs.set(ep, []);
        endpointRTs.get(ep).push(ms);
        const t = new Date(row._time).getTime();
        const bucket10s = Math.floor(t / 10000) * 10000;
        if (!timeBuckets.has(bucket10s))
            timeBuckets.set(bucket10s, []);
        timeBuckets.get(bucket10s).push(ms);
    }
    allRTs.sort((a, b) => a - b);
    // error counts per endpoint
    const errMap = new Map();
    for (const r of errRows)
        errMap.set(r.requestName, r._value);
    const totalErrors = Array.from(errMap.values()).reduce((s, v) => s + v, 0);
    // ── 5. Per-endpoint metrics (Grafana "Metrics Overview" table) ───────────────
    const endpoints = Array.from(endpointRTs.entries())
        .map(([name, vals]) => {
        vals.sort((a, b) => a - b);
        const errCnt = errMap.get(name) ?? 0;
        return {
            requestName: name,
            count: vals.length,
            avg: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10,
            p90: percentile(vals, 0.90),
            p95: percentile(vals, 0.95),
            errorRate: vals.length > 0 ? errCnt / vals.length : 0,
            errorCount: errCnt,
        };
    })
        .sort((a, b) => b.count - a.count);
    // ── 6. Time series ───────────────────────────────────────────────────────────
    const timeSeries = Array.from(timeBuckets.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([ts, vals]) => {
        vals.sort((a, b) => a - b);
        return {
            time: new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            p50: percentile(vals, 0.50),
            p95: percentile(vals, 0.95),
        };
    });
    const requestCount = allRTs.length;
    const errorRate = requestCount > 0 ? totalErrors / requestCount : 0;
    // ── Duration: last data point time minus first data point time ──────────────
    // Matches Grafana panel-143: last(virtualUsers._time) - first(virtualUsers._time).
    // We use requestsRaw timestamps here (same span, no extra query needed).
    const rtTimes = rtRows.map(r => new Date(r._time).getTime());
    const dataStartMs = Math.min(...rtTimes);
    const dataEndMs = Math.max(...rtTimes);
    const dataDurationMs = dataEndMs - dataStartMs;
    const dataDurationSecs = Math.max(dataDurationMs / 1000, 1);
    // ── Avg RT and RPS: both use 30-second aggregation windows ─────────────────
    // Matches Grafana panel-141 (Avg RT) and panel-17 (Overall Throughput):
    //   aggregateWindow(every: 30s, fn: mean|count, createEmpty: false) → calcs: ["mean"]
    // Using simple total/span gives higher RPS because the final partial window
    // still has the full 30s as its denominator in Grafana, pulling the mean down.
    const win30rt = new Map(); // key → [responseTime ms]
    const win30cnt = new Map(); // key → count
    for (let i = 0; i < rtRows.length; i++) {
        const key = Math.floor(rtTimes[i] / 30000) * 30000;
        if (!win30rt.has(key))
            win30rt.set(key, []);
        win30rt.get(key).push(rtRows[i]._value);
        win30cnt.set(key, (win30cnt.get(key) ?? 0) + 1);
    }
    const windowMeans = Array.from(win30rt.values()).map(vals => vals.reduce((s, v) => s + v, 0) / vals.length);
    const avgResponseTime = windowMeans.length > 0
        ? Math.round((windowMeans.reduce((s, v) => s + v, 0) / windowMeans.length) * 10) / 10
        : 0;
    // RPS = mean(count_per_30s_window / 30)  — same formula as panel-17
    const windowRates = Array.from(win30cnt.values()).map(cnt => cnt / 30);
    const rps = windowRates.length > 0
        ? Math.round((windowRates.reduce((s, v) => s + v, 0) / windowRates.length) * 10) / 10
        : 0;
    return {
        requestCount,
        errorsCount: totalErrors,
        successRate: 1 - errorRate,
        errorRate,
        avgResponseTime,
        rps,
        duration: dataDurationMs,
        p50: percentile(allRTs, 0.50),
        p90: percentile(allRTs, 0.90),
        p95: percentile(allRTs, 0.95),
        p99: percentile(allRTs, 0.99),
        maxVUs,
        endpoints,
        timeSeries,
    };
}
async function queryExecutionFromInflux(startedAt, finishedAt) {
    const org = process.env.INFLUXDB_ORG;
    const bucket = process.env.INFLUXDB_BUCKET;
    const client = getClient();
    if (!client || !org || !bucket)
        return null;
    const queryApi = client.getQueryApi(org);
    const start = new Date(startedAt.getTime() - 10000).toISOString();
    const stop = new Date((finishedAt ?? new Date()).getTime() + 60000).toISOString();
    // ── 1. Read from k6_execution summary (written by pushExecutionMetrics at job_complete) ──
    // This is the authoritative source: it contains the full-run metrics computed by the
    // agent from the built-in http_req_duration JSON stream (all requests, not a subset).
    const summaryFlux = `
    from(bucket: "${bucket}")
      |> range(start: ${start}, stop: ${stop})
      |> filter(fn: (r) => r._measurement == "k6_execution")
      |> filter(fn: (r) =>
          r._field == "p50" or r._field == "p90" or r._field == "p95" or r._field == "p99" or
          r._field == "avg" or r._field == "rps" or r._field == "error_rate" or
          r._field == "max_vus" or r._field == "total_requests")
      |> last()
      |> keep(columns: ["_field", "_value"])
  `;
    let summaryMap = {};
    try {
        const rows = await queryApi.collectRows(summaryFlux, (values, meta) => ({
            _field: meta.get(values, '_field'),
            _value: parseFloat(meta.get(values, '_value')) || 0,
        }));
        for (const r of rows)
            summaryMap[r._field] = r._value;
    }
    catch { /* fall through to raw reconstruction */ }
    // ── 2. Time series from requestsRaw (for chart) ──────────────────────────────
    // requestsRaw is written by the agent for non-boilerplate scripts.
    // For scripts with INFLUX_V2_ENABLED boilerplate the agent doesn't write requestsRaw,
    // so we fall back to k6_http_req_duration_seconds (custom script subset) for the chart.
    const rawDurFlux = `
    from(bucket: "${bucket}")
      |> range(start: ${start}, stop: ${stop})
      |> filter(fn: (r) => r._measurement == "requestsRaw" or r._measurement == "k6_http_req_duration_seconds")
      |> keep(columns: ["_time", "_value", "_measurement"])
  `;
    let timeRows = [];
    let rawDurations = [];
    try {
        timeRows = await queryApi.collectRows(rawDurFlux, (values, meta) => ({
            _time: meta.get(values, '_time'),
            _value: parseFloat(meta.get(values, '_value')) || 0,
            _measurement: meta.get(values, '_measurement'),
        }));
        rawDurations = timeRows.map(r => r._value).filter(v => v > 0);
    }
    catch { /* chart optional */ }
    // ── 3. Build metrics ─────────────────────────────────────────────────────────
    // Prefer the k6_execution summary; only reconstruct from raw if the summary is absent.
    let metrics;
    if (summaryMap.p95 != null && summaryMap.p95 > 0) {
        metrics = {
            p50: summaryMap.p50 ?? 0,
            p90: summaryMap.p90 ?? 0,
            p95: summaryMap.p95 ?? 0,
            p99: summaryMap.p99 ?? 0,
            avg: summaryMap.avg ?? 0,
            rps: summaryMap.rps ?? 0,
            errorRate: summaryMap.error_rate ?? 0,
            maxVUs: summaryMap.max_vus ?? 0,
            totalRequests: summaryMap.total_requests ?? 0,
        };
    }
    else {
        // Fallback: reconstruct from raw durations.
        // Note: k6_http_req_duration_seconds values are in SECONDS — convert to ms.
        const durations = rawDurations
            .map(v => {
            // requestsRaw stores ms; k6_http_req_duration_seconds stores seconds
            // Heuristic: values < 30 are likely seconds (k6 custom script metric)
            return v < 30 ? v * 1000 : v;
        })
            .filter(v => v > 0)
            .sort((a, b) => a - b);
        if (durations.length === 0)
            return null;
        const durationSecs = Math.max(((finishedAt ?? new Date()).getTime() - startedAt.getTime()) / 1000, 1);
        const total = durations.length;
        const rps = Math.round((total / durationSecs) * 10) / 10;
        metrics = {
            p50: percentile(durations, 0.50),
            p90: percentile(durations, 0.90),
            p95: percentile(durations, 0.95),
            p99: percentile(durations, 0.99),
            avg: Math.round((durations.reduce((s, v) => s + v, 0) / durations.length) * 10) / 10,
            rps,
            errorRate: 0,
            maxVUs: 0,
            totalRequests: total,
        };
    }
    // ── 4. Time series: bucket by 10-second windows ──────────────────────────────
    const bucketMap = new Map();
    for (const row of timeRows) {
        const rawVal = row._value;
        if (rawVal <= 0)
            continue;
        // Convert seconds → ms for k6_http_req_duration_seconds; requestsRaw is already ms
        const ms = rawVal < 30 ? rawVal * 1000 : rawVal;
        const t = new Date(row._time).getTime();
        const bucket10s = Math.floor(t / 10000) * 10000;
        if (!bucketMap.has(bucket10s))
            bucketMap.set(bucket10s, []);
        bucketMap.get(bucket10s).push(ms);
    }
    const timeSeries = Array.from(bucketMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([ts, vals]) => {
        vals.sort((a, b) => a - b);
        return {
            time: new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            p50: percentile(vals, 0.50),
            p95: percentile(vals, 0.95),
        };
    });
    return { metrics, timeSeries };
}
async function queryDashboardTrends() {
    const org = process.env.INFLUXDB_ORG;
    const bucket = process.env.INFLUXDB_BUCKET;
    const client = getClient();
    if (!client || !org || !bucket)
        return null;
    const queryApi = client.getQueryApi(org);
    const flux = `
    import "date"
    import "strings"

    from(bucket: "${bucket}")
      |> range(start: -7d)
      |> filter(fn: (r) => r._measurement == "k6_execution")
      |> filter(fn: (r) =>
          r._field == "p95" or r._field == "p50" or r._field == "rps" or
          r._field == "error_rate" or r._field == "threshold_breaches")
      |> aggregateWindow(every: 1d, fn: mean, createEmpty: false)
      |> map(fn: (r) => ({ r with day: strings.substring(v: string(v: r._time), start: 0, end: 10) }))
      |> keep(columns: ["day", "_field", "_value"])
  `;
    let rows;
    try {
        rows = await queryApi.collectRows(flux, (values, meta) => ({
            day: meta.get(values, 'day'),
            _field: meta.get(values, '_field'),
            _value: parseFloat(meta.get(values, '_value')) || 0,
        }));
    }
    catch {
        return null;
    }
    const map = new Map();
    for (const r of rows) {
        const entry = map.get(r.day) ?? { day: r.day };
        if (r._field === 'p95')
            entry.p95 = r._value;
        else if (r._field === 'p50')
            entry.p50 = r._value;
        else if (r._field === 'rps')
            entry.rps = r._value;
        else if (r._field === 'error_rate')
            entry.errorRate = r._value;
        else if (r._field === 'threshold_breaches')
            entry.breaches = Math.round(r._value);
        map.set(r.day, entry);
    }
    return Array.from(map.values())
        .sort((a, b) => a.day.localeCompare(b.day))
        .map(e => ({
        day: e.day,
        p95: e.p95 ?? 0,
        p50: e.p50 ?? 0,
        rps: e.rps ?? 0,
        errorRate: e.errorRate ?? 0,
        breaches: e.breaches ?? 0,
    }));
}
function getWriteApi() {
    const url = process.env.INFLUXDB_URL;
    const token = process.env.INFLUXDB_TOKEN;
    const org = process.env.INFLUXDB_ORG;
    const bucket = process.env.INFLUXDB_BUCKET;
    if (!url || !token || !org || !bucket) {
        // Silently skip — InfluxDB is optional
        return null;
    }
    return new influxdb_client_1.InfluxDB({ url, token }).getWriteApi(org, bucket, 'ms');
}
async function pushExecutionMetrics(execution) {
    const url = process.env.INFLUXDB_URL ?? '';
    const org = process.env.INFLUXDB_ORG ?? '';
    const bucket = process.env.INFLUXDB_BUCKET ?? '';
    const writeApi = getWriteApi();
    if (!writeApi) {
        return { skipped: true, url, org, bucket, pointsWritten: 0 };
    }
    const metrics = execution.metrics ?? {};
    const thresholds = execution.thresholdResults ?? [];
    const finishedAt = execution.finishedAt ? new Date(execution.finishedAt) : new Date();
    // ── Measurement: k6_execution ────────────────────────────────────────────────
    const execPoint = new influxdb_client_1.Point('k6_execution')
        .tag('execution_id', String(execution.id ?? ''))
        .tag('spec_id', String(execution.specId ?? ''))
        .tag('spec_name', String(execution.specName ?? ''))
        .tag('environment', String(execution.environment ?? ''))
        .tag('status', String(execution.status ?? ''))
        // response times (ms)
        .floatField('p50', toFloat(metrics.p50))
        .floatField('p90', toFloat(metrics.p90))
        .floatField('p95', toFloat(metrics.p95))
        .floatField('p99', toFloat(metrics.p99))
        .floatField('avg', toFloat(metrics.avg))
        // throughput / errors
        .floatField('rps', toFloat(metrics.rps))
        .floatField('error_rate', toFloat(metrics.errorRate))
        // load
        .floatField('max_vus', toFloat(metrics.maxVUs))
        .floatField('total_requests', toFloat(metrics.totalRequests))
        // execution metadata
        .floatField('duration_seconds', toFloat(execution.duration))
        .intField('threshold_breaches', toInt(execution.thresholdBreaches))
        .intField('checks_passed', toInt(execution.checksPassed))
        .intField('checks_failed', toInt(execution.checksFailed))
        .timestamp(finishedAt);
    writeApi.writePoint(execPoint);
    let pointsWritten = 1;
    // ── Measurement: k6_thresholds (one point per threshold result) ───────────────
    if (Array.isArray(thresholds)) {
        for (const t of thresholds) {
            const pt = new influxdb_client_1.Point('k6_thresholds')
                .tag('execution_id', String(execution.id ?? ''))
                .tag('spec_name', String(execution.specName ?? ''))
                .tag('metric', String(t.metric ?? ''))
                .tag('passed', String(t.passed ?? false))
                .stringField('condition', String(t.condition ?? ''))
                .stringField('actual', String(t.actual ?? ''))
                .timestamp(finishedAt);
            writeApi.writePoint(pt);
            pointsWritten++;
        }
    }
    try {
        await writeApi.close();
        console.log(`[InfluxDB] Pushed ${pointsWritten} points for execution ${execution.id}`);
        return { skipped: false, url, org, bucket, pointsWritten };
    }
    catch (err) {
        console.error(`[InfluxDB] Failed to push metrics: ${err.message}`);
        return { skipped: false, url, org, bucket, pointsWritten: 0, error: err.message };
    }
}
function toFloat(v) { return parseFloat(v) || 0; }
function toInt(v) { return parseInt(v) || 0; }
