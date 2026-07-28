import React, { useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import {
  CheckCircle, XCircle, Download, ArrowLeft, AlertTriangle,
  Clock, Activity, Zap, TrendingUp, FileText, Shield, Info,
  Users, BarChart2,
} from 'lucide-react';
import { useFetch } from '../hooks/useFetch';
import { api } from '../lib/api';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, unit = ''): string {
  if (n == null) return '—';
  return `${n}${unit}`;
}

function fmtDuration(s: number | null): string {
  if (!s) return '—';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// errorRate from metrics is stored as a percentage value (4.0 = 4%)
function fmtErrRate(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v.toFixed(2)}%`;
}

// grafanaMetrics.errorRate is decimal 0-1 — convert to display
function fmtDecimalRate(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(2)}%`;
}

interface MsThresholdLimits { avg: number | null; p90: number | null; p95: number | null; }

// Parses k6's own evaluated threshold conditions (e.g. "p(95)<800", "avg<500")
// out of thresholdResults — the actual thresholds configured in Test Authoring
// for this execution, as k6 itself evaluated them — to find the strictest
// configured limit for avg/p90/p95 response time, in ms, so the per-endpoint
// table can flag exactly which endpoints are responsible for a breach (k6
// thresholds are aggregate/scenario-level, not per-endpoint, so this applies
// the same configured limit to every row rather than needing a per-endpoint
// threshold that doesn't exist). Metric names ending in _seconds (this app's
// own k6_http_req_duration_seconds Trend, see k6PromptBlocks.ts) are
// normalized ×1000 to match the ms values already used throughout this table;
// k6's native http_req_duration is already ms.
function extractMsThresholds(thresholdResults: any[]): MsThresholdLimits {
  const limits: MsThresholdLimits = { avg: null, p90: null, p95: null };
  if (!Array.isArray(thresholdResults)) return limits;
  for (const t of thresholdResults) {
    const metric = String(t?.metric ?? '');
    const condition = String(t?.condition ?? '');
    const match = condition.match(/^(avg|p\(90\)|p\(95\))\s*<\s*([\d.]+)/i);
    if (!match) continue;
    const key: keyof MsThresholdLimits = match[1].toLowerCase().startsWith('avg') ? 'avg' : match[1].includes('90') ? 'p90' : 'p95';
    let limit = parseFloat(match[2]);
    if (!Number.isFinite(limit)) continue;
    if (/_seconds\b/i.test(metric)) limit *= 1000;
    // Strictest configured limit wins if the same stat is thresholded more than once.
    if (limits[key] == null || limit < (limits[key] as number)) limits[key] = limit;
  }
  return limits;
}

interface Finding {
  severity: 'critical' | 'warning' | 'info';
  message: string;
  recommendation: string;
}

