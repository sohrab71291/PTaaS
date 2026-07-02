import { InfluxDB, Point, WriteApi } from '@influxdata/influxdb-client';

function getClient(): InfluxDB | null {
  const url   = process.env.INFLUXDB_URL;
  const token = process.env.INFLUXDB_TOKEN;
  if (!url || !token) return null;
  return new InfluxDB({ url, token });
}

export interface ExecutionInfluxMetrics {
  p50: number; p90: number; p95: number; p99: number; avg: number;
  rps: number; errorRate: number; maxVUs: number; totalRequests: number;
}

export interface ExecutionTimeSeries {
  time: string; p50: number; p95: number;
}

// ── requestsRaw-based types (same source as Grafana) ──────────────────────────

export interface EndpointMetric {
  requestName: string;
  count: number;
  avg: number;      // ms
  p90: number;      // ms
  p95: number;      // ms
  errorRate: number; // decimal 0–1 (matches Grafana)
  errorCount: number;
}

export interface RequestsRawReport {
  requestCount: number;
  errorsCount: number;
  successRate: number;    // decimal 0–1 (Grafana "Success Rate")
  errorRate: number;      // decimal 0–1 (Grafana "Error Rate")
  avgResponseTime: number; // ms  (Grafana "Avg Response Time")
  rps: number;             // ops/s (Grafana "Overall Throughput")
  duration: number;        // ms  (Grafana "Duration" — last-first virtualUsers timestamp)
  p50: number;             // ms
  p90: number;             // ms
  p95: number;             // ms
  p99: number;             // ms
  maxVUs: number;          // (Grafana "Active Users")
  endpoints: EndpointMetric[];
  timeSeries: ExecutionTimeSeries[];
}

// sorted must be in ms (pre-converted by caller)
function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * q);
  return Math.round(sorted[Math.min(idx, sorted.length - 1)] * 10) / 10;
}

