import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, Edit, Copy, Play, FileText, Trash2, BarChart2, Sparkles } from 'lucide-react';
import { useFetch } from '../hooks/useFetch';
import { api } from '../lib/api';
import { TestSpec } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { RunConfirmModal } from '../components/RunConfirmModal';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ToastContainer';

export const TestSpecs: React.FC = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [runSpec, setRunSpec] = useState<TestSpec | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const { toasts, addToast, removeToast } = useToast();

  const { data: specs, loading, error, refetch } = useFetch<TestSpec[]>(
    () => api.testSpecs.list() as Promise<TestSpec[]>
  );

  const { data: environments } = useFetch(
    () => api.environments.list() as Promise<any[]>
  );

  const filtered = (specs || []).filter(s => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.tags.some(t => t.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = statusFilter === 'all' || s.lastRunStatus === statusFilter;
    return matchSearch && matchStatus;
  });

  const handleClone = async (spec: TestSpec) => {
    const clone = {
      ...spec,
      name: `${spec.name}_copy`,
      lastRunStatus: null,
      lastRunAt: null,
    };
    delete (clone as any).id;
    try {
      await api.testSpecs.create(clone);
      refetch();
      addToast('Test spec cloned successfully', 'success');
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this test spec?')) return;
    try {
      await api.testSpecs.delete(id);
      refetch();
      addToast('Test spec deleted', 'success');
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const handleRun = async () => {
    if (!runSpec) return;
    setRunLoading(true);
    try {
      const exec = await api.executions.trigger({ specId: runSpec.id }) as any;
      addToast(`Execution started: ${exec.id}`, 'success');
      navigate(`/reports?exec=${exec.id}`);
    } catch (e: any) {
      addToast(e.message, 'error');
    } finally {
      setRunLoading(false);
      setRunSpec(null);
    }
  };

  const getEnv = (spec: TestSpec) =>
    environments?.find((e: any) => e.id === spec.environmentId) || null;

  return (
    <div className="p-6">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      {runSpec && (
        <RunConfirmModal
          spec={runSpec}
          env={getEnv(runSpec)}
          onConfirm={handleRun}
          onCancel={() => setRunSpec(null)}
          loading={runLoading}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Test Specs Library</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage and run your performance test specifications</p>
        </div>
        <Link
          to="/tests/new?ai=true"
          className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700"
        >
          <Sparkles size={16} />
          Generate with AI →
        </Link>
        <Link
          to="/tests/new"
          className="flex items-center gap-2 bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600"
        >
          <Plus size={16} />
          New Test Spec
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or tag..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">All Statuses</option>
          <option value="pass">Passing</option>
          <option value="fail">Failing</option>
          <option value="running">Running</option>
          <option value="scheduled">Scheduled</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6"><LoadingSkeleton rows={5} /></div>
        ) : error ? (
          <div className="p-6 text-red-600">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText size={40} className="text-gray-300 mb-3" />
            <h3 className="text-gray-700 font-medium mb-1">No test specs found</h3>
            <p className="text-gray-500 text-sm mb-4">
              {search || statusFilter !== 'all' ? 'Try adjusting your filters.' : 'Create your first test spec to get started.'}
            </p>
            {!search && statusFilter === 'all' && (
              <Link
                to="/tests/new"
                className="flex items-center gap-2 bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600"
              >
                <Plus size={14} /> Create Test Spec
              </Link>
            )}
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Tags</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Last Run</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Environment</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(spec => (
                <tr key={spec.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 text-sm">{spec.name}</div>
                    {spec.description && (
                      <div className="text-xs text-gray-500 truncate max-w-xs">{spec.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {spec.tags.map(tag => (
                        <span key={tag} className="bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {spec.lastRunAt ? new Date(spec.lastRunAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {spec.lastRunStatus
                      ? <StatusBadge status={spec.lastRunStatus} />
                      : <span className="text-gray-400 text-xs">Never run</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    {environments && (
                      <span className="text-xs text-gray-700 font-medium">
                        {environments.find((e: any) => e.id === spec.environmentId)?.name || spec.environmentId}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        to={`/tests/${spec.id}/edit`}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                        title="Edit"
                      >
                        <Edit size={14} />
                      </Link>
                      <button
                        onClick={() => handleClone(spec)}
                        className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded"
                        title="Clone"
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        onClick={() => setRunSpec(spec)}
                        className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded"
                        title="Run"
                      >
                        <Play size={14} />
                      </button>
                      <Link
                        to={`/preview/${spec.id}`}
                        className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded"
                        title="Preview"
                      >
                        <FileText size={14} />
                      </Link>
                      <Link
                        to={`/reports`}
                        className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded"
                        title="View Reports"
                      >
                        <BarChart2 size={14} />
                      </Link>
                      <button
                        onClick={() => handleDelete(spec.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!loading && !error && (
        <div className="mt-2 text-xs text-gray-500">
          Showing {filtered.length} of {specs?.length || 0} test specs
        </div>
      )}
    </div>
  );
};
