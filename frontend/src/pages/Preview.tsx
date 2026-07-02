import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, ArrowLeft } from 'lucide-react';
import { CodePanel } from '../components/CodePanel';
import { useFetch } from '../hooks/useFetch';
import { api } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ToastContainer';

export const Preview: React.FC = () => {
  const { specId } = useParams<{ specId: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'json' | 'k6'>('json');
  const [running, setRunning] = useState(false);
  const { toasts, addToast, removeToast } = useToast();

  const { data: jsonSpec, loading: jsonLoading } = useFetch(
    () => api.testSpecs.previewJson(specId!) as Promise<unknown>,
    [specId]
  );

  const { data: k6Script, loading: k6Loading } = useFetch(
    () => api.testSpecs.previewK6(specId!),
    [specId]
  );

  const handleRun = async () => {
    if (!specId) return;
    setRunning(true);
    try {
      const exec: any = await api.executions.trigger({ specId });
      addToast(`Execution started: ${exec.id}`, 'success');
      navigate(`/reports?exec=${exec.id}`);
    } catch (e: any) {
      addToast(e.message, 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-6">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Test Preview</h1>
            <p className="text-gray-500 text-sm">Spec ID: {specId}</p>
          </div>
        </div>
        <button
          onClick={handleRun}
          disabled={running}
          className="flex items-center gap-2 bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
        >
          {running ? (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Play size={14} />
          )}
          {running ? 'Starting...' : 'Run This Test'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {(['json', 'k6'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'json' ? 'JSON Spec' : 'K6 Script'}
          </button>
        ))}
      </div>

      {tab === 'json' && (
        jsonLoading ? (
          <div className="bg-gray-900 rounded-lg p-6 animate-pulse">
            <div className="h-4 bg-gray-700 rounded w-1/3 mb-2" />
            <div className="h-4 bg-gray-700 rounded w-1/2 mb-2" />
            <div className="h-4 bg-gray-700 rounded w-2/3" />
          </div>
        ) : (
          <CodePanel
            language="json"
            code={JSON.stringify(jsonSpec, null, 2)}
            filename="spec.json"
            maxHeight="calc(100vh - 200px)"
          />
        )
      )}
      {tab === 'k6' && (
        k6Loading ? (
          <div className="bg-gray-900 rounded-lg p-6 animate-pulse">
            <div className="h-4 bg-gray-700 rounded w-1/2 mb-2" />
            <div className="h-4 bg-gray-700 rounded w-2/3 mb-2" />
            <div className="h-4 bg-gray-700 rounded w-1/3" />
          </div>
        ) : (
          <CodePanel
            language="javascript"
            code={k6Script || '// Failed to generate script'}
            filename="test.k6.js"
            maxHeight="calc(100vh - 200px)"
          />
        )
      )}
    </div>
  );
};