// ── queryFromRequestsRaw ─────────────────────────────────────────────────────
// Single authoritative query used by both the report and (implicitly) Grafana.
// Reads the same `requestsRaw` + `virtualUsers` measurements that the Grafana
// dashboard panels read, filtered by runId = executionId.
export async function queryFromRequestsRaw(
  startedAt: Date,
  finishedAt: Date | null,
): Promise<RequestsRawReport | null> {
  const org    = process.env.INFLUXDB_ORG;
  const bucket = process.env.INFLUXDB_BUCKET;
  const client = getClient();
  if (!client || !org || !bucket) return null;

  // Reconstruct the runId the same way jobDispatcher builds it —
  // PerfOps-{startedAt ms} — so both Grafana and the report use the identical tag.
  const runId = `PerfOps-${startedAt.getTime()}`;

  const queryApi = client.getQueryApi(org);
  const start = new Date(startedAt.getTime() - 10_000).toISOString();
  const stop  = new Date((finishedAt ?? new Date()).getTime() + 60_000).toISOString();

  // ── 1. All responseTime data points (same filter as Grafana panel-125 / panel-138) ──
  // Keep "result" in the output (not filtered here) — request counts and per-endpoint
  // Count must include failures, matching Grafana's "Request Count" / "Metrics Overview"
  // Count column. Percentile/avg/RPS calcs below filter to result=="pass" in JS, matching
  // the dashboard's "Avg Response time" / "Metrics Overview" percentile panels, which do
  // filter result == "pass" — so latency stats stay in sync even when a run has failures.
  // NOTE: rename the "result" tag to "reqResult" — Flux's CSV output already has a
  // reserved annotation column literally named "result" (the query result-set name,
  // always "_result"), so keeping our own "result" tag verbatim collides with it and
  // the client library reads the wrong column. Renaming avoids the collision.
  const rtFlux = `
    from(bucket: "${bucket}")
      |> range(start: ${start}, stop: ${stop})
      |> filter(fn: (r) => r._measurement == "requestsRaw")
      |> filter(fn: (r) => r._field == "responseTime")
      |> filter(fn: (r) => r["runId"] == "${runId}")
      |> filter(fn: (r) => r["requestName"] !~ /#/)
      |> rename(columns: {"result": "reqResult"})
      |> keep(columns: ["_time", "_value", "requestName", "reqResult"])
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

  type RtRow  = { _time: string; _value: number; requestName: string; reqResult: string };
  type ErrRow = { requestName: string; _value: number };
  type VuRow  = { _value: number };

  const rowMapper = (fields: string[]) => (values: string[], meta: any) => {
    const out: any = {};
    for (const f of fields) out[f] = meta.get(values, f);
    if ('_value' in out) out._value = parseFloat(out._value) || 0;
    return out;
  };

  let rtRows: RtRow[] = [];
  let errRows: ErrRow[] = [];
  let maxVUs = 0;

  try {
    [rtRows, errRows] = await Promise.all([
      queryApi.collectRows<RtRow>(rtFlux,
        (v, m) => ({ _time: m.get(v,'_time') as string, _value: parseFloat(m.get(v,'_value') as string)||0, requestName: m.get(v,'requestName') as string, reqResult: m.get(v,'reqResult') as string })),
      queryApi.collectRows<ErrRow>(errFlux,
        (v, m) => ({ requestName: m.get(v,'requestName') as string, _value: parseFloat(m.get(v,'_value') as string)||0 })),
    ]);
    const vuRows = await queryApi.collectRows<VuRow>(vuFlux,
      (v, m) => ({ _value: parseFloat(m.get(v,'_value') as string)||0 }));
    if (vuRows.length > 0) maxVUs = vuRows[0]._value;
  } catch { return null; }

  if (rtRows.length === 0) return null;

  // Pass-only subset — Grafana's percentile/avg-latency panels ("Avg Response time",
  // "Metrics Overview" 90%/95%/Avg columns) filter result == "pass", excluding failed
  // requests from latency stats. Counts (Request Count, per-endpoint Count column,
  // Overall Throughput/RPS) do NOT filter by result, so those stay on the full rtRows set.
  const passRows = rtRows.filter(r => r.reqResult === 'pass');

  // ── 4. Group by requestName ──────────────────────────────────────────────────
  const endpointCounts = new Map<string, number>();      // all rows, per endpoint (Count column)
  const endpointPassRTs = new Map<string, number[]>();   // pass-only rows, per endpoint (latency)
  const timeBuckets = new Map<number, number[]>();
  const allRTs: number[] = [];     // all rows — requestCount
  const passRTs: number[] = [];    // pass-only — overall p50/p90/p95/p99

  for (const row of rtRows) {
    allRTs.push(row._value);
    const ep = row.requestName ?? 'unknown';
    endpointCounts.set(ep, (endpointCounts.get(ep) ?? 0) + 1);
  }

  for (const row of passRows) {
    const ms = row._value; // requestsRaw stores ms directly
    passRTs.push(ms);

    const ep = row.requestName ?? 'unknown';
    if (!endpointPassRTs.has(ep)) endpointPassRTs.set(ep, []);
    endpointPassRTs.get(ep)!.push(ms);

    const t = new Date(row._time).getTime();
    const bucket10s = Math.floor(t / 10_000) * 10_000;
    if (!timeBuckets.has(bucket10s)) timeBuckets.set(bucket10s, []);
    timeBuckets.get(bucket10s)!.push(ms);
  }

  allRTs.sort((a, b) => a - b);
  passRTs.sort((a, b) => a - b);

  // error counts per endpoint
  const errMap = new Map<string, number>();
  for (const r of errRows) errMap.set(r.requestName, r._value);
  const totalErrors = Array.from(errMap.values()).reduce((s, v) => s + v, 0);

  // ── 5. Per-endpoint metrics (Grafana "Metrics Overview" table) ───────────────
  const endpoints: EndpointMetric[] = Array.from(endpointCounts.entries())
    .map(([name, count]) => {
      const passVals = (endpointPassRTs.get(name) ?? []).slice().sort((a, b) => a - b);
      const errCnt = errMap.get(name) ?? 0;
      return {
        requestName: name,
        count,
        avg:       passVals.length > 0 ? Math.round((passVals.reduce((s, v) => s + v, 0) / passVals.length) * 10) / 10 : 0,
        p90:       percentile(passVals, 0.90),
        p95:       percentile(passVals, 0.95),
        errorRate: count > 0 ? errCnt / count : 0,
        errorCount: errCnt,
      };
    })
    .sort((a, b) => b.count - a.count);

  // ── 6. Time series ───────────────────────────────────────────────────────────
  const timeSeries: ExecutionTimeSeries[] = Array.from(timeBuckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ts, vals]) => {
      vals.sort((a, b) => a - b);
      return {
        time: new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        p50:  percentile(vals, 0.50),
        p95:  percentile(vals, 0.95),
      };
    });

  const requestCount = allRTs.length;
  const errorRate    = requestCount > 0 ? totalErrors / requestCount : 0;

  // ── Duration: last data point time minus first data point time ──────────────
  // Matches Grafana panel-143: last(virtualUsers._time) - first(virtualUsers._time).
  // We use requestsRaw timestamps here (same span, no extra query needed).
  const rtTimes = rtRows.map(r => new Date(r._time).getTime());
  const dataStartMs = Math.min(...rtTimes);
  const dataEndMs   = Math.max(...rtTimes);
  const dataDurationMs   = dataEndMs - dataStartMs;
  const dataDurationSecs = Math.max(dataDurationMs / 1000, 1);

  // ── Avg RT and RPS: both use 30-second aggregation windows ─────────────────
  // Matches Grafana panel-141 (Avg RT) and panel-17 (Overall Throughput):
  //   aggregateWindow(every: 30s, fn: mean|count, createEmpty: false) → calcs: ["mean"]
  // Using simple total/span gives higher RPS because the final partial window
  // still has the full 30s as its denominator in Grafana, pulling the mean down.
  // Avg RT windows are built from pass-only rows (Grafana's Avg Response time panel
  // filters result == "pass"); RPS windows use all rows (Overall Throughput does not).
  const win30rt  = new Map<number, number[]>(); // key → [responseTime ms], pass-only
  const win30cnt = new Map<number, number>();   // key → count, all rows
  for (const row of passRows) {
    const key = Math.floor(new Date(row._time).getTime() / 30_000) * 30_000;
    if (!win30rt.has(key)) win30rt.set(key, []);
    win30rt.get(key)!.push(row._value);
  }
  for (let i = 0; i < rtRows.length; i++) {
    const key = Math.floor(rtTimes[i] / 30_000) * 30_000;
    win30cnt.set(key, (win30cnt.get(key) ?? 0) + 1);
  }

  const windowMeans = Array.from(win30rt.values()).map(
    vals => vals.reduce((s, v) => s + v, 0) / vals.length,
  );
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
    errorsCount:  totalErrors,
    successRate:  1 - errorRate,
    errorRate,
    avgResponseTime,
    rps,
    duration: dataDurationMs,
    p50:      percentile(passRTs, 0.50),
    p90:      percentile(passRTs, 0.90),
    p95:      percentile(passRTs, 0.95),
    p99:      percentile(passRTs, 0.99),
    maxVUs,
    endpoints,
    timeSeries,
  };
}

export async function queryExecutionFromInflux(
  startedAt: Date,
  finishedAt: Date | null,
): Promise<{ metrics: ExecutionInfluxMetrics; timeSeries: ExecutionTimeSeries[] } | null> {
  const org    = process.env.INFLUXDB_ORG;
  const bucket = process.env.INFLUXDB_BUCKET;
  const client = getClient();
  if (!client || !org || !bucket) return null;

  const queryApi = client.getQueryApi(org);
  const start = new Date(startedAt.getTime() - 10_000).toISOString();
  const stop  = new Date((finishedAt ?? new Date()).getTime() + 60_000).toISOString();

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

  type SummaryRow = { _field: string; _value: number };
  let summaryMap: Record<string, number> = {};
  try {
    const rows = await queryApi.collectRows<SummaryRow>(summaryFlux, (values, meta) => ({
      _field: meta.get(values, '_field') as string,
      _value: parseFloat(meta.get(values, '_value') as string) || 0,
    }));
    for (const r of rows) summaryMap[r._field] = r._value;
  } catch { /* fall through to raw reconstruction */ }

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

  type DurRow = { _time: string; _value: number; _measurement: string };
  let timeRows: DurRow[] = [];
  let rawDurations: number[] = [];
  try {
    timeRows = await queryApi.collectRows<DurRow>(rawDurFlux, (values, meta) => ({
      _time:        meta.get(values, '_time')         as string,
      _value:       parseFloat(meta.get(values, '_value') as string) || 0,
      _measurement: meta.get(values, '_measurement')  as string,
    }));
    rawDurations = timeRows.map(r => r._value).filter(v => v > 0);
  } catch { /* chart optional */ }

  // ── 3. Build metrics ─────────────────────────────────────────────────────────
  // Prefer the k6_execution summary; only reconstruct from raw if the summary is absent.
  let metrics: ExecutionInfluxMetrics;

  if (summaryMap.p95 != null && summaryMap.p95 > 0) {
    metrics = {
      p50:           summaryMap.p50            ?? 0,
      p90:           summaryMap.p90            ?? 0,
      p95:           summaryMap.p95            ?? 0,
      p99:           summaryMap.p99            ?? 0,
      avg:           summaryMap.avg            ?? 0,
      rps:           summaryMap.rps            ?? 0,
      errorRate:     summaryMap.error_rate     ?? 0,
      maxVUs:        summaryMap.max_vus        ?? 0,
      totalRequests: summaryMap.total_requests ?? 0,
    };
  } else {
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

    if (durations.length === 0) return null;

    const durationSecs = Math.max(
      ((finishedAt ?? new Date()).getTime() - startedAt.getTime()) / 1000,
      1,
    );
    const total     = durations.length;
    const rps       = Math.round((total / durationSecs) * 10) / 10;
    metrics = {
      p50:           percentile(durations, 0.50),
      p90:           percentile(durations, 0.90),
      p95:           percentile(durations, 0.95),
      p99:           percentile(durations, 0.99),
      avg:           Math.round((durations.reduce((s, v) => s + v, 0) / durations.length) * 10) / 10,
      rps,
      errorRate:     0,
      maxVUs:        0,
      totalRequests: total,
    };
  }

  // ── 4. Time series: bucket by 10-second windows ──────────────────────────────
  const bucketMap = new Map<number, number[]>();
  for (const row of timeRows) {
    const rawVal = row._value;
    if (rawVal <= 0) continue;
    // Convert seconds → ms for k6_http_req_duration_seconds; requestsRaw is already ms
    const ms = rawVal < 30 ? rawVal * 1000 : rawVal;
    const t  = new Date(row._time).getTime();
    const bucket10s = Math.floor(t / 10_000) * 10_000;
    if (!bucketMap.has(bucket10s)) bucketMap.set(bucket10s, []);
    bucketMap.get(bucket10s)!.push(ms);
  }

  const timeSeries: ExecutionTimeSeries[] = Array.from(bucketMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ts, vals]) => {
      vals.sort((a, b) => a - b);
      return {
        time: new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        p50:  percentile(vals, 0.50),
        p95:  percentile(vals, 0.95),
      };
    });

  return { metrics, timeSeries };
}

export interface DayMetric {
  day: string;
  p95: number;
  p50: number;
  rps: number;
  errorRate: number;
  breaches: number;
}

export async function queryDashboardTrends(): Promise<DayMetric[] | null> {
  const org    = process.env.INFLUXDB_ORG;
  const bucket = process.env.INFLUXDB_BUCKET;
  const client = getClient();
  if (!client || !org || !bucket) return null;

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

  type Row = { day: string; _field: string; _value: number };
  let rows: Row[];
  try {
    rows = await queryApi.collectRows<Row>(flux, (values, meta) => ({
      day:    meta.get(values, 'day')    as string,
      _field: meta.get(values, '_field') as string,
      _value: parseFloat(meta.get(values, '_value') as string) || 0,
    }));
  } catch {
    return null;
  }

  const map = new Map<string, Partial<DayMetric>>();
  for (const r of rows) {
    const entry = map.get(r.day) ?? { day: r.day };
    if (r._field === 'p95')               entry.p95       = r._value;
    else if (r._field === 'p50')          entry.p50       = r._value;
    else if (r._field === 'rps')          entry.rps       = r._value;
    else if (r._field === 'error_rate')   entry.errorRate = r._value;
    else if (r._field === 'threshold_breaches') entry.breaches = Math.round(r._value);
    map.set(r.day, entry);
  }

  return Array.from(map.values())
    .sort((a, b) => a.day!.localeCompare(b.day!))
    .map(e => ({
      day:       e.day!,
      p95:       e.p95       ?? 0,
      p50:       e.p50       ?? 0,
      rps:       e.rps       ?? 0,
      errorRate: e.errorRate ?? 0,
      breaches:  e.breaches  ?? 0,
    }));
}

function getWriteApi(): WriteApi | null {
  const url    = process.env.INFLUXDB_URL;
  const token  = process.env.INFLUXDB_TOKEN;
  const org    = process.env.INFLUXDB_ORG;
  const bucket = process.env.INFLUXDB_BUCKET;

  if (!url || !token || !org || !bucket) {
    // Silently skip — InfluxDB is optional
    return null;
  }

  return new InfluxDB({ url, token }).getWriteApi(org, bucket, 'ms');
}

export interface InfluxPushResult {
  skipped: boolean;
  url: string;
  org: string;
  bucket: string;
  pointsWritten: number;
  error?: string;
}

export async function pushExecutionMetrics(execution: any): Promise<InfluxPushResult> {
  const url    = process.env.INFLUXDB_URL    ?? '';
  const org    = process.env.INFLUXDB_ORG    ?? '';
  const bucket = process.env.INFLUXDB_BUCKET ?? '';

  const writeApi = getWriteApi();
  if (!writeApi) {
    return { skipped: true, url, org, bucket, pointsWritten: 0 };
  }

  const metrics        = (execution.metrics as any)          ?? {};
  const thresholds     = (execution.thresholdResults as any) ?? [];
  const finishedAt     = execution.finishedAt ? new Date(execution.finishedAt) : new Date();
  // Same runId jobDispatcher tags requestsRaw/virtualUsers with — lets the
  // dashboard's existing $runId/$runId_Baseline variables filter k6_execution too.
  const runId = execution.startedAt ? `PerfOps-${new Date(execution.startedAt).getTime()}` : '';

  // ── Measurement: k6_execution ────────────────────────────────────────────────
  const execPoint = new Point('k6_execution')
    .tag('execution_id', String(execution.id       ?? ''))
    .tag('runId',        runId)
    .tag('spec_id',      String(execution.specId   ?? ''))
    .tag('spec_name',    String(execution.specName ?? ''))
    .tag('environment',  String(execution.environment ?? ''))
    .tag('status',       String(execution.status   ?? ''))
    // response times (ms)
    .floatField('p50',            toFloat(metrics.p50))
    .floatField('p90',            toFloat(metrics.p90))
    .floatField('p95',            toFloat(metrics.p95))
    .floatField('p99',            toFloat(metrics.p99))
    .floatField('avg',            toFloat(metrics.avg))
    // throughput / errors
    .floatField('rps',            toFloat(metrics.rps))
    .floatField('error_rate',     toFloat(metrics.errorRate))
    // load
    .floatField('max_vus',        toFloat(metrics.maxVUs))
    .floatField('total_requests', toFloat(metrics.totalRequests))
    // execution metadata
    .floatField('duration_seconds', toFloat(execution.duration))
    .intField('threshold_breaches', toInt(execution.thresholdBreaches))
    .intField('checks_passed',      toInt(execution.checksPassed))
    .intField('checks_failed',      toInt(execution.checksFailed))
    .timestamp(finishedAt);

  writeApi.writePoint(execPoint);
  let pointsWritten = 1;

  // ── Measurement: k6_thresholds (one point per threshold result) ───────────────
  if (Array.isArray(thresholds)) {
    for (const t of thresholds) {
      const pt = new Point('k6_thresholds')
        .tag('execution_id', String(execution.id       ?? ''))
        .tag('spec_name',    String(execution.specName ?? ''))
        .tag('metric',       String(t.metric    ?? ''))
        .tag('passed',       String(t.passed    ?? false))
        .stringField('condition', String(t.condition ?? ''))
        .stringField('actual',    String(t.actual    ?? ''))
        .timestamp(finishedAt);
      writeApi.writePoint(pt);
      pointsWritten++;
    }
  }

  try {
    await writeApi.close();
    console.log(`[InfluxDB] Pushed ${pointsWritten} points for execution ${execution.id}`);
    return { skipped: false, url, org, bucket, pointsWritten };
  } catch (err: any) {
    console.error(`[InfluxDB] Failed to push metrics: ${err.message}`);
    return { skipped: false, url, org, bucket, pointsWritten: 0, error: err.message };
  }
}

function toFloat(v: any): number { return parseFloat(v) || 0; }
function toInt(v: any):   number { return parseInt(v)   || 0; }
