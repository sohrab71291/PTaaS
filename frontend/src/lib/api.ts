const BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('auth_token');
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
    ...options,
  });

  if (res.status === 401) {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export const api = {
  auth: {
    register: (data: { email: string; password: string; name: string }) =>
      request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
    login: (data: { email: string; password: string }) =>
      request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
    me: () => request('/auth/me'),
    forgotPassword: (data: { email: string }) =>
      request<{ message: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify(data) }),
    resetPassword: (data: { token: string; password: string }) =>
      request<{ message: string }>('/auth/reset-password', { method: 'POST', body: JSON.stringify(data) }),
  },
  dashboard: {
    get: () => request('/dashboard'),
  },
  testSpecs: {
    list: () => request('/test-specs'),
    get: (id: string) => request(`/test-specs/${id}`),
    create: (data: unknown) => request('/test-specs', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) => request(`/test-specs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/test-specs/${id}`, { method: 'DELETE' }),
    previewJson: (id: string) => request(`/test-specs/${id}/preview/json`),
    previewK6: (id: string) => {
      const token = getToken();
      return fetch(`/api/test-specs/${id}/preview/k6`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).then(r => r.text());
    },
  },
  executions: {
    list: () => request('/executions'),
    get: (id: string) => request(`/executions/${id}`),
    trigger: (data: { specId: string; environment?: string }) =>
      request('/executions', { method: 'POST', body: JSON.stringify(data) }),
  },
  environments: {
    list: () => request('/environments'),
    create: (data: unknown) => request('/environments', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) => request(`/environments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/environments/${id}`, { method: 'DELETE' }),
  },
  secrets: {
    list: () => request('/secrets'),
    create: (data: unknown) => request('/secrets', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/secrets/${id}`, { method: 'DELETE' }),
    testConnection: (id: string) => request(`/secrets/${id}/test`, { method: 'POST' }),
  },
  reports: {
    get: (executionId: string) => request(`/reports/${executionId}`),
  },
  agents: {
    list: () => request('/agents'),
    register: (data: { name: string; hostname?: string }) =>
      request('/agents/register', { method: 'POST', body: JSON.stringify(data) }),
  },
  schedules: {
    list: () => request('/schedules'),
    create: (data: unknown) => request('/schedules', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) => request(`/schedules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/schedules/${id}`, { method: 'DELETE' }),
    triggerNow: (id: string) => request(`/schedules/${id}/trigger`, { method: 'POST' }),
    executions: (id: string) => request(`/schedules/${id}/executions`),
  },
  notifications: {
    list: () => request('/notifications'),
    create: (data: unknown) => request('/notifications', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) => request(`/notifications/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/notifications/${id}`, { method: 'DELETE' }),
    test: (id: string) => request(`/notifications/${id}/test`, { method: 'POST' }),
  },
  config: {
    get: () => request<{
      grafanaUrl:          string | null;
      grafanaDashboardUid: string | null;
      influxdbUrl:         string | null;
      influxdbConfigured:  boolean;
    }>('/config'),
    testConnections: () => request<{
      influxdb: { connected: boolean; message: string; latencyMs: number | null };
      grafana:  { connected: boolean; message: string; latencyMs: number | null };
    }>('/config/test-connections', { method: 'POST' }),
  },
  grafana: {
    syncDashboard: () => request<{ uid: string; url: string; slug: string; grafanaUrl: string }>(
      '/grafana/sync-dashboard',
      { method: 'POST' },
    ),
  },
  coralogix: {
    status: () => request<{
      ingestionConfigured: boolean;
      queryConfigured: boolean;
      domain: string;
      appName: string;
    }>('/coralogix/status'),
    logs: (params?: { q?: string; limit?: number; lookback?: number }) =>
      request<{ rows: Record<string, unknown>[]; warnings: string[] }>(
        `/coralogix/logs${coralogixQuery(params)}`,
      ),
    traces: (params?: { q?: string; limit?: number; lookback?: number }) =>
      request<{ rows: Record<string, unknown>[]; warnings: string[] }>(
        `/coralogix/traces${coralogixQuery(params)}`,
      ),
  },
};

function coralogixQuery(params?: { q?: string; limit?: number; lookback?: number }): string {
  if (!params) return '';
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.lookback) qs.set('lookback', String(params.lookback));
  const s = qs.toString();
  return s ? `?${s}` : '';
}
