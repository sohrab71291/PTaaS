import React, { useState, useEffect } from 'react';
import {
  Calendar, Plus, Trash2, Play, Edit2, X, Loader2,
  Clock, ToggleLeft, ToggleRight, Bell, Sliders,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ToastContainer';
import { Sidebar } from '../components/Sidebar';

interface Schedule {
  id: string;
  name: string;
  specId: string;
  environmentId: string | null;
  cronExpression: string;
  enabled: boolean;
  notificationConfigId: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

interface TestSpec {
  id: string;
  name: string;
}

interface Environment {
  id: string;
  name: string;
}

interface NotificationConfig {
  id: string;
  name: string;
  type: string;
}

// ─── Cron helpers ────────────────────────────────────────────────────────────

const PRESETS = [
  { label: 'Every 30 min',  cron: '*/30 * * * *' },
  { label: 'Every hour',    cron: '0 * * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Daily midnight',cron: '0 0 * * *' },
  { label: 'Daily 9 AM',    cron: '0 9 * * *' },
  { label: 'Weekly Mon 9AM',cron: '0 9 * * 1' },
];

// Custom builder → cron string
function buildCustomCron(custom: CustomTime): string {
  if (custom.mode === 'every-minutes') {
    const m = Math.max(1, Math.min(59, Number(custom.everyMinutes) || 5));
    return `*/${m} * * * *`;
  }
  if (custom.mode === 'every-hours') {
    const h = Math.max(1, Math.min(23, Number(custom.everyHours) || 1));
    return `0 */${h} * * *`;
  }
  // daily-at
  const h = Math.max(0, Math.min(23, Number(custom.atHour) || 0));
  const m = Math.max(0, Math.min(59, Number(custom.atMinute) || 0));
  return `${m} ${h} * * *`;
}

function describeCustom(custom: CustomTime): string {
  if (custom.mode === 'every-minutes') return `Every ${custom.everyMinutes || 5} minute(s)`;
  if (custom.mode === 'every-hours')   return `Every ${custom.everyHours || 1} hour(s)`;
  const hh = String(custom.atHour || 0).padStart(2, '0');
  const mm = String(custom.atMinute || 0).padStart(2, '0');
  return `Daily at ${hh}:${mm} UTC`;
}

interface CustomTime {
  mode: 'every-minutes' | 'every-hours' | 'daily-at';
  everyMinutes: number;
  everyHours: number;
  atHour: number;
  atMinute: number;
}

const defaultCustom: CustomTime = {
  mode: 'daily-at', everyMinutes: 15, everyHours: 2, atHour: 9, atMinute: 0,
};

// ─── Schedule Modal ───────────────────────────────────────────────────────────

const emptyForm = {
  name: '',
  specId: '',
  environmentId: '',
  cronExpression: '0 9 * * *',
  enabled: true,
  notificationConfigId: '',
};

type CronTab = 'presets' | 'custom' | 'raw';

const ScheduleModal: React.FC<{
  schedule?: Schedule | null;
  specs: TestSpec[];
  environments: Environment[];
  notifications: NotificationConfig[];
  onClose: () => void;
  onSaved: (s: Schedule) => void;
}> = ({ schedule, specs, environments, notifications, onClose, onSaved }) => {
  const [form, setForm] = useState(schedule ? {
    name: schedule.name,
    specId: schedule.specId,
    environmentId: schedule.environmentId || '',
    cronExpression: schedule.cronExpression,
    enabled: schedule.enabled,
    notificationConfigId: schedule.notificationConfigId || '',
  } : emptyForm);
  const [cronTab, setCronTab] = useState<CronTab>('presets');
  const [custom, setCustom] = useState<CustomTime>(defaultCustom);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Keep cron expression in sync when custom fields change
  useEffect(() => {
    if (cronTab === 'custom') {
      setForm(f => ({ ...f, cronExpression: buildCustomCron(custom) }));
    }
  }, [custom, cronTab]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const body = {
        ...form,
        environmentId: form.environmentId || null,
        notificationConfigId: form.notificationConfigId || null,
      };
      const saved = schedule
        ? await (api as any).schedules.update(schedule.id, body)
        : await (api as any).schedules.create(body);
      onSaved(saved);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const tabCls = (t: CronTab) =>
    `px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
      cronTab === t ? 'bg-brand-500 text-white' : 'text-gray-500 hover:bg-gray-100'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">
            {schedule ? 'Edit Schedule' : 'New Schedule'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600 mb-4">{error}</div>
        )}

        <form onSubmit={submit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Schedule Name</label>
            <input
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="Nightly Smoke Tests"
            />
          </div>

          {/* Test Spec */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Test Spec</label>
            <select
              required
              value={form.specId}
              onChange={e => setForm(f => ({ ...f, specId: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Select a test spec…</option>
              {specs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Environment */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Environment <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <select
              value={form.environmentId}
              onChange={e => setForm(f => ({ ...f, environmentId: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Use spec default</option>
              {environments.map(env => <option key={env.id} value={env.id}>{env.name}</option>)}
            </select>
          </div>

          {/* Cron Expression – tabbed */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">Schedule</label>
              <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                <button type="button" className={tabCls('presets')} onClick={() => setCronTab('presets')}>Presets</button>
                <button type="button" className={tabCls('custom')} onClick={() => setCronTab('custom')}>
                  <span className="flex items-center gap-1"><Sliders size={11} />Custom</span>
                </button>
                <button type="button" className={tabCls('raw')} onClick={() => setCronTab('raw')}>Raw</button>
              </div>
            </div>

            {/* Presets tab */}
            {cronTab === 'presets' && (
              <div className="flex flex-wrap gap-2">
                {PRESETS.map(p => (
                  <button
                    key={p.cron}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, cronExpression: p.cron }))}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      form.cronExpression === p.cron
                        ? 'bg-brand-500 text-white border-brand-500'
                        : 'border-gray-300 text-gray-600 hover:border-brand-400 hover:text-brand-600'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}

            {/* Custom tab */}
            {cronTab === 'custom' && (
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
                {/* Mode selector */}
                <div className="grid grid-cols-3 gap-2">
                  {(['every-minutes', 'every-hours', 'daily-at'] as const).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setCustom(c => ({ ...c, mode }))}
                      className={`px-2 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                        custom.mode === mode
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {mode === 'every-minutes' ? 'Every N Minutes'
                        : mode === 'every-hours' ? 'Every N Hours'
                        : 'Daily at Time'}
                    </button>
                  ))}
                </div>

                {/* Every-minutes controls */}
                {custom.mode === 'every-minutes' && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 whitespace-nowrap">Every</span>
                    <input
                      type="number"
                      min={1} max={59}
                      value={custom.everyMinutes}
                      onChange={e => setCustom(c => ({ ...c, everyMinutes: Number(e.target.value) }))}
                      className="w-20 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                    <span className="text-sm text-gray-600">minute(s)</span>
                  </div>
                )}

                {/* Every-hours controls */}
                {custom.mode === 'every-hours' && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 whitespace-nowrap">Every</span>
                    <input
                      type="number"
                      min={1} max={23}
                      value={custom.everyHours}
                      onChange={e => setCustom(c => ({ ...c, everyHours: Number(e.target.value) }))}
                      className="w-20 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                    <span className="text-sm text-gray-600">hour(s)</span>
                  </div>
                )}

                {/* Daily-at controls */}
                {custom.mode === 'daily-at' && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 whitespace-nowrap">Daily at</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0} max={23}
                        value={custom.atHour}
                        onChange={e => setCustom(c => ({ ...c, atHour: Number(e.target.value) }))}
                        className="w-16 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand-500"
                        placeholder="HH"
                      />
                      <span className="text-gray-500 font-bold">:</span>
                      <input
                        type="number"
                        min={0} max={59}
                        value={custom.atMinute}
                        onChange={e => setCustom(c => ({ ...c, atMinute: Number(e.target.value) }))}
                        className="w-16 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand-500"
                        placeholder="MM"
                      />
                    </div>
                    <span className="text-sm text-gray-500">UTC</span>
                  </div>
                )}

                {/* Live preview */}
                <div className="flex items-center gap-2 pt-1 border-t border-gray-200">
                  <Clock size={13} className="text-brand-500" />
                  <span className="text-xs text-gray-500">{describeCustom(custom)}</span>
                  <code className="ml-auto text-xs bg-white border border-gray-200 px-2 py-0.5 rounded font-mono text-gray-600">
                    {buildCustomCron(custom)}
                  </code>
                </div>
              </div>
            )}

            {/* Raw tab */}
            {cronTab === 'raw' && (
              <div>
                <input
                  required
                  value={form.cronExpression}
                  onChange={e => setForm(f => ({ ...f, cronExpression: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="0 9 * * 1"
                />
                <p className="text-xs text-gray-400 mt-1">minute  hour  day-of-month  month  day-of-week  (UTC)</p>
              </div>
            )}

            {/* Always show current expression as a read-only pill */}
            {cronTab !== 'raw' && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-gray-400">Cron:</span>
                <code className="text-xs bg-gray-100 px-2 py-0.5 rounded font-mono text-gray-700">{form.cronExpression}</code>
              </div>
            )}
          </div>

          {/* Notification Alert */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notification Alert <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <select
              value={form.notificationConfigId}
              onChange={e => setForm(f => ({ ...f, notificationConfigId: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">None</option>
              {notifications.map(n => (
                <option key={n.id} value={n.id}>{n.name} ({n.type})</option>
              ))}
            </select>
          </div>

          {/* Enable toggle */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
              className={`flex items-center gap-2 text-sm font-medium transition-colors ${form.enabled ? 'text-brand-600' : 'text-gray-400'}`}
            >
              {form.enabled
                ? <ToggleRight size={22} className="text-brand-500" />
                : <ToggleLeft size={22} />}
              {form.enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white text-sm rounded-lg hover:bg-brand-600 disabled:opacity-50"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {schedule ? 'Save Changes' : 'Create Schedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export const Schedules: React.FC = () => {
  const navigate = useNavigate();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [specs, setSpecs] = useState<TestSpec[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [notifications, setNotifications] = useState<NotificationConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const { toasts, addToast, removeToast } = useToast();

  useEffect(() => {
    Promise.all([
      (api as any).schedules.list(),
      api.testSpecs.list(),
      api.environments.list(),
      (api as any).notifications.list(),
    ]).then(([s, ts, envs, notifs]: any) => {
      setSchedules(s);
      setSpecs(ts);
      setEnvironments(envs);
      setNotifications(notifs);
    }).finally(() => setLoading(false));
  }, []);

  const handleSaved = (s: Schedule) => {
    setSchedules(prev => {
      const idx = prev.findIndex(x => x.id === s.id);
      return idx >= 0 ? prev.map(x => x.id === s.id ? s : x) : [s, ...prev];
    });
    setModalOpen(false);
    setEditing(null);
    addToast(editing ? 'Schedule updated' : 'Schedule created', 'success');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this schedule?')) return;
    await (api as any).schedules.delete(id);
    setSchedules(prev => prev.filter(s => s.id !== id));
    addToast('Schedule deleted', 'success');
  };

  // Play: load spec k6 script into sessionStorage, set autoRun flag, navigate to Executor
  const handleTrigger = async (schedule: Schedule) => {
    setTriggering(schedule.id);
    try {
      const spec = await api.testSpecs.get(schedule.specId) as any;
      const scriptText = await api.testSpecs.previewK6(schedule.specId);

      sessionStorage.setItem('generatedK6Script', scriptText);
      sessionStorage.setItem('generatedK6ScriptName', spec.name ?? schedule.name);
      sessionStorage.setItem('generatedK6ScriptSpecId', schedule.specId);
      sessionStorage.setItem('executorAutoRun', 'true');
      if (spec.slos?.length) sessionStorage.setItem('generatedK6ScriptSlos', JSON.stringify(spec.slos));

      navigate('/executor');
    } catch (err: any) {
      addToast(`Failed to load spec: ${err.message}`, 'error');
      setTriggering(null);
    }
  };

  const handleToggle = async (schedule: Schedule) => {
    const updated = await (api as any).schedules.update(schedule.id, { enabled: !schedule.enabled });
    setSchedules(prev => prev.map(s => s.id === schedule.id ? updated : s));
    addToast(updated.enabled ? 'Schedule enabled' : 'Schedule disabled', 'success');
  };

  const specName = (id: string) => specs.find(s => s.id === id)?.name ?? id;
  const envName  = (id: string | null) => id ? (environments.find(e => e.id === id)?.name ?? id) : 'Spec default';

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 p-8 overflow-y-auto">
        <ToastContainer toasts={toasts} onRemove={removeToast} />

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Calendar size={22} className="text-brand-500" /> Schedules
            </h1>
            <p className="text-sm text-gray-500 mt-1">Auto-trigger test executions on a recurring schedule</p>
          </div>
          <button
            onClick={() => { setEditing(null); setModalOpen(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white text-sm rounded-lg hover:bg-brand-600"
          >
            <Plus size={15} /> New Schedule
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-400">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : schedules.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Calendar size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 font-medium">No schedules yet</p>
            <p className="text-sm text-gray-400 mt-1">Create a schedule to auto-run tests on a cron.</p>
            <button
              onClick={() => setModalOpen(true)}
              className="mt-4 px-4 py-2 bg-brand-500 text-white text-sm rounded-lg hover:bg-brand-600"
            >
              Create First Schedule
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {schedules.map(s => (
              <div key={s.id} className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-gray-900">{s.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {s.enabled ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <Clock size={13} />
                      <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">{s.cronExpression}</code>
                    </span>
                    <span>Spec: <span className="text-gray-700 font-medium">{specName(s.specId)}</span></span>
                    <span>Env: <span className="text-gray-700">{envName(s.environmentId)}</span></span>
                    {s.lastRunAt && (
                      <span className="text-xs text-gray-400">
                        Last run {new Date(s.lastRunAt).toLocaleString()}
                      </span>
                    )}
                    {s.notificationConfigId && (
                      <span className="flex items-center gap-1 text-xs text-blue-500">
                        <Bell size={12} /> Alert configured
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleToggle(s)}
                    title={s.enabled ? 'Pause schedule' : 'Resume schedule'}
                    className="text-gray-400 hover:text-brand-500 transition-colors"
                  >
                    {s.enabled ? <ToggleRight size={22} className="text-brand-500" /> : <ToggleLeft size={22} />}
                  </button>
                  <button
                    onClick={() => handleTrigger(s)}
                    disabled={triggering === s.id}
                    title="Run now in Executor"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg text-xs font-medium hover:bg-green-100 transition-colors disabled:opacity-40"
                  >
                    {triggering === s.id
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Play size={13} />}
                    Run Now
                  </button>
                  <button
                    onClick={() => { setEditing(s); setModalOpen(true); }}
                    title="Edit"
                    className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
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
          <ScheduleModal
            schedule={editing}
            specs={specs}
            environments={environments}
            notifications={notifications}
            onClose={() => { setModalOpen(false); setEditing(null); }}
            onSaved={handleSaved}
          />
        )}
      </main>
    </div>
  );
};
