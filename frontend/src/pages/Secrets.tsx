import React, { useState } from 'react';
import { Plus, Trash2, CheckCircle, AlertTriangle, Clock, Wifi } from 'lucide-react';
import { useFetch } from '../hooks/useFetch';
import { api } from '../lib/api';
import { Secret } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ToastContainer';

const DEFAULT_SECRET = {
  name: '',
  backend: 'vault' as const,
  backendPath: '',
  environments: [] as string[],
  expiresAt: '',
};

const BACKEND_LABELS: Record<string, string> = {
  vault: 'HashiCorp Vault',
  'aws-secretsmanager': 'AWS Secrets Manager',
  env: 'Environment Variable',
  'azure-keyvault': 'Azure Key Vault',
};

export const Secrets: React.FC = () => {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(DEFAULT_SECRET);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const { toasts, addToast, removeToast } = useToast();

  const { data: secrets, loading, refetch } = useFetch<Secret[]>(
    () => api.secrets.list() as Promise<Secret[]>
  );

  const handleCreate = async () => {
    if (!form.name.trim()) { addToast('Name required', 'error'); return; }
    setSaving(true);
    try {
      await api.secrets.create(form);
      refetch();
      addToast('Secret reference created', 'success');
      setShowAdd(false);
      setForm(DEFAULT_SECRET);
    } catch (e: any) {
      addToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this secret reference?')) return;
    try {
      await api.secrets.delete(id);
      refetch();
      addToast('Secret deleted', 'success');
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    try {
      const result: any = await api.secrets.testConnection(id);
      addToast(result.message, 'success');
    } catch (e: any) {
      addToast(e.message, 'error');
    } finally {
      setTestingId(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <CheckCircle size={14} className="text-green-500" />;
      case 'expiring-soon': return <AlertTriangle size={14} className="text-amber-500" />;
      case 'expired': return <AlertTriangle size={14} className="text-red-500" />;
      default: return <Clock size={14} className="text-gray-400" />;
    }
  };

  const isExpiringSoon = (secret: Secret) => {
    if (!secret.expiresAt) return false;
    const diff = new Date(secret.expiresAt).getTime() - Date.now();
    return diff < 30 * 24 * 60 * 60 * 1000 && diff > 0;
  };

  return (
    <div className="p-6">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Secrets Management</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage secret references — values are never stored</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600"
        >
          <Plus size={16} /> Add Secret
        </button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 flex items-start gap-3">
        <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-amber-800">
          <strong>Security Notice:</strong> PerfOps stores only references to secrets, never their actual values.
          Secret values are resolved at runtime from your configured backend (Vault, AWS Secrets Manager, etc.)
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6"><LoadingSkeleton rows={5} /></div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Backend</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Scope</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Last Rotated</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Expires</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(secrets || []).map(secret => (
                <tr key={secret.id} className={`border-b border-gray-100 hover:bg-gray-50 ${isExpiringSoon(secret) ? 'bg-amber-50/30' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(secret.status)}
                      <span className="font-mono text-sm font-medium text-gray-900">{secret.name}</span>
                    </div>
                    <div className="text-xs text-gray-400 font-mono ml-5">{secret.backendPath}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {BACKEND_LABELS[secret.backend] || secret.backend}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {secret.environments.map(env => (
                        <span key={env} className="bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded">
                          {env}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {secret.lastRotated ? new Date(secret.lastRotated).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {secret.expiresAt ? (
                      <span className={isExpiringSoon(secret) ? 'text-amber-600 font-medium' : 'text-gray-500'}>
                        {new Date(secret.expiresAt).toLocaleDateString()}
                        {isExpiringSoon(secret) && ' ⚠'}
                      </span>
                    ) : (
                      <span className="text-gray-400">Never</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={secret.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleTestConnection(secret.id)}
                        disabled={testingId === secret.id}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 border border-blue-200 rounded hover:bg-blue-50 disabled:opacity-50"
                      >
                        {testingId === secret.id ? (
                          <span className="w-3 h-3 border border-blue-600 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Wifi size={11} />
                        )}
                        Test
                      </button>
                      <button
                        onClick={() => handleDelete(secret.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
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

      {/* Add Secret Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowAdd(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">Add Secret Reference</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Secret Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
                  placeholder="api_token"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Backend Type</label>
                <select
                  value={form.backend}
                  onChange={e => setForm(f => ({ ...f, backend: e.target.value as any }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="vault">HashiCorp Vault</option>
                  <option value="aws-secretsmanager">AWS Secrets Manager</option>
                  <option value="env">Environment Variable</option>
                  <option value="azure-keyvault">Azure Key Vault</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Backend Path</label>
                <input
                  type="text"
                  value={form.backendPath}
                  onChange={e => setForm(f => ({ ...f, backendPath: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="secret/ptaas/api_token"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Environments</label>
                <div className="flex flex-wrap gap-2">
                  {['DEV', 'QA', 'STAGE', 'PROD'].map(env => (
                    <label key={env} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.environments.includes(env)}
                        onChange={e => {
                          setForm(f => ({
                            ...f,
                            environments: e.target.checked
                              ? [...f.environments, env]
                              : f.environments.filter(x => x !== env),
                          }));
                        }}
                        className="rounded"
                      />
                      <span className="text-sm">{env}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expiry Date (optional)</label>
                <input
                  type="date"
                  value={form.expiresAt}
                  onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
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
                onClick={handleCreate}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Create Reference'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
