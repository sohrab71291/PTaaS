import React, { useState } from 'react';
import { Plus, Edit, Trash2, Lock, Globe, Key, Activity } from 'lucide-react';
import { useFetch } from '../hooks/useFetch';
import { api } from '../lib/api';
import { Environment } from '../types';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ToastContainer';

const ENV_COLORS: Record<string, string> = {
  DEV: 'bg-green-100 text-green-800',
  QA: 'bg-blue-100 text-blue-800',
  STAGE: 'bg-orange-100 text-orange-800',
  PROD: 'bg-red-100 text-red-800',
};

const DEFAULT_ENV = {
  name: '',
  baseUrl: '',
  variables: [] as { key: string; value: string }[],
  secrets: [] as string[],
  requiresApproval: false,
};

export const Environments: React.FC = () => {
  const [editEnv, setEditEnv] = useState<Environment | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(DEFAULT_ENV);
  const [saving, setSaving] = useState(false);
  const { toasts, addToast, removeToast } = useToast();

  const { data: envs, loading, refetch } = useFetch<Environment[]>(
    () => api.environments.list() as Promise<Environment[]>
  );

  const handleSave = async () => {
    if (!form.name.trim()) { addToast('Name required', 'error'); return; }
    setSaving(true);
    try {
      if (editEnv) {
        await api.environments.update(editEnv.id, form);
        addToast('Environment updated', 'success');
      } else {
        await api.environments.create(form);
        addToast('Environment created', 'success');
      }
      refetch();
      setShowAdd(false);
      setEditEnv(null);
      setForm(DEFAULT_ENV);
    } catch (e: any) {
      addToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (env: Environment) => {
    setEditEnv(env);
    setForm({
      name: env.name,
      baseUrl: env.baseUrl,
      variables: env.variables,
      secrets: env.secrets,
      requiresApproval: env.requiresApproval,
    });
    setShowAdd(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this environment?')) return;
    try {
      await api.environments.delete(id);
      refetch();
      addToast('Environment deleted', 'success');
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  return (
    <div className="p-6">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Environments</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage test target environments</p>
        </div>
        <button
          onClick={() => { setEditEnv(null); setForm(DEFAULT_ENV); setShowAdd(true); }}
          className="flex items-center gap-2 bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600"
        >
          <Plus size={16} /> Add Environment
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-gray-100 rounded-xl h-48 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(envs || []).map(env => (
            <div key={env.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-bold ${ENV_COLORS[env.name] || 'bg-gray-100 text-gray-800'}`}>
                    {env.name}
                  </span>
                  {env.requiresApproval && (
                    <span className="flex items-center gap-1 bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-xs font-medium">
                      <Lock size={10} /> Requires Approval
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleEdit(env)}
                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                  >
                    <Edit size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(env.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2 text-gray-600">
                  <Globe size={13} className="text-gray-400" />
                  <span className="font-mono text-xs">{env.baseUrl}</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5 text-gray-500">
                    <div className="w-2 h-2 rounded-full bg-blue-400" />
                    <span className="text-xs">{env.variables.length} variables</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-500">
                    <Key size={11} className="text-gray-400" />
                    <span className="text-xs">{env.secrets.length} secrets</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-500">
                    <Activity size={11} className="text-gray-400" />
                    <span className="text-xs">{env.executionCount} executions</span>
                  </div>
                </div>
                {env.variables.length > 0 && (
                  <div className="pt-2 border-t border-gray-100">
                    <div className="text-xs text-gray-400 mb-1.5">Variables</div>
                    <div className="space-y-1">
                      {env.variables.slice(0, 3).map(v => (
                        <div key={v.key} className="flex items-center justify-between text-xs">
                          <span className="font-mono text-gray-600">{v.key}</span>
                          <span className="text-gray-500">{v.value}</span>
                        </div>
                      ))}
                      {env.variables.length > 3 && (
                        <div className="text-xs text-gray-400">+{env.variables.length - 3} more</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowAdd(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">{editEnv ? 'Edit Environment' : 'Add Environment'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="e.g. DEV, QA, STAGE, PROD"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
                <input
                  type="url"
                  value={form.baseUrl}
                  onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="https://api.example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Variables (KEY=VALUE per line)</label>
                <textarea
                  value={form.variables.map(v => `${v.key}=${v.value}`).join('\n')}
                  onChange={e => {
                    const vars = e.target.value.split('\n').filter(Boolean).map(line => {
                      const [key, ...rest] = line.split('=');
                      return { key: key.trim(), value: rest.join('=').trim() };
                    });
                    setForm(f => ({ ...f, variables: vars }));
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 h-24 resize-none"
                  placeholder="TIMEOUT=30000&#10;LOG_LEVEL=info"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="requiresApproval"
                  checked={form.requiresApproval}
                  onChange={e => setForm(f => ({ ...f, requiresApproval: e.target.checked }))}
                  className="rounded"
                />
                <label htmlFor="requiresApproval" className="text-sm text-gray-700 flex items-center gap-1">
                  <Lock size={13} className="text-amber-500" /> Requires Approval
                </label>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAdd(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
