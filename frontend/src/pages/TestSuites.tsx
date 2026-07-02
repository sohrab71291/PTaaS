import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus, Search, Edit2, Trash2, Play, FileText, Code2,
  Layers, Clock, Tag, ChevronRight, AlertCircle,
} from 'lucide-react';
import { useFetch } from '../hooks/useFetch';
import { api } from '../lib/api';
import { TestSpec } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ToastContainer';
import { useExecution, StageName, StageState } from '../contexts/ExecutionContext';

// ─── Pipeline progress bar ──────────────────────────────────────────────────

const PIPELINE_STAGES: { key: StageName; label: string }[] = [
  { key: 'script_generation', label: 'Script Generation' },
  { key: 'script_execution',  label: 'Script Execution' },
  { key: 'postgres',          label: 'PostgreSQL Updated' },
  { key: 'influx',            label: 'InfluxDB Updated' },
  { key: 'grafana',           label: 'Published to Grafana' },
];

const dotClass = (state: StageState) => {
  if (state === 'done') return 'bg-green-500';
  if (state === 'in_progress') return 'bg-blue-500 animate-pulse';
  if (state === 'error') return 'bg-red-500';
  if (state === 'skipped') return 'bg-gray-300';
  return 'bg-gray-200';
};

const PipelineProgress: React.FC<{ stages: Record<StageName, StageState> }> = ({ stages }) => (
  <div className="px-5 py-3 border-t border-gray-100">
    <div className="flex items-center">
      {PIPELINE_STAGES.map((s, i) => (
        <React.Fragment key={s.key}>
          <div className="flex flex-col items-center gap-1 w-0 grow" title={s.label}>
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotClass(stages[s.key])}`} />
            <span className="text-[10px] text-gray-500 text-center leading-tight truncate w-full">{s.label}</span>
          </div>
          {i < PIPELINE_STAGES.length - 1 && (
            <div className={`h-0.5 flex-1 -mt-4 ${
              stages[PIPELINE_STAGES[i + 1].key] !== 'pending' || stages[s.key] === 'done'
                ? 'bg-green-300' : 'bg-gray-200'
            }`} />
          )}
        </React.Fragment>
      ))}
    </div>
  </div>
);

// ─── Delete confirmation modal ─────────────────────────────────────────────

const DeleteModal: React.FC<{
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ name, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
          <AlertCircle size={20} className="text-red-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Delete Test Suite</h2>
          <p className="text-sm text-gray-600 mt-1">
            Are you sure you want to delete <span className="font-medium text-gray-900">"{name}"</span>? This action cannot be undone.
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
        >
          Delete Suite
        </button>
      </div>
    </div>
  </div>
);

// ─── Suite card ────────────────────────────────────────────────────────────

const SuiteCard: React.FC<{
  spec: TestSpec;
  envName?: string;
  onEdit: () => void;
  onDelete: () => void;
  onRun: () => void;
}> = ({ spec, envName, onEdit, onDelete, onRun }) => {
  const { specId: liveSpecId, stages: liveStages, status: liveStatus } = useExecution();
  const isLive = liveSpecId === spec.id && liveStatus !== 'idle';

  const idlePipelineStages: Record<StageName, StageState> = spec.lastRunStatus
    ? { script_generation: 'done', script_execution: 'done', postgres: 'done', influx: 'done', grafana: 'done' }
    : { script_generation: spec.generatedScript ? 'done' : 'pending', script_execution: 'pending', postgres: 'pending', influx: 'pending', grafana: 'pending' };

  const pipelineStages = isLive ? liveStages : idlePipelineStages;

  const lp = spec.loadProfile;
  const profileSummary =
    lp.type === 'constant'
      ? `Constant · ${lp.stages[0]?.target ?? '—'} VUs`
      : lp.type === 'arrival-rate'
      ? `Arrival Rate · ${lp.stages.length} stage${lp.stages.length !== 1 ? 's' : ''}`
      : `Staged · ${lp.stages.length} stage${lp.stages.length !== 1 ? 's' : ''}`;

  const totalDuration = lp.stages.reduce((sum, s) => {
    const match = s.duration.match(/^(\d+(?:\.\d+)?)(s|m|h)$/);
    if (!match) return sum;
    const n = parseFloat(match[1]);
    const unit = match[2];
    return sum + (unit === 's' ? n : unit === 'm' ? n * 60 : n * 3600);
  }, 0);

  const formatDuration = (secs: number) => {
    if (secs >= 3600) return `${(secs / 3600).toFixed(1)}h`;
    if (secs >= 60) return `${Math.round(secs / 60)}m`;
    return `${secs}s`;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
      {/* Card header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-gray-900 truncate">{spec.name}</h3>
            {spec.lastRunStatus
              ? <StatusBadge status={spec.lastRunStatus} />
              : <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Never run</span>
            }
            {spec.generatedScript && (
              <span className="flex items-center gap-1 text-xs text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">
                <Code2 size={10} /> Script saved
              </span>
            )}
          </div>
          {spec.description && (
            <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{spec.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onRun}
            title="Run"
            className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
          >
            <Play size={15} />
          </button>
          <button
            onClick={onEdit}
            title="Edit"
            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
          >
            <Edit2 size={15} />
          </button>
          <button
            onClick={onDelete}
            title="Delete"
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Card body */}
      <div className="px-5 py-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-gray-600">
        <div className="flex items-center gap-1.5">
          <Layers size={12} className="text-gray-400 shrink-0" />
          <span>{profileSummary}</span>
          {totalDuration > 0 && (
            <span className="text-gray-400">· {formatDuration(totalDuration)}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <FileText size={12} className="text-gray-400 shrink-0" />
          <span className="truncate">{envName || spec.environmentId || 'No environment'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock size={12} className="text-gray-400 shrink-0" />
          <span>
            {spec.lastRunAt
              ? `Last run ${new Date(spec.lastRunAt).toLocaleDateString()}`
              : `Created ${new Date(spec.createdAt).toLocaleDateString()}`}
          </span>
        </div>
        {spec.tags.length > 0 && (
          <div className="flex items-center gap-1.5 min-w-0">
            <Tag size={12} className="text-gray-400 shrink-0" />
            <div className="flex gap-1 flex-wrap">
              {spec.tags.slice(0, 3).map(t => (
                <span key={t} className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{t}</span>
              ))}
              {spec.tags.length > 3 && (
                <span className="text-gray-400">+{spec.tags.length - 3}</span>
              )}
            </div>
          </div>
        )}
      </div>

      <PipelineProgress stages={pipelineStages} />

      {/* Request summary */}
      <div className="px-5 py-2.5 bg-gray-50 rounded-b-xl border-t border-gray-100 flex items-center gap-2 text-xs">
        <span className={`font-mono font-bold px-1.5 py-0.5 rounded ${
          spec.request.method === 'GET' ? 'bg-green-100 text-green-700' :
          spec.request.method === 'POST' ? 'bg-blue-100 text-blue-700' :
          spec.request.method === 'PUT' ? 'bg-yellow-100 text-yellow-700' :
          spec.request.method === 'DELETE' ? 'bg-red-100 text-red-700' :
          'bg-gray-100 text-gray-700'
        }`}>{spec.request.method}</span>
        <span className="text-gray-500 font-mono truncate">{spec.request.url}</span>
        <ChevronRight size={12} className="text-gray-300 shrink-0 ml-auto" />
      </div>
    </div>
  );
};

// ─── Main page ─────────────────────────────────────────────────────────────

export const TestSuites: React.FC = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [profileFilter, setProfileFilter] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState<TestSpec | null>(null);
  const { toasts, addToast, removeToast } = useToast();
  const { status: execStatus } = useExecution();

  const { data: specs, loading, error, refetch } = useFetch<TestSpec[]>(
    () => api.testSpecs.list() as Promise<TestSpec[]>
  );

  // Re-fetch suites so the status badge (lastRunStatus) and "Created"/"Last run"
  // date pick up the result of a run that just finished — the run itself may
  // have been started from the Executor page, so this page's data is stale
  // until we explicitly refresh it.
  const prevExecStatusRef = React.useRef(execStatus);
  React.useEffect(() => {
    const prev = prevExecStatusRef.current;
    prevExecStatusRef.current = execStatus;
    if (prev !== execStatus && (execStatus === 'complete' || execStatus === 'error' || execStatus === 'stopped')) {
      refetch();
    }
  }, [execStatus, refetch]);

  const { data: environments } = useFetch(
    () => api.environments.list() as Promise<any[]>
  );

  const envName = (spec: TestSpec) =>
    environments?.find((e: any) => e.id === spec.environmentId)?.name || null;

  const filtered = (specs || []).filter(s => {
    const matchSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.description || '').toLowerCase().includes(search.toLowerCase()) ||
      s.tags.some(t => t.toLowerCase().includes(search.toLowerCase()));
    const matchProfile = profileFilter === 'all' || s.loadProfile.type === profileFilter;
    return matchSearch && matchProfile;
  });

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.testSpecs.delete(deleteTarget.id);
      refetch();
      addToast(`"${deleteTarget.name}" deleted`, 'success');
    } catch (e: any) {
      addToast(e.message, 'error');
    } finally {
      setDeleteTarget(null);
    }
  };

  const handlePlayToExecutor = (spec: TestSpec) => {
    const specAny = spec as any;
    if (specAny.generatedScript) {
      sessionStorage.setItem('generatedK6Script', specAny.generatedScript);
    } else {
      sessionStorage.removeItem('generatedK6Script');
    }
    sessionStorage.setItem('generatedK6ScriptName', spec.name);
    sessionStorage.setItem('generatedK6ScriptSpecId', spec.id);
    sessionStorage.setItem('generatedK6ScriptMeta', JSON.stringify({
      method: spec.request.method,
      url: spec.request.url,
      specId: spec.id,
    }));
    const slos = specAny.slos ?? [];
    if (slos.length) sessionStorage.setItem('generatedK6ScriptSlos', JSON.stringify(slos));
    else sessionStorage.removeItem('generatedK6ScriptSlos');
    navigate('/executor');
  };

  return (
    <div className="p-6">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {deleteTarget && (
        <DeleteModal
          name={deleteTarget.name}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Test Suites</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            All saved test suites — edit, run, or delete from here
          </p>
        </div>
        <Link
          to="/tests/new"
          className="flex items-center gap-2 bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600"
        >
          <Plus size={16} />
          New Suite
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, description, or tag..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <select
          value={profileFilter}
          onChange={e => setProfileFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">All Profiles</option>
          <option value="staged">Staged</option>
          <option value="constant">Constant</option>
          <option value="arrival-rate">Arrival Rate</option>
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <LoadingSkeleton rows={4} />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-600 text-sm">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-xl border border-gray-200">
          <Layers size={44} className="text-gray-200 mb-4" />
          <h3 className="text-gray-700 font-semibold mb-1">No test suites found</h3>
          <p className="text-gray-500 text-sm mb-5">
            {search || profileFilter !== 'all'
              ? 'Try adjusting your filters.'
              : 'Save a test in Test Authoring to create your first suite.'}
          </p>
          {!search && profileFilter === 'all' && (
            <Link
              to="/tests/new"
              className="flex items-center gap-2 bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600"
            >
              <Plus size={14} /> Create Test Suite
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(spec => (
            <SuiteCard
              key={spec.id}
              spec={spec}
              envName={envName(spec) ?? undefined}
              onEdit={() => navigate(`/tests/${spec.id}/edit`)}
              onDelete={() => setDeleteTarget(spec)}
              onRun={() => handlePlayToExecutor(spec)}
            />
          ))}
        </div>
      )}

      {!loading && !error && specs && (
        <p className="mt-4 text-xs text-gray-400">
          Showing {filtered.length} of {specs.length} suite{specs.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
};
