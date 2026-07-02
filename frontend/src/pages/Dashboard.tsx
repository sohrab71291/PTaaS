import React, { useEffect, useState, useCallback } from 'react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend
} from 'recharts';
import { CheckCircle, XCircle, Clock, Activity, TrendingUp, Zap, AlertTriangle, BarChart2, ExternalLink, Wifi, WifiOff, Loader2, Database } from 'lucide-react';
import { useFetch } from '../hooks/useFetch';
import { useExecution } from '../contexts/ExecutionContext';
import { api } from '../lib/api';
import { DashboardData, Execution } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import { CardSkeleton, LoadingSkeleton } from '../components/LoadingSkeleton';
import { Link } from 'react-router-dom';

const HealthRing: React.FC<{ score: number }> = ({ score }) => {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;

  const color = score >= 80 ? '#16A34A' : score >= 60 ? '#D97706' : '#DC2626';

  return (
    <div className="relative w-24 h-24 flex-shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={r} fill="none" stroke="#E5E7EB" strokeWidth="8" />
        <circle
          cx="44" cy="44" r={r} fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-gray-900">{score}</span>
        <span className="text-xs text-gray-500">/ 100</span>
      </div>
    </div>
  );
};

export const Dashboard: React.FC = () => {
  const { data, loading, error, lastUpdated, refetch } = useFetch<DashboardData>(
    () => api.dashboard.get() as Promise<DashboardData>,
    [],
    { refreshInterval: 30_000 },
  );

  // Refresh immediately when a test execution finishes, instead of waiting
  // for the next 30s poll, so panels reflect the just-completed run's metrics.
  const { status: executionStatus } = useExecution();
  useEffect(() => {
    if (executionStatus === 'complete' || executionStatus === 'stopped') refetch();
  }, [executionStatus, refetch]);

  const [grafanaConfig, setGrafanaConfig] = useState<{
    grafanaUrl:          string | null;
    grafanaDashboardUid: string | null;
    influxdbUrl:         string | null;
    influxdbConfigured:  boolean;
  } | null>(null);

  useEffect(() => {
    api.config.get().then(setGrafanaConfig).catch(() => {});
  }, []);

  const grafanaOpenUrl =
    grafanaConfig?.grafanaUrl && grafanaConfig?.grafanaDashboardUid
      ? `${grafanaConfig.grafanaUrl}/d/${grafanaConfig.grafanaDashboardUid}`
      : null;

  type ConnStatus = 'idle' | 'testing' | 'connected' | 'failed';
  interface ServiceStatus { status: ConnStatus; message: string; latencyMs: number | null }

  const [influxStatus, setInfluxStatus] = useState<ServiceStatus>({ status: 'idle', message: 'Not tested', latencyMs: null });
  const [grafanaStatus, setGrafanaStatus] = useState<ServiceStatus>({ status: 'idle', message: 'Not tested', latencyMs: null });
  const [testing, setTesting] = useState(false);

  const runConnectionTest = useCallback(async () => {
    setTesting(true);
    setInfluxStatus(s => ({ ...s, status: 'testing', message: 'Testing…' }));
    setGrafanaStatus(s => ({ ...s, status: 'testing', message: 'Testing…' }));
    try {
      const result = await api.config.testConnections();
      setInfluxStatus({
        status: result.influxdb.connected ? 'connected' : 'failed',
        message: result.influxdb.message,
        latencyMs: result.influxdb.latencyMs,
      });
      setGrafanaStatus({
        status: result.grafana.connected ? 'connected' : 'failed',
        message: result.grafana.message,
        latencyMs: result.grafana.latencyMs,
      });
    } catch {
      setInfluxStatus({ status: 'failed', message: 'Request failed', latencyMs: null });
      setGrafanaStatus({ status: 'failed', message: 'Request failed', latencyMs: null });
    } finally {
      setTesting(false);
    }
  }, []);

  // Auto-test connectivity on mount so the Grafana iframe only renders when reachable
  useEffect(() => {
    runConnectionTest();
  }, [runConnectionTest]);

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-28 bg-gray-100 rounded-xl animate-pulse" />
        <CardSkeleton />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
          <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Failed to load dashboard: {error}
        </div>
      </div>
    );
  }

  const { lastRun, healthScore, stats, recentExecutions, responseTimeTrend, errorRateTrend, throughputData, thresholdBreachHistory, influxConnected } = data as DashboardData & { influxConnected: boolean };

  const formatDay = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Page title */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Performance Dashboard</h1>
          <p className="text-gray-500 text-sm mt-0.5">Real-time overview of your performance test suite</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 pt-1">
          {lastUpdated && (
            <span className="text-xs text-gray-400">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={refetch}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 shadow-sm transition-all"
          >
            <Activity size={12} />
            Refresh
          </button>
          <span className="flex items-center gap-1.5 text-xs font-medium text-green-600">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Live · 30s
          </span>
        </div>
      </div>

      {/* Last Run Banner */}
      {lastRun && (
        <div className={`rounded-xl border-2 p-5 ${lastRun.status === 'pass' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                {lastRun.status === 'pass'
                  ? <CheckCircle size={18} className="text-green-600" />
                  : <XCircle size={18} className="text-red-600" />
                }
                <span className="font-semibold text-gray-900">Last Run: {lastRun.name}</span>
                <StatusBadge status={lastRun.status} />
              </div>
              <p className="text-sm text-gray-600">
                Ran at {new Date(lastRun.ranAt).toLocaleString()} on <strong>{lastRun.environment}</strong>
              </p>
            </div>
            <div className="flex gap-6 text-sm">
              <div className="text-center">
                <div className="font-bold text-gray-900">
                  {lastRun.p95 != null ? `${lastRun.p95}ms` : <span className="text-gray-400">—</span>}
                </div>
                <div className="text-gray-500 text-xs">P95 Latency</div>
              </div>
              <div className="text-center">
                <div className="font-bold text-gray-900">
                  {lastRun.maxVUs != null ? lastRun.maxVUs : <span className="text-gray-400">—</span>}
                </div>
                <div className="text-gray-500 text-xs">Max VUs</div>
              </div>
              <div className="text-center">
                <div className={`font-bold ${lastRun.thresholdBreaches === 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {lastRun.thresholdBreaches}
                </div>
                <div className="text-gray-500 text-xs">Threshold Breaches</div>
              </div>
              {(lastRun.sloResults?.results?.length ?? 0) > 0 && (() => {
                const sr = lastRun.sloResults!;
                return (
                  <div className="text-center">
                    <div className={`font-bold ${sr.overall === 'pass' ? 'text-green-600' : 'text-red-600'}`}>
                      {sr.results.filter((r: any) => r.passed).length}/{sr.results.length}
                    </div>
                    <div className="text-gray-500 text-xs">SLOs Met</div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle size={20} className="text-green-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">{stats.passing}</div>
            <div className="text-xs text-gray-500">Passing</div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <XCircle size={20} className="text-red-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">{stats.failing}</div>
            <div className="text-xs text-gray-500">Failing</div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <Activity size={20} className="text-blue-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">{data.activeTests.length}</div>
            <div className="text-xs text-gray-500">Running</div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <Clock size={20} className="text-amber-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">{stats.scheduled}</div>
            <div className="text-xs text-gray-500">Scheduled</div>
          </div>
        </div>
      </div>

      {/* Health Score + Recent Executions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Health Score */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Performance Health Score</h3>
          <div className="flex items-center gap-4">
            <HealthRing score={healthScore} />
            <div className="text-sm space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-gray-600">{stats.passing} passed (30d)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-gray-600">{stats.failing} failed (30d)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-gray-600">{stats.scheduled} scheduled</span>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Executions */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700">Recent Executions</h3>
            <Link to="/reports" className="text-xs text-brand-500 hover:text-brand-600">View all</Link>
          </div>
          <div className="space-y-2">
            {recentExecutions.slice(0, 6).map((exec: Execution) => (
              <div key={exec.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0 hover:bg-gray-50 rounded px-2">
                <div className="flex items-center gap-3 min-w-0">
                  <StatusBadge status={exec.status} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{exec.specName}</div>
                    <div className="text-xs text-gray-500">{exec.environment} · {exec.triggeredBy} · <span className="font-mono">{exec.id.slice(-8)}</span></div>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500 flex-shrink-0">
                  {exec.metrics?.p95 && (
                    <span className="font-medium text-gray-700">{exec.metrics.p95}ms p95</span>
                  )}
                  <Link to={`/report/${exec.id}`} className="text-brand-500 hover:text-brand-600">
                    Report
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Charts */}
      {!influxConnected ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-10 flex flex-col items-center justify-center text-center">
          <Database size={32} className="text-gray-300 mb-3" />
          <p className="text-sm font-semibold text-gray-600 mb-1">No metrics data available</p>
          <p className="text-xs text-gray-400 max-w-sm">
            InfluxDB is not connected. Configure{' '}
            <code className="bg-gray-100 px-1 py-0.5 rounded font-mono">INFLUXDB_URL</code>,{' '}
            <code className="bg-gray-100 px-1 py-0.5 rounded font-mono">INFLUXDB_TOKEN</code>,{' '}
            <code className="bg-gray-100 px-1 py-0.5 rounded font-mono">INFLUXDB_ORG</code>, and{' '}
            <code className="bg-gray-100 px-1 py-0.5 rounded font-mono">INFLUXDB_BUCKET</code> in{' '}
            <code className="bg-gray-100 px-1 py-0.5 rounded font-mono">backend/.env</code> to see real-time metrics.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Response Time Trend */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={16} className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700">Response Time Trend (7 days)</h3>
              <span className="text-xs text-green-500 font-medium ml-auto flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> Live
              </span>
            </div>
            {responseTimeTrend.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center text-xs text-gray-400">No data for the last 7 days</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={responseTimeTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={formatDay} />
                  <YAxis tick={{ fontSize: 11 }} unit="ms" />
                  <Tooltip formatter={(v: number) => [`${v}ms`]} />
                  <Legend />
                  <ReferenceLine y={500} stroke="#DC2626" strokeDasharray="4 4" label={{ value: 'Threshold', fontSize: 10 }} />
                  <Line type="monotone" dataKey="p95" stroke="#2563EB" strokeWidth={2} dot={false} name="P95" />
                  <Line type="monotone" dataKey="p50" stroke="#60A5FA" strokeWidth={2} dot={false} name="P50" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Error Rate Trend */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={16} className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700">Error Rate Trend (7 days)</h3>
              <span className="text-xs text-green-500 font-medium ml-auto flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> Live
              </span>
            </div>
            {errorRateTrend.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center text-xs text-gray-400">No data for the last 7 days</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={errorRateTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={formatDay} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v.toFixed(1)}%`} />
                  <Tooltip formatter={(v: number) => [`${v.toFixed(2)}%`]} />
                  <Area type="monotone" dataKey="rate" stroke="#DC2626" fill="#FEE2E2" strokeWidth={2} name="Error Rate" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Throughput */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={16} className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700">Throughput / RPS (7 days)</h3>
              <span className="text-xs text-green-500 font-medium ml-auto flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> Live
              </span>
            </div>
            {throughputData.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center text-xs text-gray-400">No data for the last 7 days</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={throughputData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={formatDay} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [`${v} RPS`]} />
                  <Bar dataKey="rps" fill="#2563EB" radius={[4, 4, 0, 0]} name="RPS" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Threshold Breach History */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={16} className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700">Threshold Breach History (7 days)</h3>
              <span className="text-xs text-green-500 font-medium ml-auto flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> Live
              </span>
            </div>
            {thresholdBreachHistory.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center text-xs text-gray-400">No data for the last 7 days</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={thresholdBreachHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={formatDay} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="breaches" fill="#DC2626" radius={[4, 4, 0, 0]} name="Breaches" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* ── Integration Connectivity ──────────────────────────────────────── */}
      <IntegrationStatus
        influxStatus={influxStatus}
        grafanaStatus={grafanaStatus}
        grafanaConfig={grafanaConfig}
        testing={testing}
        onTest={runConnectionTest}
      />

      {/* ── Grafana Dashboard Link ─────────────────────────────────────────── */}
      {grafanaOpenUrl && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center flex-shrink-0">
              <BarChart2 size={20} className="text-orange-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">Grafana Live Dashboard</p>
              <p className="text-xs text-gray-400">View real-time metrics and performance charts</p>
            </div>
          </div>
          <a
            href={grafanaOpenUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold shadow-sm transition-colors flex-shrink-0"
          >
            Open Grafana
            <ExternalLink size={13} />
          </a>
        </div>
      )}
    </div>
  );
};

// ── IntegrationStatus sub-component ──────────────────────────────────────────
type ConnStatus = 'idle' | 'testing' | 'connected' | 'failed';
interface ServiceStatus { status: ConnStatus; message: string; latencyMs: number | null }

interface IntegrationStatusProps {
  influxStatus: ServiceStatus;
  grafanaStatus: ServiceStatus;
  grafanaConfig: { grafanaUrl: string | null; grafanaDashboardUid: string | null; influxdbUrl: string | null; influxdbConfigured: boolean } | null;
  testing: boolean;
  onTest: () => void;
}

const statusStyles: Record<ConnStatus, { dot: string; badge: string; label: string }> = {
  idle:      { dot: 'bg-gray-300',            badge: 'bg-gray-100 text-gray-500 border-gray-200',            label: 'Not connected' },
  testing:   { dot: 'bg-yellow-400 animate-pulse', badge: 'bg-yellow-50 text-yellow-600 border-yellow-200', label: 'Testing…'      },
  connected: { dot: 'bg-green-500',           badge: 'bg-green-50 text-green-700 border-green-200',          label: 'Connected'     },
  failed:    { dot: 'bg-red-400',             badge: 'bg-red-50 text-red-600 border-red-200',                label: 'Failed'        },
};

const IntegrationStatus: React.FC<IntegrationStatusProps> = ({
  influxStatus, grafanaStatus, grafanaConfig, testing, onTest,
}) => {
  const services = [
    {
      key: 'influxdb',
      label: 'InfluxDB',
      icon: <Database size={18} />,
      url: grafanaConfig?.influxdbUrl ?? null,
      configured: grafanaConfig?.influxdbConfigured ?? false,
      svc: influxStatus,
    },
    {
      key: 'grafana',
      label: 'Grafana',
      icon: <BarChart2 size={18} />,
      url: grafanaConfig?.grafanaUrl ?? null,
      configured: !!grafanaConfig?.grafanaUrl,
      svc: grafanaStatus,
    },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wifi size={15} className="text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-700">Integration Connectivity</h3>
        </div>
        <button
          onClick={onTest}
          disabled={testing}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all border
            ${testing
              ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
              : 'bg-white text-gray-700 border-gray-300 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 shadow-sm'
            }`}
        >
          {testing
            ? <><Loader2 size={12} className="animate-spin" /> Testing…</>
            : <><Wifi size={12} /> Connect</>}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {services.map(({ key, label, icon, url, configured, svc }) => {
          const styles = statusStyles[svc.status];
          return (
            <div
              key={key}
              className={`rounded-lg border p-4 transition-all
                ${svc.status === 'connected' ? 'border-green-200 bg-green-50/40' :
                  svc.status === 'failed'    ? 'border-red-200 bg-red-50/30' :
                  'border-gray-100 bg-gray-50/60'}`}
            >
              {/* Header row */}
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <span className={`${svc.status === 'connected' ? 'text-green-600' : svc.status === 'failed' ? 'text-red-400' : 'text-gray-400'}`}>
                    {icon}
                  </span>
                  <span className="text-sm font-semibold text-gray-700">{label}</span>
                </div>
                {/* Status dot */}
                <div className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${styles.dot}`} />
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${styles.badge}`}>
                    {styles.label}
                  </span>
                </div>
              </div>

              {/* URL */}
              <div className="text-xs text-gray-400 truncate mb-2">
                {url ? url : <span className="italic">Not configured in backend/.env</span>}
              </div>

              {/* Message + latency */}
              {svc.status !== 'idle' && (
                <div className={`text-xs flex items-center justify-between gap-2
                  ${svc.status === 'connected' ? 'text-green-600' :
                    svc.status === 'failed'    ? 'text-red-500' :
                    'text-yellow-600'}`}
                >
                  <span className="truncate">{svc.message}</span>
                  {svc.latencyMs !== null && (
                    <span className="flex-shrink-0 font-mono text-gray-400">{svc.latencyMs}ms</span>
                  )}
                </div>
              )}

              {/* Config hint when not configured */}
              {!configured && svc.status === 'idle' && (
                <div className="text-xs text-gray-400 mt-1 italic">
                  Set {key === 'influxdb'
                    ? 'INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG'
                    : 'GRAFANA_URL'} in backend/.env
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
