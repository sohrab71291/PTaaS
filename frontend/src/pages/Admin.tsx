import React, { useState } from 'react';
import {
  Users, Shield, Server, FileText, Plug, CheckCircle, AlertCircle,
} from 'lucide-react';

const MOCK_USERS = [
  { id: '1', name: 'John Doe',   email: 'john@example.com', role: 'ADMIN',  createdAt: '2026-01-15' },
  { id: '2', name: 'Jane Smith', email: 'jane@example.com', role: 'TESTER', createdAt: '2026-02-20' },
  { id: '3', name: 'Alice Chen', email: 'alice@example.com', role: 'VIEWER', createdAt: '2026-03-10' },
];

const ROLE_COLORS: Record<string, string> = {
  ADMIN:  'bg-purple-100 text-purple-700',
  TESTER: 'bg-blue-100 text-blue-700',
  VIEWER: 'bg-gray-100 text-gray-600',
};

const RoleBadge: React.FC<{ role: string }> = ({ role }) => (
  <span className={`text-xs px-2 py-0.5 rounded font-medium ${ROLE_COLORS[role] ?? 'bg-gray-100 text-gray-600'}`}>
    {role}
  </span>
);

const UsersTab: React.FC = () => {
  const avatar = (name: string) =>
    name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">User</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Role</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Member since</th>
          </tr>
        </thead>
        <tbody>
          {MOCK_USERS.map(u => (
            <tr key={u.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {avatar(u.name)}
                  </div>
                  <div>
                    <div className="font-medium text-sm text-gray-900">{u.name}</div>
                    <div className="text-xs text-gray-500">{u.email}</div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <RoleBadge role={u.role} />
              </td>
              <td className="px-4 py-3 text-xs text-gray-500">
                {new Date(u.createdAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const MOCK_ROLES = [
  { name: 'Admin', description: 'Full access to all resources', permissions: ['read', 'write', 'delete', 'manage-users', 'run-prod'], users: 1 },
  { name: 'Tester', description: 'Create and run tests', permissions: ['read', 'write', 'run-dev', 'run-qa', 'run-stage'], users: 0 },
  { name: 'Viewer', description: 'Read-only access', permissions: ['read'], users: 0 },
];

const MOCK_RUNNERS = [
  { id: 'runner-01', name: 'perfops-runner-01', status: 'healthy', cpu: 23, mem: 45, region: 'us-east-1', version: '1.2.0', lastSeen: '2s ago' },
  { id: 'runner-02', name: 'perfops-runner-02', status: 'healthy', cpu: 67, mem: 78, region: 'us-east-1', version: '1.2.0', lastSeen: '5s ago' },
  { id: 'runner-03', name: 'perfops-runner-03', status: 'busy',    cpu: 95, mem: 89, region: 'eu-west-1', version: '1.2.0', lastSeen: '1s ago' },
  { id: 'runner-04', name: 'perfops-runner-04', status: 'offline', cpu: 0,  mem: 0,  region: 'ap-southeast-1', version: '1.1.5', lastSeen: '12m ago' },
];

const MOCK_AUDIT_LOGS = [
  { id: 1, user: 'jane.smith', action: 'CREATE',  resource: 'test-spec',   resourceId: 'spec-005', ts: '2026-06-01T10:00:00Z' },
  { id: 2, user: 'ci-pipeline', action: 'EXECUTE', resource: 'execution',  resourceId: 'exec-005', ts: '2026-05-31T06:00:00Z' },
  { id: 3, user: 'john.doe',   action: 'UPDATE',  resource: 'environment', resourceId: 'env-qa',   ts: '2026-05-30T15:30:00Z' },
  { id: 4, user: 'jane.smith', action: 'DELETE',  resource: 'secret',      resourceId: 'secret-old', ts: '2026-05-30T11:00:00Z' },
  { id: 5, user: 'john.doe',   action: 'EXECUTE', resource: 'execution',   resourceId: 'exec-002', ts: '2026-05-31T14:00:00Z' },
  { id: 6, user: 'alice.chen', action: 'READ',    resource: 'report',      resourceId: 'exec-001', ts: '2026-06-01T09:00:00Z' },
];

const ACTION_COLORS: Record<string, string> = {
  CREATE:  'bg-green-100 text-green-700',
  UPDATE:  'bg-blue-100 text-blue-700',
  DELETE:  'bg-red-100 text-red-700',
  EXECUTE: 'bg-purple-100 text-purple-700',
  READ:    'bg-gray-100 text-gray-700',
};

const TABS = [
  { id: 'users',        label: 'Users',        icon: Users },
  { id: 'roles',        label: 'Roles',        icon: Shield },
  { id: 'runners',      label: 'Runner Pool',  icon: Server },
  { id: 'audit',        label: 'Audit Logs',   icon: FileText },
  { id: 'integrations', label: 'Integrations', icon: Plug },
];

export const Admin: React.FC = () => {
  const [activeTab, setActiveTab] = useState('users');
  const [auditSearch, setAuditSearch] = useState('');

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
        <p className="text-gray-500 text-sm mt-0.5">Platform administration and settings</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 mb-6 border-b border-gray-200">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? 'border-brand-500 text-brand-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'users' && <UsersTab />}

      {activeTab === 'roles' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {MOCK_ROLES.map(role => (
            <div key={role.name} className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-800">{role.name}</h3>
              </div>
              <p className="text-sm text-gray-600 mb-3">{role.description}</p>
              <div className="flex flex-wrap gap-1.5">
                {role.permissions.map(p => (
                  <span key={p} className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded font-mono">{p}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'runners' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {MOCK_RUNNERS.map(runner => (
            <div key={runner.id} className={`bg-white rounded-lg border-2 shadow-sm p-5 ${
              runner.status === 'healthy' ? 'border-green-200' :
              runner.status === 'busy'    ? 'border-blue-200' : 'border-gray-200'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    runner.status === 'healthy' ? 'bg-green-500 animate-pulse' :
                    runner.status === 'busy'    ? 'bg-blue-500 animate-pulse' : 'bg-gray-400'
                  }`} />
                  <span className="font-mono text-sm font-medium text-gray-800">{runner.name}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  runner.status === 'healthy' ? 'bg-green-100 text-green-700' :
                  runner.status === 'busy'    ? 'bg-blue-100 text-blue-700'   : 'bg-gray-100 text-gray-700'
                }`}>{runner.status}</span>
              </div>
              <div className="space-y-2 text-sm">
                {(['CPU', 'Memory'] as const).map((label, i) => {
                  const val = i === 0 ? runner.cpu : runner.mem;
                  return (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-gray-500">{label}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-1.5 bg-gray-200 rounded-full">
                          <div
                            className={`h-1.5 rounded-full ${val > 80 ? 'bg-red-500' : val > 60 ? 'bg-amber-500' : 'bg-green-500'}`}
                            style={{ width: `${val}%` }}
                          />
                        </div>
                        <span className="text-xs w-10 text-right text-gray-600">{val}%</span>
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Region: {runner.region}</span>
                  <span>v{runner.version}</span>
                </div>
                <div className="text-xs text-gray-400">Last seen: {runner.lastSeen}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'audit' && (
        <div>
          <div className="mb-4">
            <input
              type="text"
              value={auditSearch}
              onChange={e => setAuditSearch(e.target.value)}
              placeholder="Search audit logs..."
              className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Time</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">User</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Action</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Resource</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">ID</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_AUDIT_LOGS
                  .filter(log =>
                    !auditSearch ||
                    log.user.includes(auditSearch.toLowerCase()) ||
                    log.action.includes(auditSearch.toUpperCase()) ||
                    log.resource.includes(auditSearch.toLowerCase())
                  )
                  .map(log => (
                    <tr key={log.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs text-gray-500">{new Date(log.ts).toLocaleString()}</td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-700">{log.user}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${ACTION_COLORS[log.action] ?? 'bg-gray-100 text-gray-700'}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{log.resource}</td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-400">{log.resourceId}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'integrations' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { name: 'Slack',      description: 'Send test result notifications to Slack channels',  connected: true  },
            { name: 'PagerDuty',  description: 'Trigger incidents on threshold breaches',           connected: false },
            { name: 'Datadog',    description: 'Forward metrics to Datadog dashboards',            connected: true  },
            { name: 'Grafana',    description: 'Visualize test data in Grafana',                   connected: false },
          ].map(integration => (
            <div key={integration.name} className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-800">{integration.name}</h3>
                <div className="flex items-center gap-1">
                  {integration.connected
                    ? <><CheckCircle size={14} className="text-green-500" /><span className="text-xs text-green-600">Connected</span></>
                    : <><AlertCircle size={14} className="text-gray-400" /><span className="text-xs text-gray-500">Not connected</span></>
                  }
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-3">{integration.description}</p>
              <button className={`text-sm px-3 py-1.5 rounded-lg font-medium ${
                integration.connected
                  ? 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                  : 'bg-brand-500 text-white hover:bg-brand-600'
              }`}>
                {integration.connected ? 'Configure' : 'Connect'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