function generateFindings(
  metrics: any,
  grafanaMetrics: any,
  thresholdResults: any[],
  checkResults: any[],
): Finding[] {
  const findings: Finding[] = [];
  // Prefer this execution's own recorded error rate (same value the Executor
  // page showed, and same source used for dispErrPct above) over recomputing
  // from grafanaMetrics/requestsRaw — that recomputation uses different
  // pass/fail semantics (isResponseStatusExpected()'s allowances for known-
  // benign 404s/redirects) and can show 0% here even when k6 itself recorded
  // real failures, which silently suppressed the error-rate finding below.
  const errorRatePct = metrics?.errorRate ?? (grafanaMetrics ? grafanaMetrics.errorRate * 100 : null);
  const p95 = grafanaMetrics?.p95 ?? metrics?.p95 ?? null;

  const failedThresholds = thresholdResults.filter(t => !t.passed);
  if (failedThresholds.length > 0) {
    findings.push({
      severity: 'critical',
      message: `${failedThresholds.length} SLA threshold${failedThresholds.length > 1 ? 's' : ''} breached: ${failedThresholds.map(t => t.metric).join(', ')}`,
      recommendation: 'Investigate the root cause of threshold breaches. Review application performance under the defined load pattern and consider infrastructure scaling or code optimization.',
    });
  }

  if (p95 != null && p95 > 1000) {
    findings.push({
      severity: 'critical',
      message: `P95 response time (${p95}ms) exceeds 1000ms — users experience unacceptable latency at the 95th percentile.`,
      recommendation: 'Profile slow endpoints. Examine database query plans, caching strategies, and upstream service dependencies.',
    });
  } else if (p95 != null && p95 > 500) {
    findings.push({
      severity: 'warning',
      message: `P95 response time (${p95}ms) is above the 500ms general guideline.`,
      recommendation: 'Review the slowest API calls captured during the test. Consider enabling response caching or adding a CDN layer.',
    });
  }

  if (errorRatePct != null && errorRatePct > 5) {
    findings.push({
      severity: 'critical',
      message: `Error rate (${errorRatePct.toFixed(2)}%) exceeds 5% — a significant proportion of requests are failing.`,
      recommendation: 'Examine server error logs during the test window. Check for connection pool exhaustion, rate limiting, or backend exceptions.',
    });
  } else if (errorRatePct != null && errorRatePct > 1) {
    findings.push({
      severity: 'warning',
      message: `Error rate (${errorRatePct.toFixed(2)}%) is above the 1% acceptable threshold.`,
      recommendation: 'Review error categories in the k6 output. Ensure the target environment is stable and not under unrelated load.',
    });
  }

  const failedChecks = checkResults.filter(c => !c.passed);
  if (failedChecks.length > 0) {
    findings.push({
      severity: 'warning',
      message: `${failedChecks.length} functional check${failedChecks.length > 1 ? 's' : ''} failed: ${failedChecks.map(c => c.name).join(', ')}`,
      recommendation: 'Failing checks indicate functional regressions. These should be treated as defects and resolved before the next performance run.',
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: 'info',
      message: 'All thresholds and checks passed. Performance targets met for this execution.',
      recommendation: 'Continue monitoring production metrics for anomalies. Consider increasing virtual users in the next test cycle to explore the scalability ceiling.',
    });
  }

  return findings;
}

// ── sub-components ───────────────────────────────────────────────────────────

const SeverityIcon: React.FC<{ s: Finding['severity'] }> = ({ s }) => {
  if (s === 'critical') return <XCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />;
  if (s === 'warning')  return <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />;
  return <Info size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />;
};

const SectionTitle: React.FC<{ num: string; title: string; icon: React.ReactNode }> = ({ num, title, icon }) => (
  <div className="flex items-center gap-2 mb-4 pb-2 border-b-2 border-gray-200">
    <span className="text-xs font-bold text-gray-400 w-6">{num}</span>
    <span className="text-gray-400">{icon}</span>
    <h2 className="text-base font-bold text-gray-800 uppercase tracking-wide">{title}</h2>
  </div>
);

const MetricPill: React.FC<{
  label: string; value: string; sub?: string;
  highlight?: 'pass' | 'fail' | 'warn' | 'neutral';
}> = ({ label, value, sub, highlight = 'neutral' }) => {
  const colors = {
    pass:    'bg-green-50 border-green-200 text-green-700',
    fail:    'bg-red-50 border-red-200 text-red-700',
    warn:    'bg-amber-50 border-amber-200 text-amber-700',
    neutral: 'bg-gray-50 border-gray-200 text-gray-700',
  };
  return (
    <div className={`rounded-lg border p-4 ${colors[highlight]}`}>
      <div className="text-xs font-semibold uppercase tracking-wider opacity-70 mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs opacity-60 mt-0.5">{sub}</div>}
    </div>
  );
};

// Grafana-style stat card (matches panel layout exactly)
const GrafanaStat: React.FC<{
  label: string; value: string; sub?: string; color?: string;
}> = ({ label, value, sub, color = 'text-gray-900' }) => (
  <div className="bg-[#181b1f] rounded-lg px-4 py-3 flex flex-col gap-1 min-w-0">
    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest truncate">{label}</div>
    <div className={`text-2xl font-black truncate ${color}`}>{value}</div>
    {sub && <div className="text-[10px] text-gray-500">{sub}</div>}
  </div>
);

// ── main component ────────────────────────────────────────────────────────────

