import React, { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { Search, Download, Share2, ArrowLeft, CheckCircle, XCircle } from 'lucide-react';
import { useFetch } from '../hooks/useFetch';
import { api } from '../lib/api';
import { Execution } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import { MetricCard } from '../components/MetricCard';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ToastContainer';

export const Reports: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const execId = searchParams.get('exec');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const { toasts, addToast, removeToast } = useToast();

  const { data: executions, loading: execsLoading } = useFetch<Execution[]>(
    () => api.executions.list() as Promise<Execution[]>
  );

  const { data: report, loading: reportLoading } = useFetch(
    () => execId ? api.reports.get(execId) as Promise<any> : Promise.resolve(null),
    [execId]
  );

  const filtered = (executions || []).filter(e => {
    const matchSearch = e.specName.toLowerCase().includes(search.toLowerCase()) ||
      e.environment.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || e.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const handleExportPdf = () => {
    const content = `PerfOps Execution Report
========================
Execution ID: ${execId}
Test Name: ${report?.execution?.specName}
Status: ${report?.execution?.status?.toUpperCase()}
Environment: ${report?.execution?.environment}
Started: ${report?.execution?.startedAt}
P95: ${report?.metrics?.p95}ms
P50: ${report?.metrics?.p50}ms
Error Rate: ${(report?.metrics?.errorRate * 100).toFixed(2)}%
RPS: ${report?.metrics?.rps}
`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${execId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    addToast('Report URL copied to clipboard', 'success');
  };

  if (execId) {
    // Report detail view
    if (reportLoading) {
      return (
        <div className="p-6">
          <div className="h-8 bg-gray-200 rounded w-48 animate-pulse mb-6" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[1,2,3,4].map(i => <div key={i} className="h-24 bg-gray-100 rounded-lg animate-pulse" />)}
          </div>
        </div>
      );
    }

    if (!report) {
      return <div className="p-6 text-red-600">Report not found</div>;
    }

    const { execution, metrics, thresholdResults, checkResults, responseTimeSeries } = report as any;

    return (
      <div className="p-6">
        <ToastContainer toasts={toasts} onRemove={removeToast} />
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSearchParams({})}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{execution.specName}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <StatusBadge status={execution.status} />
                <span className="text-sm text-gray-500">{execution.environment}</span>
                <span className="text-sm text-gray-400">·</span>
                <span className="text-sm text-gray-500">
                  {execution.startedAt ? new Date(execution.startedAt).toLocaleString() : ''}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
            >
              <Share2 size={14} /> Share
            </button>
            <button
              onClick={handleExportPdf}
              className="flex items-center gap-1.5 px-3 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600"
            >
              <Download size={14} /> Export
            </button>
          </div>
        </div>

        {/* Executive Summary */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 mb-6">
          <h3 className="font-semibold text-gray-800 mb-3">Executive Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="md:col-span-2"><span className="text-gray-500">Test Name:</span> <span className="font-medium">{execution.specName}</span></div>
            <div><span className="text-gray-500">Duration:</span> <span className="font-medium">{execution.duration}s</span></div>
            <div><span className="text-gray-500">Max VUs:</span> <span className="font-medium">{metrics?.maxVUs}</span></div>
            <div><span className="text-gray-500">Total Requests:</span> <span className="font-medium">{metrics?.totalRequests?.toLocaleString()}</span></div>
            <div><span className="text-gray-500">Threshold Breaches:</span> <span className={`font-medium ${execution.thresholdBreaches > 0 ? 'text-red-600' : 'text-green-600'}`}>{execution.thresholdBreaches}</span></div>
            <div><span className="text-gray-500">Triggered by:</span> <span className="font-medium">{execution.triggeredBy}</span></div>
            <div><span className="text-gray-500">Checks Passed:</span> <span className="font-medium text-green-600">{execution.checksPassed}</span></div>
            <div><span className="text-gray-500">Checks Failed:</span> <span className={`font-medium ${execution.checksFailed > 0 ? 'text-red-600' : 'text-green-600'}`}>{execution.checksFailed}</span></div>
          </div>
        </div>

        {/* Metric Cards */}
        {metrics && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
            <MetricCard label="P50" value={`${metrics.p50}ms`} status="neutral" />
            <MetricCard label="P90" value={`${metrics.p90}ms`} status="neutral" />
            <MetricCard label="P95" value={`${metrics.p95}ms`} status={metrics.p95 < 500 ? 'pass' : 'fail'} />
            <MetricCard label="P99" value={metrics.p99 ? `${metrics.p99}ms` : 'N/A'} status="neutral" />
            <MetricCard label="Error Rate" value={`${(metrics.errorRate * 100).toFixed(2)}%`} status={metrics.errorRate < 0.01 ? 'pass' : 'fail'} />
            <MetricCard label="RPS" value={`${metrics.rps}`} status="neutral" sublabel="req/sec" />
          </div>
        )}

        {/* Response Time Chart */}
        {responseTimeSeries && responseTimeSeries.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 mb-6">
            <h3 className="font-semibold text-gray-800 mb-4">Response Time Over Test Duration</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={responseTimeSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="ms" />
                <Tooltip formatter={(v: number) => [`${v}ms`]} />
                <Legend />
                <Line type="monotone" dataKey="p95" stroke="#2563EB" strokeWidth={2} dot={false} name="P95" />
                <Line type="monotone" dataKey="p50" stroke="#60A5FA" strokeWidth={2} dot={false} name="P50" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Thresholds + Checks */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Threshold Results */}
          {thresholdResults && thresholdResults.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
              <h3 className="font-semibold text-gray-800 mb-4">Threshold Results</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left pb-2 text-xs font-medium text-gray-500 uppercase">Metric</th>
                    <th className="text-left pb-2 text-xs font-medium text-gray-500 uppercase">Condition</th>
                    <th className="text-left pb-2 text-xs font-medium text-gray-500 uppercase">Actual</th>
                    <th className="text-left pb-2 text-xs font-medium text-gray-500 uppercase">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {thresholdResults.map((t: any, i: number) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-2.5 font-mono text-xs">{t.metric}</td>
                      <td className="py-2.5 font-mono text-xs">{t.condition}</td>
                      <td className="py-2.5 text-xs">{t.actual}</td>
                      <td className="py-2.5">
                        {t.passed
                          ? <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle size={12} /> Pass</span>
                          : <span className="flex items-center gap-1 text-red-600 text-xs"><XCircle size={12} /> Fail</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Check Results */}
          {checkResults && checkResults.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
              <h3 className="font-semibold text-gray-800 mb-4">Check Results</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left pb-2 text-xs font-medium text-gray-500 uppercase">Check</th>
                    <th className="text-left pb-2 text-xs font-medium text-gray-500 uppercase">Pass Rate</th>
                    <th className="text-left pb-2 text-xs font-medium text-gray-500 uppercase">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {checkResults.map((c: any, i: number) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-2.5 text-xs">{c.name}</td>
                      <td className="py-2.5 text-xs">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-200 rounded-full h-1.5 w-24">
                            <div
                              className={`h-1.5 rounded-full ${c.passRate >= 95 ? 'bg-green-500' : c.passRate >= 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                              style={{ width: `${c.passRate}%` }}
                            />
                          </div>
                          <span>{c.passRate.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="py-2.5">
                        {c.passed
                          ? <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle size={12} /> Pass</span>
                          : <span className="flex items-center gap-1 text-red-600 text-xs"><XCircle size={12} /> Fail</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Execution list view
  return (
    <div className="p-6">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-gray-500 text-sm mt-0.5">View execution history and reports</p>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by spec name or environment..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">All Statuses</option>
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
          <option value="running">Running</option>
          <option value="scheduled">Scheduled</option>
        </select>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {execsLoading ? (
          <div className="p-6"><LoadingSkeleton rows={8} /></div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Test Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Environment</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">P95</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Error Rate</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">SLO</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Triggered By</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Started</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Report</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(exec => (
                <tr
                  key={exec.id}
                  onClick={() => navigate(`/report/${exec.id}`)}
                  className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-sm text-gray-900">{exec.specName}</div>
                    <div className="text-xs text-gray-400">{exec.id}</div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={exec.status} /></td>
                  <td className="px-4 py-3 text-sm text-gray-600">{exec.environment}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-800">
                    {exec.metrics?.p95 ? `${exec.metrics.p95}ms` : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {exec.metrics?.errorRate != null
                      ? `${exec.metrics.errorRate.toFixed(2)}%`
                      : '—'
                    }
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const sr = (exec as any).sloResults;
                      if (!sr?.results?.length) return <span className="text-xs text-gray-400">—</span>;
                      const passed = sr.results.filter((r: any) => r.passed).length;
                      const total  = sr.results.length;
                      return (
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${sr.overall === 'pass' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {sr.overall === 'pass' ? '✓' : '✗'} {passed}/{total}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{exec.triggeredBy}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {exec.startedAt ? new Date(exec.startedAt).toLocaleString() : exec.scheduledFor ? `Scheduled: ${new Date(exec.scheduledFor).toLocaleString()}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/report/${exec.id}`}
                      onClick={e => e.stopPropagation()}
                      className="text-xs text-brand-500 hover:text-brand-600 font-semibold"
                    >
                      View Report →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
