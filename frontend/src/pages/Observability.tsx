import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Activity, Search, RefreshCw, AlertTriangle, ExternalLink, FileText, GitBranch } from 'lucide-react';
import { api } from '../lib/api';

type Tab = 'logs' | 'traces';

interface StatusInfo {
  ingestionConfigured: boolean;
  queryConfigured: boolean;
  domain: string;
  appName: string;
}

const SEVERITY_LABELS: Record<number, { label: string; cls: string }> = {
  1: { label: 'DEBUG', cls: 'bg-slate-100 text-slate-600' },
  2: { label: 'VERBOSE', cls: 'bg-slate-100 text-slate-600' },
  3: { label: 'INFO', cls: 'bg-blue-100 text-blue-700' },
  4: { label: 'WARNING', cls: 'bg-amber-100 text-amber-700' },
  5: { label: 'ERROR', cls: 'bg-red-100 text-red-700' },
  6: { label: 'CRITICAL', cls: 'bg-red-200 text-red-800' },
};

function formatTimestamp(row: Record<string, unknown>): string {
  const ts = row.timestamp ?? row.Timestamp;
  if (typeof ts === 'number') return new Date(ts).toLocaleString();
  if (typeof ts === 'string') {
    const n = Number(ts);
    if (!Number.isNaN(n)) return new Date(n).toLocaleString();
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  }
  return '—';
}

function rowSeverity(row: Record<string, unknown>): number {
  const s = row.severity;
  return typeof s === 'number' ? s : 3;
}

export const Observability: React.FC = () => {
  const [tab, setTab] = useState<Tab>('logs');
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [query, setQuery] = useState('');
  const [lookback, setLookback] = useState(60);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.coralogix.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  const fetchData = useCallback(async () => {
    if (!status?.queryConfigured) return;
    setLoading(true);
    setError('');
    try {
      const result = tab === 'logs'
        ? await api.coralogix.logs({ q: query || undefined, lookback, limit: 200 })
        : await api.coralogix.traces({ q: query || undefined, lookback, limit: 200 });
      setRows(result.rows);
      setWarnings(result.warnings);
    } catch (err: any) {
      setError(err.message ?? 'Failed to query Coralogix');
    } finally {
      setLoading(false);
    }
  }, [tab, query, lookback, status?.queryConfigured]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchData, 15000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, fetchData]);

  const notConfigured = status && !status.queryConfigured;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-500 flex items-center justify-center">
            <Activity size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Observability</h1>
            <p className="text-xs text-gray-500">
              Coralogix logs &amp; traces{status?.appName ? ` · ${status.appName}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            Auto-refresh (15s)
          </label>
          <button
            onClick={fetchData}
            disabled={loading || !!notConfigured}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {notConfigured && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <div className="font-medium mb-1">Coralogix query API not configured</div>
            <p className="text-amber-700">
              Set <code className="bg-amber-100 px-1 rounded">CORALOGIX_QUERY_API_KEY</code> and{' '}
              <code className="bg-amber-100 px-1 rounded">CORALOGIX_DOMAIN</code> in{' '}
              <code className="bg-amber-100 px-1 rounded">backend/.env</code> to enable this page.
              {status?.ingestionConfigured && (
                <> Log shipping is already active (<code className="bg-amber-100 px-1 rounded">CORALOGIX_API_KEY</code> is set) — this only adds read-back querying.</>
              )}
            </p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex bg-gray-100 rounded-lg p-1">
            {(['logs', 'traces'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  tab === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'logs' ? <FileText size={14} /> : <GitBranch size={14} />}
                {t === 'logs' ? 'Logs' : 'Traces'}
              </button>
            ))}
          </div>

          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') fetchData(); }}
              placeholder={tab === 'logs' ? 'Filter logs (subsystem, text)…' : 'Filter traces (operation, path)…'}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              disabled={!!notConfigured}
            />
          </div>

          <select
            value={lookback}
            onChange={e => setLookback(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            disabled={!!notConfigured}
          >
            <option value={15}>Last 15 min</option>
            <option value={60}>Last 1 hour</option>
            <option value={360}>Last 6 hours</option>
            <option value={1440}>Last 24 hours</option>
            <option value={10080}>Last 7 days</option>
          </select>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600 mb-3">{error}</div>
        )}
        {warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 mb-3 space-y-1">
            {warnings.map((w, i) => <div key={i}>{w}</div>)}
          </div>
        )}

        {!notConfigured && rows.length === 0 && !loading && !error && (
          <div className="text-center py-10 text-sm text-gray-400">
            No {tab} found in the selected time range.
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3 font-medium">Time</th>
                  {tab === 'logs' ? (
                    <>
                      <th className="py-2 pr-3 font-medium">Severity</th>
                      <th className="py-2 pr-3 font-medium">Subsystem</th>
                      <th className="py-2 pr-3 font-medium">Event / Message</th>
                    </>
                  ) : (
                    <>
                      <th className="py-2 pr-3 font-medium">Operation</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium">Duration</th>
                      <th className="py-2 pr-3 font-medium">Trace ID</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const sev = rowSeverity(row);
                  const sevInfo = SEVERITY_LABELS[sev] ?? SEVERITY_LABELS[3];
                  const isOpen = expanded === i;
                  return (
                    <React.Fragment key={i}>
                      <tr
                        className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                        onClick={() => setExpanded(isOpen ? null : i)}
                      >
                        <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{formatTimestamp(row)}</td>
                        {tab === 'logs' ? (
                          <>
                            <td className="py-2 pr-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sevInfo.cls}`}>
                                {sevInfo.label}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-gray-600">{String(row.subsystem ?? row.subsystemname ?? '—')}</td>
                            <td className="py-2 pr-3 text-gray-900 truncate max-w-md">
                              {String(row.event ?? row.message ?? row.text ?? JSON.stringify(row))}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-2 pr-3 text-gray-900">{String(row.operation ?? '—')}</td>
                            <td className="py-2 pr-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                row.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                              }`}>
                                {String(row.status ?? '—')}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-gray-600">
                              {typeof row.durationMs === 'number' ? `${row.durationMs}ms` : '—'}
                            </td>
                            <td className="py-2 pr-3 text-gray-400 font-mono text-xs">{String(row.traceId ?? '—')}</td>
                          </>
                        )}
                      </tr>
                      {isOpen && (
                        <tr className="bg-gray-50">
                          <td colSpan={tab === 'logs' ? 4 : 5} className="p-3">
                            <pre className="text-xs text-gray-700 whitespace-pre-wrap break-all">
                              {JSON.stringify(row, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {status?.domain && (
        <a
          href={`https://${status.domain}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600"
        >
          <ExternalLink size={12} />
          Open Coralogix ({status.domain})
        </a>
      )}
    </div>
  );
};