export const ReportView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const printRef = useRef<HTMLDivElement>(null);

  const { data: report, loading, error } = useFetch(
    () => id ? api.reports.get(id) as Promise<any> : Promise.resolve(null),
    [id],
  );

  const handlePrint = () => window.print();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500">Generating report…</p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700 text-sm">
          Report not found or failed to load.
        </div>
      </div>
    );
  }

  const {
    execution, spec, metrics, grafanaMetrics,
    thresholdResults, checkResults, responseTimeSeries,
    sloResults,
  } = report as any;
  const sloData = sloResults?.results?.length ? sloResults : null;

  const gm = grafanaMetrics ?? null; // shorthand

  const passed   = execution.status === 'pass';
  const findings = generateFindings(
    metrics,
    gm,
    Array.isArray(thresholdResults) ? thresholdResults : [],
    Array.isArray(checkResults)     ? checkResults     : [],
  );

  const msLimits = extractMsThresholds(Array.isArray(thresholdResults) ? thresholdResults : []);

  const reportRef    = `PTR-${execution.id.slice(0, 8).toUpperCase()}`;
  const generatedAt  = new Date().toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });

  // Derive display values — prefer grafanaMetrics (same source as Grafana) over DB metrics
  const dispP50        = gm?.p50          ?? metrics?.p50          ?? null;
  const dispP90        = gm?.p90          ?? metrics?.p90          ?? null;
  const dispP95        = gm?.p95          ?? metrics?.p95          ?? null;
  const dispP99        = gm?.p99          ?? metrics?.p99          ?? null;
  const dispAvg        = gm?.avgResponseTime ?? metrics?.avg        ?? null;
  const dispRps        = gm?.rps          ?? metrics?.rps          ?? null;
  // Error rate is the one field that must match the Executor page, NOT be
  // recomputed from requestsRaw here — the backend (routes/reports.ts) already
  // prefers this execution's own recorded error rate over a requestsRaw
  // recomputation (which uses different pass/fail semantics and can diverge),
  // so `metrics.errorRate` is already the correct, Executor-matching value.
  const dispErrPct     = metrics?.errorRate ?? (gm != null ? gm.errorRate * 100 : null);
  // Success rate and error count are ALWAYS derived from dispErrPct (never
  // independently from gm.successRate/gm.errorsCount) — those are computed
  // from requestsRaw's own pass/fail tagging, a different source than
  // dispErrPct's now-authoritative execution-recorded value, and displaying
  // both side by side previously showed self-contradictory numbers (e.g.
  // "100% success" next to "7.55% error rate" for the same run).
  const dispSuccessPct = dispErrPct != null ? 100 - dispErrPct : null;
  const dispReqCount   = gm?.requestCount ?? metrics?.totalRequests ?? null;
  const dispErrCount   = dispErrPct != null && dispReqCount != null
    ? Math.round((dispErrPct / 100) * dispReqCount)
    : null;
  const dispMaxVUs     = gm?.maxVUs       ?? metrics?.maxVUs        ?? null;
  // Duration: prefer requestsRaw data span (matches Grafana) over DB execution.duration
  const dispDurationSecs = gm?.duration != null
    ? Math.round(gm.duration / 1000)
    : execution.duration;

  const p95Highlight = dispP95 == null ? 'neutral' : dispP95 <= 500 ? 'pass' : dispP95 <= 1000 ? 'warn' : 'fail';
  const errHighlight = dispErrPct == null ? 'neutral' : dispErrPct <= 1 ? 'pass' : dispErrPct <= 5 ? 'warn' : 'fail';

  const chartSeries = Array.isArray(responseTimeSeries) && responseTimeSeries.length > 0
    ? responseTimeSeries
    : null;

  return (
    <>
      {/* ── Print-only stylesheet ─────────────────────────────────────────── */}
      <style>{`
        @media print {
          body { margin: 0; }
          .no-print { display: none !important; }
          .print-break { page-break-before: always; }
          .report-page { box-shadow: none !important; border: none !important; }
          @page { size: A4; margin: 15mm 15mm 20mm 15mm; }
        }
      `}</style>

      {/* ── Screen toolbar ────────────────────────────────────────────────── */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm">
        <button
          onClick={() => navigate('/reports')}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={16} /> Back to Reports
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 font-mono">{reportRef}</span>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-semibold hover:bg-brand-600 transition-colors shadow-sm"
          >
            <Download size={14} /> Download PDF
          </button>
        </div>
      </div>

      {/* ── Report body ──────────────────────────────────────────────────── */}
      <div ref={printRef} className="report-page bg-white min-h-screen max-w-5xl mx-auto px-12 py-10 shadow-sm print:shadow-none print:max-w-none print:px-0 print:py-0">

        {/* ╔══ COVER ═══════════════════════════════════════════════════════╗ */}
        <div className="mb-10 pb-8 border-b-4 border-gray-900">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center">
                  <Activity size={16} className="text-white" />
                </div>
                <span className="text-sm font-bold text-gray-500 uppercase tracking-widest">PTaaS</span>
              </div>
              <h1 className="text-3xl font-black text-gray-900 leading-tight mb-1">
                Performance Test Report
              </h1>
              <p className="text-gray-500 text-sm">{execution.specName}</p>
            </div>
            <div className={`text-center px-8 py-4 rounded-xl border-2 ${passed ? 'bg-green-50 border-green-400' : 'bg-red-50 border-red-400'}`}>
              {passed
                ? <CheckCircle size={32} className="text-green-500 mx-auto mb-1" />
                : <XCircle size={32} className="text-red-500 mx-auto mb-1" />
              }
              <div className={`text-2xl font-black ${passed ? 'text-green-700' : 'text-red-700'}`}>
                {passed ? 'PASS' : 'FAIL'}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">Overall Verdict</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6 mt-6 text-sm">
            {[
              ['Report Reference', <span className="font-mono font-semibold text-gray-700">{reportRef}</span>],
              ['Execution Date',   fmtDate(execution.startedAt)],
              ['Generated',        generatedAt],
              ['Environment',      execution.environment],
              ['Triggered By',     execution.triggeredBy],
              ['Classification',   'Internal Use Only'],
            ].map(([k, v], i) => (
              <div key={i}>
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{k}</div>
                <div className="font-medium text-gray-700">{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ╔══ 1. GRAFANA SUMMARY (8 panels — same data source) ════════════╗ */}
        <div className="mb-10">
          <SectionTitle num="1" title="Test Execution Summary" icon={<BarChart2 size={16} />} />
          <p className="text-xs text-gray-500 mb-3">
            Metrics sourced from <span className="font-mono bg-gray-100 px-1 rounded">requestsRaw</span> — the same InfluxDB measurement powering the Grafana dashboard panels.
            {!gm && <span className="text-amber-600 ml-1">⚠ No requestsRaw data found for this run — values below are from k6 rolling metrics.</span>}
          </p>

          {/* Row 1: 4 stat cards matching Grafana's top row */}
          <div className="grid grid-cols-4 gap-3 mb-3">
            <div className="bg-gray-900 rounded-lg px-4 py-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Users size={11} className="text-gray-400" />
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Active Users</span>
              </div>
              <div className="text-3xl font-black text-[rgb(31,120,193)]">{dispMaxVUs ?? '—'}</div>
            </div>
            <div className="bg-gray-900 rounded-lg px-4 py-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Clock size={11} className="text-gray-400" />
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Duration</span>
              </div>
              <div className="text-3xl font-black text-white">{fmtDuration(dispDurationSecs)}</div>
            </div>
            <div className="bg-gray-900 rounded-lg px-4 py-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Zap size={11} className="text-gray-400" />
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Overall Throughput</span>
              </div>
              <div className="text-3xl font-black text-[rgb(31,120,193)]">
                {dispRps != null ? `${dispRps}` : '—'}
                <span className="text-base font-normal text-gray-400 ml-1">ops/s</span>
              </div>
            </div>
            <div className="bg-gray-900 rounded-lg px-4 py-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Activity size={11} className="text-gray-400" />
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Avg Response Time</span>
              </div>
              <div className="text-3xl font-black text-white">
                {dispAvg != null ? `${dispAvg}` : '—'}
                <span className="text-base font-normal text-gray-400 ml-1">ms</span>
              </div>
            </div>
          </div>

          {/* Row 2: Request Count, Errors Count, Success Rate, Error Rate */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-gray-900 rounded-lg px-4 py-3">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Request Count</div>
              <div className="text-3xl font-black text-[rgb(73,31,193)]">
                {dispReqCount != null ? dispReqCount.toLocaleString() : '—'}
              </div>
            </div>
            <div className="bg-gray-900 rounded-lg px-4 py-3">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Errors Count</div>
              <div className={`text-3xl font-black ${dispErrCount ? 'text-[rgb(237,20,20)]' : 'text-white'}`}>
                {dispErrCount != null ? dispErrCount.toLocaleString() : '—'}
              </div>
            </div>
            {/* Success Rate — gauge-style */}
            <div className="bg-gray-900 rounded-lg px-4 py-3">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Success Rate</div>
              <div className={`text-3xl font-black ${dispSuccessPct != null && dispSuccessPct >= 99 ? 'text-green-400' : dispSuccessPct != null && dispSuccessPct >= 95 ? 'text-amber-400' : 'text-red-400'}`}>
                {dispSuccessPct != null ? `${dispSuccessPct.toFixed(1)}%` : '—'}
              </div>
              {dispSuccessPct != null && (
                <div className="mt-1.5 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${dispSuccessPct >= 99 ? 'bg-green-500' : dispSuccessPct >= 95 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(dispSuccessPct, 100)}%` }}
                  />
                </div>
              )}
            </div>
            {/* Error Rate — gauge-style */}
            <div className="bg-gray-900 rounded-lg px-4 py-3">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Error Rate</div>
              <div className={`text-3xl font-black ${!dispErrPct || dispErrPct < 1 ? 'text-gray-300' : dispErrPct < 10 ? 'text-amber-400' : 'text-red-400'}`}>
                {dispErrPct != null ? `${dispErrPct.toFixed(2)}%` : '—'}
              </div>
              {dispErrPct != null && (
                <div className="mt-1.5 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${dispErrPct < 1 ? 'bg-gray-500' : dispErrPct < 10 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(dispErrPct * 2, 100)}%` }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Row 3: P50, P90, P95, P99, Avg Response Time */}
          <div className="grid grid-cols-5 gap-3 mt-3">
            {([
              ['P50', dispP50],
              ['P90', dispP90],
              ['P95', dispP95],
              ['P99', dispP99],
              ['Avg', dispAvg],
            ] as [string, number | null][]).map(([label, val]) => (
              <div key={label} className="bg-gray-900 rounded-lg px-4 py-3">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">{label} Response Time</div>
                <div className="text-3xl font-black text-white">
                  {val != null ? val : '—'}
                  {val != null && <span className="text-base font-normal text-gray-400 ml-1">ms</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ╔══ 2. TEST SCOPE & CONFIGURATION ══════════════════════════════╗ */}
        <div className="mb-10">
          <SectionTitle num="2" title="Test Scope & Configuration" icon={<FileText size={16} />} />
          <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {[
                  ['Test Name',         execution.specName],
                  ['Execution ID',      execution.id],
                  ['Environment',       execution.environment],
                  ['Test Tool',         'k6 (Grafana)'],
                  ['Test Type',         'Load Test'],
                  ['Start Time',        fmtDate(execution.startedAt)],
                  ['End Time',          fmtDate(execution.finishedAt)],
                  ['Duration',          fmtDuration(dispDurationSecs)],
                  ['Max Virtual Users', fmt(dispMaxVUs)],
                  ['Total Requests',    dispReqCount != null ? dispReqCount.toLocaleString() : '—'],
                  ['Triggered By',      execution.triggeredBy],
                  ...(spec ? [['Test Spec Tags', (spec.tags || []).join(', ') || '—']] : []),
                ].map(([k, v], i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2.5 font-medium text-gray-500 w-48 text-xs uppercase tracking-wide">{k}</td>
                    <td className="px-4 py-2.5 text-gray-800 font-mono text-xs">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ╔══ 3. PERFORMANCE METRICS SUMMARY ═════════════════════════════╗ */}
        <div className="mb-10">
          <SectionTitle num="3" title="Performance Metrics Summary" icon={<TrendingUp size={16} />} />
          {(metrics || gm) ? (
            <>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-5">
                <MetricPill label="P50 Latency"  value={fmt(dispP50, 'ms')}  highlight="neutral" sub="Median" />
                <MetricPill label="P90 Latency"  value={fmt(dispP90, 'ms')}  highlight="neutral" />
                <MetricPill label="P95 Latency"  value={fmt(dispP95, 'ms')}  highlight={p95Highlight} sub="Primary SLA" />
                <MetricPill label="P99 Latency"  value={fmt(dispP99, 'ms')}  highlight="neutral" />
                <MetricPill label="Error Rate"   value={dispErrPct != null ? `${dispErrPct.toFixed(2)}%` : '—'} highlight={errHighlight} />
                <MetricPill label="Throughput"   value={fmt(dispRps)}            highlight="neutral" sub="ops/s" />
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-xs text-blue-700">
                <strong>Interpretation guide:</strong> P95 ≤ 500ms is optimal. P95 500–1000ms is acceptable.
                Error rate ≤ 1% is acceptable; &gt; 5% is critical.
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400 italic">No metrics recorded for this execution.</p>
          )}
        </div>

        {/* ╔══ 4. RESPONSE TIME ANALYSIS ═══════════════════════════════════╗ */}
        {chartSeries && (
          <div className="mb-10">
            <SectionTitle num="4" title="Response Time Analysis" icon={<TrendingUp size={16} />} />
            <p className="text-xs text-gray-500 mb-4">
              Response time percentiles sampled throughout the test duration (10-second buckets from <span className="font-mono bg-gray-100 px-1 rounded">requestsRaw</span>).
              The 500ms reference line marks the standard performance acceptance threshold.
            </p>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartSeries} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} unit="ms" width={55} />
                  <Tooltip formatter={(v: number) => [`${v}ms`]} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={500} stroke="#DC2626" strokeDasharray="5 5"
                    label={{ value: 'SLA 500ms', fontSize: 9, fill: '#DC2626' }} />
                  <Line type="monotone" dataKey="p95" stroke="#2563EB" strokeWidth={2} dot={false} name="P95" />
                  <Line type="monotone" dataKey="p50" stroke="#60A5FA" strokeWidth={1.5} dot={false} name="P50 (Median)" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ╔══ 5. METRICS OVERVIEW — per-endpoint (Grafana panel-138) ══════╗ */}
        {gm && Array.isArray(gm.endpoints) && gm.endpoints.length > 0 && (
          <div className="mb-10 print-break">
            <SectionTitle num="5" title="Metrics Overview (Per Endpoint)" icon={<BarChart2 size={16} />} />
            <p className="text-xs text-gray-500 mb-4">
              Per-request breakdown sourced from <span className="font-mono bg-gray-100 px-1 rounded">requestsRaw</span>.
              Columns match the Grafana "Metrics Overview" table: Count, Avg, 90th and 95th percentile, Error Rate.
            </p>
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-900 text-white">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide">Request Name</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide">Count</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide">Avg (ms)</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide">90% (ms)</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide">95% (ms)</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide">Error Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {gm.endpoints.map((ep: any, i: number) => {
                    const errPct = ep.errorRate * 100;
                    const avgBreached = msLimits.avg != null && ep.avg > msLimits.avg;
                    const p90Breached = msLimits.p90 != null && ep.p90 > msLimits.p90;
                    const p95Breached = msLimits.p95 != null && ep.p95 > msLimits.p95;
                    return (
                      <tr key={i} className={`border-b border-gray-100 ${errPct > 0 ? 'bg-red-50' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-800 max-w-xs truncate">{ep.requestName}</td>
                        <td className="px-4 py-2.5 text-right text-xs text-gray-700 font-medium">{ep.count.toLocaleString()}</td>
                        <td className={`px-4 py-2.5 text-right text-xs ${avgBreached ? 'text-red-600 font-bold' : 'text-gray-700'}`}>{ep.avg}</td>
                        <td className={`px-4 py-2.5 text-right text-xs ${p90Breached ? 'text-red-600 font-bold' : 'text-gray-700'}`}>{ep.p90}</td>
                        <td className={`px-4 py-2.5 text-right text-xs font-semibold ${p95Breached ? 'text-red-600 font-bold' : 'text-gray-800'}`}>{ep.p95}</td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 bg-gray-200 rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full ${errPct < 1 ? 'bg-green-500' : errPct < 10 ? 'bg-amber-500' : 'bg-red-500'}`}
                                style={{ width: `${Math.min(errPct * 5, 100)}%` }}
                              />
                            </div>
                            <span className={`text-xs font-semibold w-14 text-right ${errPct > 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {(errPct).toFixed(2)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-100 border-t-2 border-gray-300">
                  <tr>
                    <td className="px-4 py-2.5 text-xs font-bold text-gray-700 uppercase">Total</td>
                    <td className="px-4 py-2.5 text-right text-xs font-bold text-gray-800">{gm.requestCount.toLocaleString()}</td>
                    <td className={`px-4 py-2.5 text-right text-xs font-bold ${msLimits.avg != null && gm.avgResponseTime > msLimits.avg ? 'text-red-600' : 'text-gray-800'}`}>{gm.avgResponseTime}</td>
                    <td className={`px-4 py-2.5 text-right text-xs font-bold ${msLimits.p90 != null && gm.p90 > msLimits.p90 ? 'text-red-600' : 'text-gray-800'}`}>{gm.p90}</td>
                    <td className={`px-4 py-2.5 text-right text-xs font-bold ${msLimits.p95 != null && gm.p95 > msLimits.p95 ? 'text-red-600' : 'text-gray-800'}`}>{gm.p95}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-bold text-gray-800">{(gm.errorRate * 100).toFixed(2)}%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ╔══ 6. SLO / SLA COMPLIANCE ════════════════════════════════════╗ */}
        <div className="mb-10 print-break">
          <SectionTitle num="6" title="SLO / SLA Compliance" icon={<Shield size={16} />} />

          {/* ── Business SLOs ── */}
          {sloData ? (
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-4">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border ${
                  sloData.overall === 'pass'
                    ? 'bg-green-50 text-green-700 border-green-200'
                    : 'bg-red-50 text-red-700 border-red-200'
                }`}>
                  {sloData.overall === 'pass' ? <CheckCircle size={13} /> : <XCircle size={13} />}
                  Overall: {sloData.overall.toUpperCase()}
                </span>
                <span className="text-sm text-gray-500">
                  {sloData.results.filter((r: any) => r.passed).length} / {sloData.results.length} objectives met
                </span>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Objective</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Target</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actual</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sloData.results.map((r: any, i: number) => {
                      const op = r.operator === 'lte' ? '≤' : '≥';
                      return (
                        <tr key={i} className={`border-b border-gray-100 ${!r.passed ? 'bg-red-50' : ''}`}>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${r.type === 'sla' ? 'bg-orange-100 text-orange-700' : 'bg-purple-100 text-purple-700'}`}>
                              {r.type.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-700">{r.label}</td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-600">{op} {r.target}{r.unit}</td>
                          <td className="px-4 py-3 text-xs font-medium text-gray-800">
                            {r.actual != null ? `${r.actual}${r.unit}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {r.passed
                              ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full"><CheckCircle size={11} /> PASS</span>
                              : <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full"><XCircle size={11} /> FAIL</span>
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic mb-6">No SLO/SLA targets were defined for this test.</p>
          )}

          {/* ── k6 Thresholds ── */}
          {Array.isArray(thresholdResults) && thresholdResults.length > 0 && (
            <>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">k6 Thresholds</h4>
              <div className="flex gap-4 mb-4">
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                  <CheckCircle size={13} />
                  <span className="font-semibold">{thresholdResults.filter((t: any) => t.passed).length}</span>
                  <span>Passed</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                  <XCircle size={13} />
                  <span className="font-semibold">{thresholdResults.filter((t: any) => !t.passed).length}</span>
                  <span>Failed</span>
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Metric</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Condition</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actual</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {thresholdResults.map((t: any, i: number) => (
                      <tr key={i} className={`border-b border-gray-100 ${!t.passed ? 'bg-red-50' : ''}`}>
                        <td className="px-4 py-3 font-mono text-xs text-gray-700">{t.metric}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">{t.condition}</td>
                        <td className="px-4 py-3 text-xs text-gray-700 font-medium">{t.actual}</td>
                        <td className="px-4 py-3 text-center">
                          {t.passed
                            ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full"><CheckCircle size={11} /> PASS</span>
                            : <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full"><XCircle size={11} /> FAIL</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* ╔══ 7. FUNCTIONAL VERIFICATION ═════════════════════════════════╗ */}
        <div className="mb-10">
          <SectionTitle num="7" title="Functional Verification (k6 Checks)" icon={<CheckCircle size={16} />} />
          {Array.isArray(checkResults) && checkResults.length > 0 ? (
            <>
              <p className="text-xs text-gray-500 mb-4">
                k6 checks verify functional correctness of responses under load. A pass rate below 100% indicates regressions.
                {execution.checksFailed > 0 && ' Failing checks are listed first below.'}
              </p>
              <div className="flex gap-4 mb-4">
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                  <CheckCircle size={13} />
                  <span className="font-semibold">{execution.checksPassed}</span><span>Passed</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                  <XCircle size={13} />
                  <span className="font-semibold">{execution.checksFailed}</span><span>Failed</span>
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Check Name</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-48">Pass Rate</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...checkResults]
                      .sort((a: any, b: any) => (a.passed === b.passed ? 0 : a.passed ? 1 : -1) || (b.fails ?? 0) - (a.fails ?? 0))
                      .map((c: any, i: number) => {
                      // Defensive fallback: older persisted checkResults (saved
                      // before this field existed) may not have passRate —
                      // compute it from passes/fails rather than reading
                      // undefined.toFixed(1), which crashed this whole section.
                      const total = (c.passes ?? 0) + (c.fails ?? 0);
                      const passRate = c.passRate ?? (total > 0 ? (c.passes / total) * 100 : 100);
                      return (
                        <tr key={i} className={`border-b border-gray-100 ${!c.passed ? 'bg-red-50' : ''}`}>
                          <td className="px-4 py-3 text-xs text-gray-700">{c.name}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-gray-200 rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full ${passRate >= 95 ? 'bg-green-500' : passRate >= 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                                  style={{ width: `${passRate}%` }}
                                />
                              </div>
                              <span className="text-xs font-medium text-gray-700 w-12 text-right">{passRate.toFixed(1)}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {c.passed
                              ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full"><CheckCircle size={11} /> PASS</span>
                              : <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full"><XCircle size={11} /> FAIL</span>
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400 italic">No functional checks were defined for this test.</p>
          )}
        </div>

        {/* ╔══ 8. FINDINGS & RECOMMENDATIONS ══════════════════════════════╗ */}
        <div className="mb-10 print-break">
          <SectionTitle num="8" title="Findings & Recommendations" icon={<AlertTriangle size={16} />} />
          <p className="text-xs text-gray-500 mb-4">
            Auto-generated findings based on ISTQB performance testing acceptance criteria and industry best practices.
          </p>
          <div className="space-y-3">
            {findings.map((f, i) => {
              const bg = f.severity === 'critical' ? 'bg-red-50 border-red-200' : f.severity === 'warning' ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200';
              const label = f.severity === 'critical' ? 'CRITICAL' : f.severity === 'warning' ? 'WARNING' : 'INFO';
              const labelColor = f.severity === 'critical' ? 'bg-red-600' : f.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500';
              return (
                <div key={i} className={`rounded-lg border p-4 ${bg}`}>
                  <div className="flex items-start gap-3">
                    <SeverityIcon s={f.severity} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`text-white text-xs font-bold px-2 py-0.5 rounded ${labelColor}`}>{label}</span>
                        <span className="text-xs font-semibold text-gray-700">Finding {i + 1}</span>
                      </div>
                      <p className="text-sm text-gray-800 mb-2">{f.message}</p>
                      <div className="text-xs text-gray-600 bg-white/60 rounded p-2.5 border border-white/80">
                        <span className="font-semibold">Recommendation: </span>{f.recommendation}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ╔══ FOOTER ══════════════════════════════════════════════════════╗ */}
        <div className="border-t-2 border-gray-200 pt-6 mt-6">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 bg-gray-900 rounded flex items-center justify-center">
                <Activity size={10} className="text-white" />
              </div>
              <span className="font-semibold text-gray-600">PTaaS</span>
              <span>·</span>
              <span>Performance Testing as a Service</span>
            </div>
            <div className="text-right space-y-0.5">
              <div>Report {reportRef} · Generated {generatedAt}</div>
              <div>ISTQB Performance Testing — Confidential / Internal Use Only</div>
            </div>
          </div>
        </div>

      </div>
    </>
  );
};
