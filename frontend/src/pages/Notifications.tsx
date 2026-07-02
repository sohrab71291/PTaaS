import React, { useState, useEffect } from 'react';
import {
  Bell, Plus, Trash2, Edit2, X, Loader2,
  Mail, MessageSquare, CheckCircle, XCircle, Send,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ToastContainer';
import { Sidebar } from '../components/Sidebar';

interface NotificationConfig {
  id: string;
  name: string;
  type: 'email' | 'teams';
  trigger: 'always' | 'on_failure' | 'on_success';
  emailRecipients: string[];
  teamsWebhookUrl: string | null;
  enabled: boolean;
  createdAt: string;
}

const TRIGGER_LABELS: Record<string, string> = {
  always: 'Always',
  on_failure: 'On Failure',
  on_success: 'On Success',
};

const TRIGGER_COLORS: Record<string, string> = {
  always: 'bg-blue-100 text-blue-700',
  on_failure: 'bg-red-100 text-red-700',
  on_success: 'bg-green-100 text-green-700',
};

const emptyForm = {
  name: '',
  type: 'email' as 'email' | 'teams',
  trigger: 'always' as 'always' | 'on_failure' | 'on_success',
  emailRecipients: [] as string[],
  teamsWebhookUrl: '',
  enabled: true,
};

const NotificationModal: React.FC<{
  config?: NotificationConfig | null;
  onClose: () => void;
  onSaved: (c: NotificationConfig) => void;
}> = ({ config, onClose, onSaved }) => {
  const [form, setForm] = useState(config ? {
    name: config.name,
    type: config.type,
    trigger: config.trigger,
    emailRecipients: config.emailRecipients,
    teamsWebhookUrl: config.teamsWebhookUrl || '',
    enabled: config.enabled,
  } : emptyForm);
  const [emailInput, setEmailInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const addEmail = () => {
    const trimmed = emailInput.trim();
    if (!trimmed || form.emailRecipients.includes(trimmed)) return;
    setForm(f => ({ ...f, emailRecipients: [...f.emailRecipients, trimmed] }));
    setEmailInput('');
  };

  const removeEmail = (email: string) => {
    setForm(f => ({ ...f, emailRecipients: f.emailRecipients.filter(e => e !== email) }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const body = {
        ...form,
        teamsWebhookUrl: form.teamsWebhookUrl || null,
      };
      const saved = config
        ? await (api as any).notifications.update(config.id, body)
        : await (api as any).notifications.create(body);
      onSaved(saved);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">
            {config ? 'Edit Alert' : 'New Notification Alert'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600 mb-4">{error}</div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Alert Name</label>
            <input
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="Failure Alerts to QA Team"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Channel</label>
            <div className="grid grid-cols-2 gap-2">
              {(['email', 'teams'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, type: t }))}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                    form.type === t
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {t === 'email' ? <Mail size={16} /> : <MessageSquare size={16} />}
                  {t === 'email' ? 'Email' : 'Microsoft Teams'}
                </button>
              ))}
            </div>
          </div>

          {form.type === 'email' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Recipients</label>
              <div className="flex gap-2 mb-2">
                <input
                  type="email"
                  value={emailInput}
                  onChange={e => setEmailInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } }}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="user@example.com"
                />
                <button
                  type="button"
                  onClick={addEmail}
                  className="px-3 py-2 bg-brand-500 text-white text-sm rounded-lg hover:bg-brand-600"
                >
                  Add
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {form.emailRecipients.map(email => (
                  <span key={email} className="flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full">
                    {email}
                    <button type="button" onClick={() => removeEmail(email)} className="hover:text-red-500">
                      <X size={11} />
                    </button>
                  </span>
                ))}
                {form.emailRecipients.length === 0 && (
                  <p className="text-xs text-gray-400">No recipients added yet</p>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-2">Requires SMTP_HOST configured in backend .env</p>
            </div>
          )}

          {form.type === 'teams' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
              <input
                required
                type="url"
                value={form.teamsWebhookUrl}
                onChange={e => setForm(f => ({ ...f, teamsWebhookUrl: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="https://outlook.office.com/webhook/..."
              />
              <p className="text-xs text-gray-400 mt-1">Create an Incoming Webhook connector in your Teams channel</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Send When</label>
            <div className="grid grid-cols-3 gap-2">
              {(['always', 'on_failure', 'on_success'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, trigger: t }))}
                  className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                    form.trigger === t
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {TRIGGER_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white text-sm rounded-lg hover:bg-brand-600 disabled:opacity-50"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {config ? 'Save Changes' : 'Create Alert'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const Notifications: React.FC = () => {
  const [configs, setConfigs] = useState<NotificationConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<NotificationConfig | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const { toasts, addToast, removeToast } = useToast();

  useEffect(() => {
    (api as any).notifications.list()
      .then((data: NotificationConfig[]) => setConfigs(data))
      .finally(() => setLoading(false));
  }, []);

  const handleSaved = (c: NotificationConfig) => {
    setConfigs(prev => {
      const idx = prev.findIndex(x => x.id === c.id);
      return idx >= 0 ? prev.map(x => x.id === c.id ? c : x) : [c, ...prev];
    });
    setModalOpen(false);
    setEditing(null);
    addToast(editing ? 'Alert updated' : 'Alert created', 'success');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this notification config?')) return;
    await (api as any).notifications.delete(id);
    setConfigs(prev => prev.filter(c => c.id !== id));
    addToast('Alert deleted', 'success');
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      const result = await (api as any).notifications.test(id) as { ok: boolean; message: string };
      addToast(result.message, result.ok ? 'success' : 'error');
    } catch (err: any) {
      addToast(err.message, 'error');
    } finally {
      setTesting(null);
    }
  };

  const handleToggle = async (config: NotificationConfig) => {
    const updated = await (api as any).notifications.update(config.id, { enabled: !config.enabled });
    setConfigs(prev => prev.map(c => c.id === config.id ? updated : c));
    addToast(updated.enabled ? 'Alert enabled' : 'Alert disabled', 'success');
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 p-8 overflow-y-auto">
        <ToastContainer toasts={toasts} onRemove={removeToast} />

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Bell size={22} className="text-brand-500" /> Notification Alerts
            </h1>
            <p className="text-sm text-gray-500 mt-1">Send Email or Teams alerts when executions complete</p>
          </div>
          <button
            onClick={() => { setEditing(null); setModalOpen(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white text-sm rounded-lg hover:bg-brand-600"
          >
            <Plus size={15} /> New Alert
          </button>
        </div>

        {/* SMTP config hint */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-700 flex gap-3">
          <Mail size={16} className="flex-shrink-0 mt-0.5" />
          <div>
            <strong>Email setup:</strong> Add <code className="bg-blue-100 px-1 rounded">SMTP_HOST</code>, <code className="bg-blue-100 px-1 rounded">SMTP_PORT</code>, <code className="bg-blue-100 px-1 rounded">SMTP_USER</code>, <code className="bg-blue-100 px-1 rounded">SMTP_PASS</code> and <code className="bg-blue-100 px-1 rounded">SMTP_FROM</code> to <strong>backend/.env</strong> to enable email delivery.
            Teams alerts use webhook URLs and work out of the box.
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-400">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : configs.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Bell size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 font-medium">No notification alerts configured</p>
            <p className="text-sm text-gray-400 mt-1">Create an alert to get notified when executions finish.</p>
            <button
              onClick={() => setModalOpen(true)}
              className="mt-4 px-4 py-2 bg-brand-500 text-white text-sm rounded-lg hover:bg-brand-600"
            >
              Create First Alert
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {configs.map(c => (
              <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${c.type === 'email' ? 'bg-blue-100' : 'bg-purple-100'}`}>
                  {c.type === 'email'
                    ? <Mail size={18} className="text-blue-600" />
                    : <MessageSquare size={18} className="text-purple-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-gray-900">{c.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TRIGGER_COLORS[c.trigger]}`}>
                      {TRIGGER_LABELS[c.trigger]}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.enabled ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">
                    {c.type === 'email'
                      ? `Email → ${c.emailRecipients.join(', ') || 'No recipients'}`
                      : `Teams webhook configured`}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleTest(c.id)}
                    disabled={testing === c.id}
                    title="Send test notification"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40 transition-colors"
                  >
                    {testing === c.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                    Test
                  </button>
                  <button
                    onClick={() => handleToggle(c)}
                    title={c.enabled ? 'Disable' : 'Enable'}
                    className={`p-2 transition-colors ${c.enabled ? 'text-green-500 hover:text-gray-400' : 'text-gray-400 hover:text-green-500'}`}
                  >
                    {c.enabled ? <CheckCircle size={18} /> : <XCircle size={18} />}
                  </button>
                  <button
                    onClick={() => { setEditing(c); setModalOpen(true); }}
                    title="Edit"
                    className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(c.id)}
                    title="Delete"
                    className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {modalOpen && (
          <NotificationModal
            config={editing}
            onClose={() => { setModalOpen(false); setEditing(null); }}
            onSaved={handleSaved}
          />
        )}
      </main>
    </div>
  );
};
