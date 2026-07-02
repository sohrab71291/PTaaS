"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const DATA_DIR = path_1.default.join(__dirname, '../../data');
const FILE = path_1.default.join(DATA_DIR, 'notification-configs.json');
function readConfigs() {
    try {
        return JSON.parse(fs_1.default.readFileSync(FILE, 'utf-8'));
    }
    catch {
        return [];
    }
}
function writeConfigs(data) {
    if (!fs_1.default.existsSync(DATA_DIR))
        fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
    fs_1.default.writeFileSync(FILE, JSON.stringify(data, null, 2));
}
function buildSmtpTransport() {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || user || 'noreply@perfops.local';
    if (!host)
        return null;
    return { transport: nodemailer_1.default.createTransport({ host, port, auth: user && pass ? { user, pass } : undefined }), from };
}
async function sendEmail(recipients, subject, html) {
    const smtp = buildSmtpTransport();
    if (!smtp)
        return { ok: false, message: 'SMTP not configured (set SMTP_HOST in .env)' };
    try {
        await smtp.transport.sendMail({ from: smtp.from, to: recipients.join(','), subject, html });
        return { ok: true, message: `Email sent to ${recipients.join(', ')}` };
    }
    catch (err) {
        return { ok: false, message: err.message };
    }
}
async function sendTeams(webhookUrl, payload) {
    try {
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok)
            return { ok: false, message: `Teams webhook returned ${res.status}` };
        return { ok: true, message: 'Teams notification sent' };
    }
    catch (err) {
        return { ok: false, message: err.message };
    }
}
function row(label, value, bg = '#f8fafc') {
    return `<tr><td style="padding:7px 14px;font-weight:600;color:#475569;background:${bg};width:40%;border-bottom:1px solid #e2e8f0">${label}</td><td style="padding:7px 14px;color:#1e293b;background:#fff;border-bottom:1px solid #e2e8f0">${value}</td></tr>`;
}
function pct(v) {
    if (v == null)
        return '—';
    return (v * 100).toFixed(2) + '%';
}
function ms(v) {
    return v != null ? `${v} ms` : '—';
}
function num(v) {
    return v != null ? String(v) : '—';
}
function buildEmailHtml(exec) {
    const statusColor = exec.status === 'pass' ? '#16a34a' : exec.status === 'fail' ? '#dc2626' : '#d97706';
    const statusBg = exec.status === 'pass' ? '#f0fdf4' : exec.status === 'fail' ? '#fef2f2' : '#fffbeb';
    const m = exec.metrics;
    const durationStr = exec.duration != null ? `${exec.duration}s` : '—';
    const completedStr = exec.completedAt ? new Date(exec.completedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
    const metricsSection = m ? `
    <h3 style="margin:24px 0 8px;color:#334155;font-size:14px;font-weight:700;letter-spacing:.03em;text-transform:uppercase">Performance Metrics</h3>
    <table style="border-collapse:collapse;width:100%;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <thead>
        <tr>
          <th colspan="2" style="padding:8px 14px;background:#f1f5f9;text-align:left;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Response Times</th>
        </tr>
      </thead>
      <tbody>
        ${row('P50 (median)', ms(m.p50))}
        ${row('P90', ms(m.p90))}
        ${row('P95', ms(m.p95))}
        ${row('P99', ms(m.p99))}
        ${row('Average', ms(m.avg))}
      </tbody>
      <thead>
        <tr>
          <th colspan="2" style="padding:8px 14px;background:#f1f5f9;text-align:left;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;border-top:2px solid #e2e8f0">Throughput &amp; Load</th>
        </tr>
      </thead>
      <tbody>
        ${row('Requests / sec', num(m.rps))}
        ${row('Error rate', pct(m.errorRate))}
        ${row('Total requests', num(m.totalRequests))}
        ${row('Max VUs', num(m.maxVUs))}
        ${row('Duration', durationStr)}
      </tbody>
    </table>
  ` : '';
    return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:620px;color:#1e293b">
    <!-- Header banner -->
    <div style="background:#1e293b;padding:20px 28px;border-radius:10px 10px 0 0;display:flex;align-items:center;gap:12px">
      <div style="width:36px;height:36px;background:#6366f1;border-radius:8px;display:flex;align-items:center;justify-content:center">
        <span style="color:#fff;font-size:18px;font-weight:700">⚡</span>
      </div>
      <div>
        <div style="color:#fff;font-size:16px;font-weight:700">PerfOps Execution Report</div>
        <div style="color:#94a3b8;font-size:12px;margin-top:1px">${exec.specName}</div>
      </div>
    </div>

    <!-- Status badge -->
    <div style="background:${statusBg};border:1px solid ${statusColor}33;padding:14px 28px;display:flex;align-items:center;gap:10px">
      <span style="font-size:22px">${exec.status === 'pass' ? '✅' : exec.status === 'fail' ? '❌' : '⚠️'}</span>
      <div>
        <span style="color:${statusColor};font-size:18px;font-weight:700">${exec.status.toUpperCase()}</span>
        <span style="color:#64748b;font-size:13px;margin-left:8px">completed ${completedStr}</span>
      </div>
    </div>

    <!-- Execution details -->
    <h3 style="margin:20px 0 8px;color:#334155;font-size:14px;font-weight:700;letter-spacing:.03em;text-transform:uppercase">Execution Details</h3>
    <table style="border-collapse:collapse;width:100%;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <tbody>
        ${row('Test Spec', exec.specName)}
        ${row('Environment', exec.environment)}
        ${row('Triggered by', exec.triggeredBy)}
        ${row('Completed', completedStr)}
        ${row('Duration', durationStr)}
        ${row('Execution ID', '<code style="font-size:11px;color:#64748b">' + exec.id + '</code>')}
      </tbody>
    </table>

    ${metricsSection}

    <p style="color:#94a3b8;font-size:11px;margin-top:20px;padding-top:12px;border-top:1px solid #e2e8f0">
      Sent by PerfOps Control Plane · Do not reply to this email
    </p>
  </div>
  `;
}
function buildTeamsCard(exec) {
    const icon = exec.status === 'pass' ? '✅' : exec.status === 'fail' ? '❌' : '⚠️';
    const color = exec.status === 'pass' ? '00b050' : exec.status === 'fail' ? 'e53935' : 'f9a825';
    const m = exec.metrics;
    const durationStr = exec.duration != null ? `${exec.duration}s` : '—';
    const facts = [
        { name: 'Test Spec', value: exec.specName },
        { name: 'Environment', value: exec.environment },
        { name: 'Triggered by', value: exec.triggeredBy },
        { name: 'Duration', value: durationStr },
        ...(m ? [
            { name: 'P95 latency', value: ms(m.p95) },
            { name: 'P99 latency', value: ms(m.p99) },
            { name: 'Requests / sec', value: num(m.rps) },
            { name: 'Error rate', value: pct(m.errorRate) },
            { name: 'Total requests', value: num(m.totalRequests) },
        ] : []),
    ];
    return {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        themeColor: color,
        summary: `PerfOps: ${exec.specName} — ${exec.status.toUpperCase()}`,
        sections: [{
                activityTitle: `${icon} **${exec.specName}** — ${exec.status.toUpperCase()}`,
                activitySubtitle: `PerfOps Execution Report · ${exec.completedAt ? new Date(exec.completedAt).toLocaleString() : ''}`,
                facts,
                markdown: true,
            }],
    };
}
function buildTeamsText(exec) {
    const icon = exec.status === 'pass' ? '✅' : exec.status === 'fail' ? '❌' : '⚠️';
    return `${icon} **PerfOps** | ${exec.specName} on ${exec.environment} — **${exec.status.toUpperCase()}** (triggered by ${exec.triggeredBy})`;
}
exports.notificationService = {
    listConfigs: () => readConfigs(),
    createConfig: (config) => {
        const all = readConfigs();
        all.push(config);
        writeConfigs(all);
        return config;
    },
    updateConfig: (id, updates) => {
        const all = readConfigs();
        const idx = all.findIndex(c => c.id === id);
        if (idx === -1)
            return null;
        all[idx] = { ...all[idx], ...updates, id };
        writeConfigs(all);
        return all[idx];
    },
    deleteConfig: (id) => {
        const all = readConfigs();
        const next = all.filter(c => c.id !== id);
        if (next.length === all.length)
            return false;
        writeConfigs(next);
        return true;
    },
    sendTest: async (id) => {
        const config = readConfigs().find(c => c.id === id);
        if (!config)
            return null;
        const dummyExec = {
            id: 'test-000',
            specName: 'Sample Test Spec',
            environment: 'QA',
            status: 'pass',
            triggeredBy: 'system',
            completedAt: new Date().toISOString(),
            duration: 120,
            metrics: { p50: 45, p90: 98, p95: 132, p99: 210, avg: 55, rps: 87.4, errorRate: 0.002, totalRequests: 10450, maxVUs: 50 },
        };
        return exports.notificationService.dispatch(config, dummyExec);
    },
    dispatch: async (config, exec) => {
        if (!config.enabled)
            return { ok: false, message: 'Config disabled' };
        const shouldSend = config.trigger === 'always' ||
            (config.trigger === 'on_failure' && exec.status === 'fail') ||
            (config.trigger === 'on_success' && exec.status === 'pass');
        if (!shouldSend)
            return { ok: true, message: 'Trigger condition not met — skipped' };
        if (config.type === 'email') {
            return sendEmail(config.emailRecipients, `PerfOps: ${exec.specName} — ${exec.status.toUpperCase()}`, buildEmailHtml(exec));
        }
        if (config.type === 'teams' && config.teamsWebhookUrl) {
            return sendTeams(config.teamsWebhookUrl, buildTeamsCard(exec));
        }
        return { ok: false, message: 'Unknown notification type' };
    },
    dispatchForExecution: async (exec) => {
        const configs = readConfigs().filter(c => c.enabled);
        const results = await Promise.all(configs.map(c => exports.notificationService.dispatch(c, exec)));
        return results;
    },
};
