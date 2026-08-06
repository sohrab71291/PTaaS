"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.K6Runner = void 0;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const pidusage_1 = __importDefault(require("pidusage"));
// True if a k6 metric point's tags identify it as InfluxDB bookkeeping traffic
// (a metrics write, or an org/bucket precheck lookup) rather than a real
// request the script under test was measuring. These must never count toward
// the executor's request totals, error rate, or pass/fail signal.
function isInfluxRequest(tags) {
    if (!tags)
        return false;
    if (tags.api === 'influx-v2-write' || tags.step === 'metrics-publish' || tags.step === 'metrics-precheck') {
        return true;
    }
    const url = String(tags.url ?? tags.name ?? '');
    return /\/api\/v2\/(write|orgs|buckets)(\?|$)/.test(url);
}
class K6Runner {
    constructor(onUpdate) {
        this.onUpdate = onUpdate;
        this.process = null;
        this.metricsInterval = null;
        this.metricsTailInterval = null;
        this.metricsFilePath = null;
        this.metricsFileOffset = 0;
        // Set to true as soon as the process exits or stop() is called.
        // Prevents stdout/stderr handlers from emitting stale progress lines
        // that k6 buffers during the graceful-stop window after the test finishes.
        this.stopped = false;
        // Full accumulation of all durations (ms) for accurate final p50/p95 over the whole run.
        // Capped at 100k to bound memory; p-values remain statistically accurate past ~10k samples.
        this.durationWindow = [];
        this.totalRequestsCount = 0;
        this.failedRequestsCount = 0;
        // Captured from the injected handleSummary PTAAS_SUMMARY: line at end of run
        this.capturedSummary = null;
    }
    async run(config) {
        this.stopped = false;
        const validatedScript = this.validateScript(config.script);
        const configWithValidScript = { ...config, script: validatedScript };
        const profiledScript = this.injectLoadProfile(configWithValidScript);
        // Universal request/response logging - applied here (not baked into
        // generated scripts) so it covers every execution path uniformly:
        // ad-hoc Executor runs, tracked TestSpec runs, AI-generated scripts,
        // generator-built scripts, and hand-pasted custom scripts alike,
        // including scripts that were already saved before this feature existed.
        const withLogging = this.injectRequestResponseLogging(profiledScript);
        // Augment handleSummary to emit a structured PTAAS_SUMMARY: line at end of run
        // so the backend can extract threshold/check results without parsing k6's human-readable text.
        const scriptContent = this.injectSummaryCapture(withLogging);
        const tmpDir = os.tmpdir();
        const runId = Date.now();
        const scriptPath = path.join(tmpDir, `perfops-agent-${runId}.js`);
        const metricsPath = path.join(tmpDir, `perfops-metrics-${runId}.ndjson`);
        fs.writeFileSync(scriptPath, scriptContent);
        // Extract InfluxDB config from envVars so the agent can forward metrics
        // for scripts that don't include the writeInfluxLines() boilerplate.
        const influxConfig = this.extractInfluxConfig(config.envVars);
        // Scripts generated by Test Authoring already have writeInfluxLines() — skip
        // agent-side forwarding for those to avoid double-writing requestsRaw.
        const scriptHasBoilerplate = scriptContent.includes('INFLUX_V2_ENABLED');
        const forwardToInflux = influxConfig !== null && !scriptHasBoilerplate;
        // NOTE: We use --out json to stream individual metric data points in real-time.
        // We tail-read this file every 2s to compute rolling p50/p95/rps for the
        // response-time chart and to forward metrics to InfluxDB for plain user scripts.
        // We do NOT readFileSync at the end (that caused multi-second blocking).
        const args = ['run', scriptPath, '--out', `json=${metricsPath}`];
        // Load profile is now always injected directly into the script via injectLoadProfile().
        // We no longer use --vus/--duration CLI flags because:
        //   1. CLI flags override options.scenarios entirely, bypassing any named exec functions.
        //   2. They only work for constant mode, not staged.
        // The new injectLoadProfile() always replaces the options block with the exact profile
        // the user selected, preserving the exec function reference when one exists.
        const env = {
            ...process.env,
            PATH: `${process.env.HOME}/bin:${process.env.PATH}:/usr/local/bin:/opt/homebrew/bin`,
            ...(config.baseUrl ? { BASE_URL: config.baseUrl } : {}),
            ...config.envVars,
        };
        const k6Bin = [
            `${process.env.HOME}/bin/k6`,
            '/usr/local/bin/k6',
            '/opt/homebrew/bin/k6',
            'k6',
        ].find(p => { try {
            fs.accessSync(p);
            return true;
        }
        catch {
            return false;
        } }) || 'k6';
        this.metricsFilePath = metricsPath;
        this.metricsFileOffset = 0;
        this.durationWindow = [];
        this.totalRequestsCount = 0;
        this.failedRequestsCount = 0;
        this.capturedSummary = null;
        this.process = (0, child_process_1.spawn)(k6Bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
        this.startSystemMetrics();
        // Signal test start to InfluxDB (Grafana "Test Start" annotation)
        if (forwardToInflux && influxConfig) {
            this.writeRequestsToInflux([], influxConfig, undefined, 'started').catch(() => { });
        }
        // Wait briefly for K6 to create the metrics file, then start tailing it
        setTimeout(() => this.startMetricsTail(metricsPath, forwardToInflux ? influxConfig : null), 1500);
        this.process.stdout?.on('data', (chunk) => {
            chunk.toString().split('\n').filter(Boolean).forEach(line => {
                // PTAAS_SUMMARY is emitted by handleSummary after k6 marks the run done.
                // Must be captured before the stopped-guard so it isn't swallowed.
                if (line.startsWith('PTAAS_SUMMARY:')) {
                    try {
                        this.capturedSummary = JSON.parse(line.slice(14));
                    }
                    catch { }
                    return;
                }
                if (this.stopped)
                    return; // guard inside forEach — k6 buffers many lines in one chunk
                this.tryParseProgressLine(line); // may set this.stopped = true on completion marker
                if (this.stopped)
                    return;
                this.onUpdate({ type: 'log', timestamp: Date.now(), data: { line } });
            });
        });
        this.process.stderr?.on('data', (chunk) => {
            if (this.stopped)
                return;
            chunk.toString().split('\n').filter(Boolean).forEach(line => {
                if (this.stopped)
                    return; // guard inside forEach — k6 buffers many lines in one chunk
                this.tryParseProgressLine(line); // may set this.stopped = true on completion marker
                if (this.stopped)
                    return;
                this.onUpdate({ type: 'log', timestamp: Date.now(), data: { line, isStderr: true } });
            });
        });
        return new Promise((resolve, reject) => {
            this.process.on('close', (code) => {
                this.stopped = true;
                this.stopSystemMetrics();
                this.stopMetricsTail();
                // Do one final read of the metrics file to flush any remaining data
                this.readMetricsChunk(metricsPath, forwardToInflux ? influxConfig : null, true);
                // Signal test end to InfluxDB (Grafana "Test End" annotation)
                if (forwardToInflux && influxConfig) {
                    this.writeRequestsToInflux([], influxConfig, undefined, 'finished').catch(() => { });
                }
                const summary = this.buildSummary();
                this.onUpdate({ type: 'complete', timestamp: Date.now(), data: { exitCode: code, summary } });
                try {
                    fs.unlinkSync(scriptPath);
                }
                catch { }
                try {
                    fs.unlinkSync(metricsPath);
                }
                catch { }
                resolve();
            });
            this.process.on('error', (err) => {
                this.stopSystemMetrics();
                this.stopMetricsTail();
                const message = err.code === 'ENOENT'
                    ? 'K6 not found. Install: https://k6.io/docs/get-started/installation/'
                    : err.message;
                this.onUpdate({ type: 'error', timestamp: Date.now(), data: { message } });
                reject(err);
            });
        });
    }
    stop() {
        this.stopped = true;
        const pid = this.process?.pid;
        if (pid) {
            if (process.platform === 'win32') {
                // On Windows, `k6` often resolves to a Chocolatey/scoop shim executable
                // that launches the real k6.exe as a child process. Killing just the
                // shim (this.process) leaves the real k6 process running, orphaned,
                // and it never reports back — so the agent stays stuck "busy" forever.
                // taskkill /T kills the whole process tree, not just the shim.
                (0, child_process_1.execFile)('taskkill', ['/pid', String(pid), '/T', '/F'], () => { });
            }
            else {
                this.process?.kill('SIGTERM');
            }
        }
        this.stopSystemMetrics();
        this.stopMetricsTail();
    }
    // ── Metrics file tailing ──────────────────────────────────────────────────
    startMetricsTail(filePath, influxConfig) {
        this.metricsTailInterval = setInterval(() => {
            this.readMetricsChunk(filePath, influxConfig, false);
        }, 2000);
    }
    stopMetricsTail() {
        if (this.metricsTailInterval) {
            clearInterval(this.metricsTailInterval);
            this.metricsTailInterval = null;
        }
    }
    readMetricsChunk(filePath, influxConfig, isFinal) {
        try {
            if (!fs.existsSync(filePath))
                return;
            const stat = fs.statSync(filePath);
            if (stat.size <= this.metricsFileOffset)
                return;
            const fd = fs.openSync(filePath, 'r');
            const length = stat.size - this.metricsFileOffset;
            const buffer = Buffer.alloc(length);
            fs.readSync(fd, buffer, 0, length, this.metricsFileOffset);
            fs.closeSync(fd);
            this.metricsFileOffset = stat.size;
            const lines = buffer.toString().split('\n').filter(Boolean);
            const newDurations = [];
            let latestVUs;
            let errorCount = 0;
            for (const line of lines) {
                try {
                    const point = JSON.parse(line);
                    if (point.type !== 'Point')
                        continue;
                    // Skip internal InfluxDB traffic: write requests and bucket/org management
                    // calls from ensureInfluxBucket() (tagged step: 'metrics-precheck'), so
                    // they never count toward the executor's live/final request totals,
                    // error rate, or duration percentiles. Scripts that follow the standard
                    // InfluxDB boilerplate (k6InfluxTemplate.ts/k6PromptBlocks.ts) tag these
                    // calls explicitly; as a fallback for hand-written/older scripts that
                    // write to InfluxDB without those exact tags, also match on the request
                    // URL itself — InfluxDB's write/org/bucket-management endpoints are a
                    // fixed, well-known API surface (/api/v2/write, /api/v2/orgs,
                    // /api/v2/buckets) regardless of tagging.
                    if (isInfluxRequest(point.data?.tags))
                        continue;
                    if (point.metric === 'http_req_duration' && typeof point.data?.value === 'number') {
                        // expected_response is k6's OWN verdict, driven by the script's
                        // responseCallback/http.expectedStatuses() — it already accounts
                        // for tolerated statuses (e.g. a benign 404 on a known endpoint,
                        // an idempotent DELETE landing on 404/409). Previously this was
                        // OR'd with a raw status>=400 check, which meant ANY non-2xx
                        // status still got counted as failed regardless of what
                        // expected_response said — silently overriding the very
                        // tolerance the script's responseCallback was set up to express,
                        // and diverging from k6's own http_req_failed/checks metrics.
                        // Trust expected_response when k6 provides it; only fall back to
                        // the raw status code for points that lack the tag entirely
                        // (e.g. a hand-written script with no responseCallback set).
                        const expectedResponseTag = point.data?.tags?.expected_response;
                        const failed = expectedResponseTag !== undefined
                            ? expectedResponseTag === 'false'
                            : parseInt(point.data?.tags?.status ?? '200', 10) >= 400;
                        newDurations.push({
                            ms: point.data.value, // K6 stores http_req_duration in milliseconds
                            name: point.data?.tags?.name ?? point.data?.tags?.url ?? 'request',
                            status: point.data?.tags?.status ?? '200',
                            failed,
                        });
                        if (failed)
                            errorCount++;
                    }
                    if ((point.metric === 'vus') && typeof point.data?.value === 'number') {
                        latestVUs = Math.max(latestVUs ?? 0, point.data.value);
                    }
                }
                catch { /* skip malformed lines */ }
            }
            // Accumulate all durations for accurate full-run percentiles.
            // Cap at 100k to bound memory; p-values stay accurate well past that.
            if (newDurations.length > 0) {
                this.totalRequestsCount += newDurations.length;
                this.failedRequestsCount += errorCount;
                this.durationWindow.push(...newDurations.map(d => d.ms));
                if (this.durationWindow.length > 100000) {
                    this.durationWindow = this.durationWindow.slice(-100000);
                }
                const sorted = [...this.durationWindow].sort((a, b) => a - b);
                const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
                const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
                const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
                // Approximate RPS: requests received in this ~2s window
                const rps = isFinal ? undefined : Math.round((newDurations.length / 2) * 10) / 10;
                // Error rate over entire run (not just this chunk)
                const errorRate = this.totalRequestsCount > 0
                    ? Math.round((this.failedRequestsCount / this.totalRequestsCount) * 10000) / 100
                    : 0;
                this.onUpdate({
                    type: 'metric',
                    timestamp: Date.now(),
                    data: {
                        p50: Math.round(p50 * 10) / 10,
                        p95: Math.round(p95 * 10) / 10,
                        avg: Math.round(avg * 10) / 10,
                        rps,
                        errorRate,
                        totalRequests: this.totalRequestsCount,
                        vus: latestVUs,
                    },
                });
                // Forward raw metrics to InfluxDB for scripts without writeInfluxLines()
                if (influxConfig && newDurations.length > 0) {
                    this.writeRequestsToInflux(newDurations, influxConfig, latestVUs).catch(() => { });
                }
            }
            else if (latestVUs !== undefined) {
                // VU-only update — write virtualUsers point even when no HTTP requests
                this.onUpdate({
                    type: 'metric',
                    timestamp: Date.now(),
                    data: { vus: latestVUs },
                });
                if (influxConfig) {
                    this.writeRequestsToInflux([], influxConfig, latestVUs).catch(() => { });
                }
            }
        }
        catch { /* file not ready yet, or other transient error */ }
    }
    // ── InfluxDB forwarding ───────────────────────────────────────────────────
    extractInfluxConfig(envVars) {
        const url = envVars?.INFLUX_V2_URL;
        const token = envVars?.INFLUX_V2_TOKEN;
        const org = envVars?.INFLUX_V2_ORG;
        const bucket = envVars?.INFLUX_V2_BUCKET;
        if (url && token && org && bucket)
            return {
                url, token, org, bucket,
                runId: envVars?.RUN_ID ?? 'agent-executor',
                nodeName: envVars?.TESTID ?? 'PerfOps-agent',
            };
        return null;
    }
    async writeRequestsToInflux(requests, config, latestVUs, eventType) {
        const nowNs = () => String(Date.now()) + '000000'; // nanosecond precision
        const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/ /g, '\\ ').replace(/=/g, '\\=');
        const runId = esc(config.runId);
        const nodeName = esc(config.nodeName);
        const lines = [];
        // requestsRaw — one line per HTTP request (same format as k6 boilerplate scripts)
        for (const r of requests) {
            const reqName = esc(r.name);
            const result = r.failed ? 'fail' : 'pass';
            const tags = `requestName=${reqName},samplerType=request,runId=${runId},nodeName=${nodeName},result=${result}`;
            lines.push(`requestsRaw,${tags} responseTime=${r.ms},errorCount=${r.failed ? 1 : 0}i ${nowNs()}`);
        }
        // virtualUsers — written whenever we have a VU snapshot (Grafana "Active Users" panel)
        if (latestVUs != null) {
            const tags = `runId=${runId},nodeName=${nodeName}`;
            lines.push(`virtualUsers,${tags} meanActiveThreads=${latestVUs} ${nowNs()}`);
        }
        // testStartEnd — signals test lifecycle (Grafana annotations)
        if (eventType) {
            const tags = `runId=${runId},nodeName=${nodeName},type=${eventType}`;
            lines.push(`testStartEnd,${tags} placeholder=1i ${nowNs()}`);
        }
        if (lines.length === 0)
            return;
        const writeUrl = new URL(`/api/v2/write?org=${encodeURIComponent(config.org)}&bucket=${encodeURIComponent(config.bucket)}&precision=ns`, config.url);
        return new Promise((resolve, reject) => {
            const body = Buffer.from(lines.join('\n'), 'utf8');
            const transport = writeUrl.protocol === 'https:' ? https : http;
            const req = transport.request({
                hostname: writeUrl.hostname,
                port: writeUrl.port || (writeUrl.protocol === 'https:' ? 443 : 80),
                path: writeUrl.pathname + writeUrl.search,
                method: 'POST',
                headers: {
                    Authorization: `Token ${config.token}`,
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Content-Length': body.length,
                },
                timeout: 5000,
            }, (res) => { res.resume(); resolve(); });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('InfluxDB write timeout')); });
            req.write(body);
            req.end();
        });
    }
    // ── Load profile injection ────────────────────────────────────────────────
    /**
     * Always rebuilds the options block from scratch using the exact profile the
     * user selected in the Executor UI.
     *
     * Key design decisions
     * ────────────────────
     * • The Executor's load profile ALWAYS wins — any existing options.scenarios,
     *   options.stages, options.vus, or options.duration in the script are stripped
     *   and replaced.
     *
     * • Named exec functions are preserved.  AI-generated and Test-Authoring scripts
     *   use `exec: 'someFunction'` inside scenarios.  If we detect that pattern, we
     *   wrap the new profile inside a scenarios block that points to the same function,
     *   so the actual test logic still runs.  For plain scripts (no custom exec) the
     *   simpler vus/duration or stages shorthand is used — K6 will call default().
     *
     * • The new options block is inserted after the last top-level import statement
     *   (ES module spec requires imports to precede other declarations).
     */
    injectLoadProfile(config) {
        const profileType = config.profileType ?? 'staged';
        // For staged mode we must have at least one stage — the script's own
        // load profile (e.g. an env-driven default) is left untouched, but still
        // deduped in case it somehow contains more than one `options` export.
        if (profileType === 'staged' && (!config.stages || config.stages.length === 0)) {
            return this.dedupeOptionsBlocks(config.script);
        }
        // ── Collect ALL named exec functions ──────────────────────────────────────
        // HAR-generated and AI-generated scripts may define multiple scenarios each
        // with its own exec function (e.g. GET__usersTest, POST__ordersTest).
        // Using only the first match (old behaviour) caused k6 to run only one
        // scenario — or worse, fall back to the empty default() function — when the
        // script contained many named exec references.
        //
        // Primary: look for exec: 'name' references inside the existing options block.
        // Fallback: look for exported named functions (export function foo() / export
        // async function foo()) — used when the script has named functions but the
        // options block either doesn't exist or uses the vus/duration shorthand.
        // 'default' is always excluded; that's k6's implicit scenario entry point.
        let execNames = [
            ...new Set([...config.script.matchAll(/exec\s*:\s*['"`]([^'"`\s]+)['"`]/g)]
                .map(m => m[1])
                .filter(n => n !== 'default')),
        ];
        if (execNames.length === 0) {
            // Fallback: collect all exported named functions as candidate exec targets.
            // Matches both `export function foo()` and `export async function foo()`.
            // k6 lifecycle functions (setup/teardown/handleSummary) must be excluded —
            // they receive special arguments from k6 and MUST NOT be used as scenario
            // exec functions (running handleSummary() in a loop causes crashes because
            // the `data` argument is undefined when k6 doesn't call it as a lifecycle hook).
            const K6_LIFECYCLE = new Set(['default', 'setup', 'teardown', 'handleSummary']);
            execNames = [
                ...new Set([...config.script.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(/g)]
                    .map(m => m[1])
                    .filter(n => !K6_LIFECYCLE.has(n))),
            ];
        }
        // ── Preserve the script's own thresholds ──────────────────────────────────
        // The Executor's load profile always wins for scenarios/VUs/duration, but the
        // script author (or Claude, per the HAR/AI generation prompts) tuned these
        // thresholds against the target's actual behavior — e.g. a lenient
        // http_req_failed rate to tolerate expected auth-probe responses. Dropping
        // them silently changed pass/fail semantics between a local `k6 run` and an
        // Executor-dispatched run of the exact same script.
        const originalThresholds = this.extractThresholdsBlock(config.script);
        const thresholdsLine = originalThresholds ? `  ${originalThresholds},\n` : '';
        // ── Build the replacement options block ───────────────────────────────────
        let optionsBlock;
        if (profileType === 'constant') {
            const vus = config.vus ?? 10;
            const duration = config.duration ?? '1m';
            if (execNames.length > 0) {
                // One constant-vus scenario per exec function, VUs split evenly
                const vusEach = Math.max(1, Math.round(vus / execNames.length));
                const scenarios = execNames.map(name => `    ${name}_run: {\n` +
                    `      executor: 'constant-vus',\n` +
                    `      vus: ${vusEach},\n` +
                    `      duration: '${duration}',\n` +
                    `      exec: '${name}',\n` +
                    `      gracefulStop: '30s',\n` +
                    `    }`).join(',\n');
                optionsBlock =
                    `export const options = {\n` +
                        `  scenarios: {\n${scenarios},\n  },\n` +
                        thresholdsLine +
                        `};\n`;
            }
            else {
                // Simple script — use the built-in vus/duration shorthand (runs default())
                optionsBlock =
                    `export const options = {\n` +
                        `  vus: ${vus},\n` +
                        `  duration: '${duration}',\n` +
                        thresholdsLine +
                        `};\n`;
            }
        }
        else {
            // staged
            const stagesStr = (config.stages ?? [])
                .map(s => `        { duration: '${s.duration}', target: ${s.target} }`)
                .join(',\n');
            if (execNames.length > 0) {
                // One ramping-vus scenario per exec function, targets split evenly
                const scenarios = execNames.map(name => `    ${name}_run: {\n` +
                    `      executor: 'ramping-vus',\n` +
                    `      stages: [\n${stagesStr},\n      ],\n` +
                    `      exec: '${name}',\n` +
                    `      gracefulRampDown: '30s',\n` +
                    `    }`).join(',\n');
                optionsBlock =
                    `export const options = {\n` +
                        `  scenarios: {\n${scenarios},\n  },\n` +
                        thresholdsLine +
                        `};\n`;
            }
            else {
                // Simple script — use the built-in stages shorthand (runs default())
                optionsBlock =
                    `export const options = {\n` +
                        `  stages: [\n${stagesStr},\n  ],\n` +
                        thresholdsLine +
                        `};\n`;
            }
        }
        // ── Strip the existing options block (if any) ─────────────────────────────
        const stripped = this.stripOptionsBlock(config.script);
        // ── Insert after the last import statement ────────────────────────────────
        const insertAt = this.findPostImportIndex(stripped);
        const before = stripped.slice(0, insertAt).trimEnd();
        const after = stripped.slice(insertAt).trimStart();
        return ((before ? before + '\n\n' : '') +
            optionsBlock +
            (after ? '\n' + after : ''));
    }
    /**
     * Extracts the verbatim `thresholds: { ... }` property (no trailing comma)
     * from the script's existing `export const options = { ... }` block, so it
     * can be spliced back into the Executor-rebuilt options block. Returns null
     * if the script has no options block or no thresholds property.
     */
    extractThresholdsBlock(script) {
        const optionsMatch = script.match(/export\s+(?:const|let|var)\s+options\s*=/);
        if (!optionsMatch || optionsMatch.index === undefined)
            return null;
        const optionsBraceStart = script.indexOf('{', optionsMatch.index);
        if (optionsBraceStart === -1)
            return null;
        let depth = 0;
        let optionsBraceEnd = -1;
        for (let i = optionsBraceStart; i < script.length; i++) {
            if (script[i] === '{')
                depth++;
            else if (script[i] === '}') {
                if (--depth === 0) {
                    optionsBraceEnd = i;
                    break;
                }
            }
        }
        if (optionsBraceEnd === -1)
            return null;
        const optionsBody = script.slice(optionsBraceStart + 1, optionsBraceEnd);
        const thresholdsMatch = optionsBody.match(/thresholds\s*:\s*\{/);
        if (!thresholdsMatch || thresholdsMatch.index === undefined)
            return null;
        const thBraceStart = optionsBody.indexOf('{', thresholdsMatch.index);
        let thDepth = 0;
        let thBraceEnd = -1;
        for (let i = thBraceStart; i < optionsBody.length; i++) {
            if (optionsBody[i] === '{')
                thDepth++;
            else if (optionsBody[i] === '}') {
                if (--thDepth === 0) {
                    thBraceEnd = i;
                    break;
                }
            }
        }
        if (thBraceEnd === -1)
            return null;
        return optionsBody.slice(thresholdsMatch.index, thBraceEnd + 1);
    }
    /**
     * Removes EVERY `export const/let/var options = { ... };` block from a K6
     * script — not just the first. A single leftover declaration (from a
     * generation glitch, or simply because the original script used `let`/`var`
     * instead of `const`) plus the block this class inserts afterward both
     * count as exports named `options`, which k6's goja module loader rejects
     * outright with "Duplicate export name 'options'" before running a single
     * line — so this must be exhaustive, not "strip the first match and stop".
     * Uses brace-counting to handle deeply nested objects correctly.
     */
    stripOptionsBlock(script) {
        const re = /export\s+(?:const|let|var)\s+options\s*=/;
        let result = script;
        while (true) {
            const match = result.match(re);
            if (!match || match.index === undefined)
                break;
            const braceStart = result.indexOf('{', match.index);
            if (braceStart === -1)
                break;
            let depth = 0;
            let braceEnd = -1;
            for (let i = braceStart; i < result.length; i++) {
                if (result[i] === '{')
                    depth++;
                else if (result[i] === '}') {
                    if (--depth === 0) {
                        braceEnd = i;
                        break;
                    }
                }
            }
            if (braceEnd === -1)
                break;
            // Consume optional trailing semicolon and blank lines
            let end = braceEnd + 1;
            while (end < result.length && result[end] === ';')
                end++;
            while (end < result.length && (result[end] === '\n' || result[end] === '\r'))
                end++;
            result = (result.slice(0, match.index).trimEnd() + '\n' + result.slice(end)).trimStart();
        }
        return result;
    }
    /**
     * Defense-in-depth for the branch below that returns the script UNCHANGED
     * (no scenario rebuild) — if that untouched script happens to already
     * contain more than one `options` export, k6 refuses to load it at all.
     * Keeps the first declaration (matches this codebase's own generation
     * prompts, which mandate a single options block placed right after
     * imports) and drops any later ones.
     */
    dedupeOptionsBlocks(script) {
        const re = /export\s+(?:const|let|var)\s+options\s*=/g;
        const count = (script.match(re) ?? []).length;
        if (count <= 1)
            return script;
        const firstMatch = /export\s+(?:const|let|var)\s+options\s*=/.exec(script);
        const braceStart = script.indexOf('{', firstMatch.index);
        let depth = 0;
        let braceEnd = -1;
        for (let i = braceStart; i < script.length; i++) {
            if (script[i] === '{')
                depth++;
            else if (script[i] === '}') {
                if (--depth === 0) {
                    braceEnd = i;
                    break;
                }
            }
        }
        if (braceEnd === -1)
            return script; // malformed — leave as-is, will fail loudly either way
        let firstBlockEnd = braceEnd + 1;
        if (script[firstBlockEnd] === ';')
            firstBlockEnd++;
        const before = script.slice(0, firstBlockEnd);
        const rest = this.stripOptionsBlock(script.slice(firstBlockEnd));
        return before + '\n' + rest.trimStart();
    }
    /**
     * Returns the character index immediately after the last top-level `import`
     * statement.  The options block is inserted here so it follows all imports
     * (required by ES module specification).
     */
    findPostImportIndex(script) {
        const lines = script.split('\n');
        let lastImportEnd = 0;
        let charOffset = 0;
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('import ') || trimmed.startsWith('import{')) {
                lastImportEnd = charOffset + line.length + 1; // +1 for '\n'
            }
            charOffset += line.length + 1;
        }
        return lastImportEnd;
    }
    /**
     * Monkey-patches every k6/http method (get/post/put/patch/del/head/options/
     * request) to log full request + response details after each call - so the
     * Executor's console output always shows method, URL, request headers,
     * request payload, response status, response headers, and response body,
     * regardless of whether the script itself does any logging. This is
     * intentionally done here (at execution time) rather than baked into
     * generated scripts, so it applies uniformly to every script PerfOps runs:
     * AI-generated, generator-built, hand-pasted custom scripts, and scripts
     * that were saved before this feature existed.
     *
     * k6/http only has a default export (no named per-method exports), so this
     * only needs to find the local binding name from `import X from 'k6/http'`.
     * If the script doesn't import k6/http at all, this is a no-op.
     */
    injectRequestResponseLogging(script) {
        const importMatch = script.match(/import\s+(\w+)\s+from\s+['"]k6\/http['"]/);
        if (!importMatch)
            return script;
        const httpBinding = importMatch[1];
        const patchSnippet = `// PerfOps: auto-injected request/response console logging (does not alter script behavior)
(function() {
  var __ppMethods = ['get', 'post', 'put', 'patch', 'del', 'head', 'options', 'request'];
  __ppMethods.forEach(function(__ppMethod) {
    var __ppOriginal = ${httpBinding}[__ppMethod];
    if (typeof __ppOriginal !== 'function') return;
    ${httpBinding}[__ppMethod] = function() {
      var __ppRes = __ppOriginal.apply(${httpBinding}, arguments);
      try {
        var __ppReq = __ppRes.request || {};
        console.log('[' + (__ppReq.method || '?') + '] ' + (__ppReq.url || '?'));
        console.log('  Request Headers: ' + JSON.stringify(__ppReq.headers || {}));
        console.log('  Request Payload: ' + (__ppReq.body ? String(__ppReq.body).slice(0, 1000) : '(none)'));
        console.log('  Response Status: ' + __ppRes.status);
        console.log('  Response Headers: ' + JSON.stringify(__ppRes.headers || {}));
        console.log('  Response Body: ' + (__ppRes.body ? String(__ppRes.body).slice(0, 1000) : '(empty)'));
      } catch (__ppErr) {}
      return __ppRes;
    };
  });
})();
`;
        const insertAt = this.findPostImportIndex(script);
        const before = script.slice(0, insertAt).trimEnd();
        const after = script.slice(insertAt).trimStart();
        return (before ? before + '\n\n' : '') + patchSnippet + (after ? '\n' + after : '');
    }
    /**
     * Augments the script's handleSummary export to also emit a PTAAS_SUMMARY: JSON
     * line on stdout before returning.  The backend parses this line to extract
     * threshold pass/fail results and check pass/fail counts without relying on
     * k6's human-readable text summary format.
     *
     * If the script already has a handleSummary, the function body is preserved
     * unchanged — the JSON emission is injected as the very first statement.
     * If no handleSummary exists, a minimal one is injected.
     */
    injectSummaryCapture(script) {
        const captureCode = 
        // "actual" is a best-effort read of the metric's own value matching the
        // threshold's stat (e.g. condition "p(95)<800" -> mObj.values['p(95)'];
        // "rate<0.01" -> mObj.values.rate) — was previously never captured at
        // all, so every threshold row in the report showed a blank Actual column.
        `  var __ptaasThresh = [];\n` +
            `  try {\n` +
            `    if (data && data.metrics) {\n` +
            `      Object.entries(data.metrics).forEach(function(e) {\n` +
            `        var mn = e[0], mObj = e[1];\n` +
            `        if (mObj && mObj.thresholds) {\n` +
            `          Object.entries(mObj.thresholds).forEach(function(te) {\n` +
            `            var statMatch = te[0].match(/^[a-zA-Z_][\\w()]*/);\n` +
            `            var actual = (statMatch && mObj.values) ? mObj.values[statMatch[0]] : undefined;\n` +
            `            __ptaasThresh.push({ metric: mn, condition: te[0], passed: !!te[1].ok, actual: actual });\n` +
            `          });\n` +
            `        }\n` +
            `      });\n` +
            `    }\n` +
            `  } catch(__ptaasErr) {}\n` +
            // k6's summary data has NO top-level `data.checks` — individual check
            // pass/fail results live nested under `data.root_group.checks`, and
            // under `data.root_group.groups[].checks` for any check() inside a
            // group() (which every check in the REPLAY HARNESS pattern is, via
            // group(reqDef.name, ...) — so this must walk the group tree, not read
            // a flat property that doesn't exist. In k6 v2.x, root_group.checks and
            // root_group.groups are ARRAYS of self-describing objects (each check
            // object already has its own .name/.passes/.fails; each group object
            // has its own .checks/.groups) — NOT keyed objects. Handle both shapes
            // defensively (older k6 versions used keyed objects) rather than
            // assuming one, since assuming wrong here previously produced numeric
            // index names ("0", "1") instead of real check names, or nothing at
            // all. Also computes passRate here — the report table reads it directly.
            `  var __ptaasChecks = [];\n` +
            `  try {\n` +
            `    var __ptaasPushCheck = function(cn, chk) {\n` +
            `      var p = chk.passes || 0, f = chk.fails || 0;\n` +
            `      __ptaasChecks.push({ name: chk.name || chk.path || cn, passes: p, fails: f, passed: f === 0, passRate: (p + f) > 0 ? (p / (p + f)) * 100 : 100 });\n` +
            `    };\n` +
            `    var __ptaasCollectChecks = function(g) {\n` +
            `      if (!g) return;\n` +
            `      if (Array.isArray(g.checks)) { g.checks.forEach(function(chk) { __ptaasPushCheck(chk.name, chk); }); }\n` +
            `      else if (g.checks) { Object.entries(g.checks).forEach(function(ce) { __ptaasPushCheck(ce[0], ce[1]); }); }\n` +
            `      if (Array.isArray(g.groups)) { g.groups.forEach(__ptaasCollectChecks); }\n` +
            `      else if (g.groups) { Object.values(g.groups).forEach(__ptaasCollectChecks); }\n` +
            `    };\n` +
            `    if (data && data.root_group) { __ptaasCollectChecks(data.root_group); }\n` +
            `  } catch(__ptaasErr) {}\n` +
            `  console.log('PTAAS_SUMMARY:' + JSON.stringify({ thresholdResults: __ptaasThresh, checkResults: __ptaasChecks }));\n`;
        const hsFuncRe = /export\s+(?:async\s+)?function\s+handleSummary\s*\(\s*(\w+)\s*\)\s*\{/;
        const match = script.match(hsFuncRe);
        if (match && match.index !== undefined) {
            // Find the opening brace and do brace-matching to locate the closing brace
            const bodyStart = script.indexOf('{', match.index + match[0].length - 1);
            let depth = 0, bodyEnd = -1;
            for (let i = bodyStart; i < script.length; i++) {
                if (script[i] === '{')
                    depth++;
                else if (script[i] === '}') {
                    if (--depth === 0) {
                        bodyEnd = i;
                        break;
                    }
                }
            }
            if (bodyEnd === -1)
                return script; // malformed — leave untouched
            const dataParam = match[1];
            const origBody = script.slice(bodyStart + 1, bodyEnd).trim();
            // Replace data param name if script uses something other than 'data'
            const capture = dataParam === 'data' ? captureCode : captureCode.replace(/\bdata\b/g, dataParam);
            const newFunc = `export function handleSummary(${dataParam}) {\n` +
                capture +
                `  ${origBody}\n` +
                `}`;
            return script.slice(0, match.index) + newFunc + script.slice(bodyEnd + 1);
        }
        // No handleSummary found — inject a minimal one at the end
        const minimalFunc = `\nexport function handleSummary(data) {\n` +
            captureCode +
            `  return { stdout: '' };\n` +
            `}\n`;
        return script + minimalFunc;
    }
    // ── System metrics ────────────────────────────────────────────────────────
    startSystemMetrics() {
        this.metricsInterval = setInterval(async () => {
            try {
                const cpus = os.cpus();
                const totalMem = os.totalmem();
                const freeMem = os.freemem();
                const usedMemPct = ((totalMem - freeMem) / totalMem) * 100;
                const cpuUsage = cpus.reduce((acc, cpu) => {
                    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
                    return acc + ((total - cpu.times.idle) / total) * 100;
                }, 0) / cpus.length;
                let processCpu = 0;
                let processMem = 0;
                if (this.process?.pid) {
                    try {
                        const stats = await (0, pidusage_1.default)(this.process.pid);
                        processCpu = stats.cpu;
                        processMem = (stats.memory / totalMem) * 100;
                    }
                    catch { }
                }
                this.onUpdate({
                    type: 'system',
                    timestamp: Date.now(),
                    data: {
                        systemCpuPct: Math.round(cpuUsage * 10) / 10,
                        systemMemPct: Math.round(usedMemPct * 10) / 10,
                        processCpuPct: Math.round(processCpu * 10) / 10,
                        processMemPct: Math.round(processMem * 10) / 10,
                        totalMemMB: Math.round(totalMem / 1024 / 1024),
                        freeMemMB: Math.round(freeMem / 1024 / 1024),
                    },
                });
            }
            catch { }
        }, 1000);
    }
    stopSystemMetrics() {
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
            this.metricsInterval = null;
        }
    }
    // ── Script validation ─────────────────────────────────────────────────────
    /**
     * Ensures the script has export default function — required by K6 even when
     * all scenarios use named exec functions. Auto-injects if missing.
     */
    validateScript(script) {
        // The agent writes exactly one file per run (to os.tmpdir()) — there is no
        // companion project structure alongside it. A script that imports a sibling
        // module via a relative path (e.g. '../utils/httpRequests.js') will always
        // fail inside k6 with an opaque "couldn't be found on local disk" error, since
        // that file never exists next to the generated temp script. Fail fast here
        // with a message that actually explains the constraint.
        const relativeImports = [
            ...new Set([...script.matchAll(/import\s+(?:[\w*\s{},]+\s+from\s+)?['"](\.\.?\/[^'"]+)['"]/g)]
                .map(m => m[1])),
        ];
        if (relativeImports.length > 0) {
            throw new Error(`Script imports local file(s) that this runner can't provide: ${relativeImports.join(', ')}. ` +
                `Only single-file k6 scripts are supported — imports must come from 'k6', 'k6/x/*', or a full URL (e.g. https://jslib.k6.io/...), not a relative path.`);
        }
        // k6 exposes DELETE as http.del() — 'delete' is a reserved JavaScript keyword
        // so http.delete() doesn't exist in the k6 runtime. Replace it unconditionally
        // so previously-saved scripts and AI-generated scripts all work correctly.
        let s = script.replace(/\bhttp\.delete\s*\(/g, 'http.del(');
        // Matches any default export form — function, async function, or arrow
        // (`export default async () => {}`, `export default () => {}`, etc).
        // Checking only the function-keyword forms missed arrow-style default
        // exports and appended a second `export default`, which is a SyntaxError.
        const hasDefault = /\bexport\s+default\b/.test(s);
        if (!hasDefault) {
            console.warn('[K6Runner] Script missing export default function — auto-injecting');
            return s + '\n\n// Auto-injected by PerfOps agent\nexport default function() {}\n';
        }
        return s;
    }
    // ── Progress line parsing (VUs/progress only — not for chart history) ─────
    /**
     * Parses K6's stderr progress lines for VU count and % completion.
     * p50/p95 are NOT extracted here — those come from the JSON metrics stream
     * so the chart gets real data points every 2s instead of only at the end.
     */
    buildSummary() {
        const sorted = [...this.durationWindow].sort((a, b) => a - b);
        const n = sorted.length;
        // Enrich check results with passRate percentage for report display
        const checkResults = (this.capturedSummary?.checkResults ?? []).map((c) => {
            const total = (c.passes ?? 0) + (c.fails ?? 0);
            return { ...c, passRate: total > 0 ? (c.passes / total) * 100 : 100 };
        });
        const thresholdResults = this.capturedSummary?.thresholdResults ?? [];
        // No duration samples (e.g. the run failed before any request completed) —
        // still surface whatever threshold/check results k6's handleSummary captured,
        // rather than dropping the whole summary and leaving the report with no
        // explanation beyond a bare exit code.
        if (n === 0) {
            return this.capturedSummary
                ? { metrics: {}, p50: null, p90: null, p95: null, p99: null, errorRate: null,
                    totalRequests: this.totalRequestsCount, thresholdResults, checkResults }
                : null;
        }
        const pct = (q) => sorted[Math.min(Math.floor(n * q), n - 1)];
        const errorRate = this.totalRequestsCount > 0
            ? (this.failedRequestsCount / this.totalRequestsCount) * 100
            : 0;
        return {
            metrics: {
                http_req_duration: {
                    values: {
                        'p(50)': Math.round(pct(0.50) * 10) / 10,
                        'p(90)': Math.round(pct(0.90) * 10) / 10,
                        'p(95)': Math.round(pct(0.95) * 10) / 10,
                        'p(99)': Math.round(pct(0.99) * 10) / 10,
                    },
                },
                http_req_failed: {
                    values: { rate: this.failedRequestsCount / this.totalRequestsCount },
                },
            },
            // Flat fields for quick access
            p50: Math.round(pct(0.50) * 10) / 10,
            p90: Math.round(pct(0.90) * 10) / 10,
            p95: Math.round(pct(0.95) * 10) / 10,
            p99: Math.round(pct(0.99) * 10) / 10,
            errorRate,
            totalRequests: this.totalRequestsCount,
            thresholdResults,
            checkResults,
        };
    }
    tryParseProgressLine(line) {
        // Detect the final "✓ [ 100% ]" completion marker k6 prints when the test
        // finishes. Setting stopped here prevents the forEach loop from forwarding
        // the dozens of identical "running (1m00.0s) … 00/10 VUs" lines that k6
        // buffers during graceful stop and flushes all at once on process exit.
        if (line.includes('✓') && line.includes('100%')) {
            this.stopped = true;
            return;
        }
        const runningVUMatch = line.match(/running\s+\([^)]+\),\s*(\d+)\/(\d+)\s+VUs?/i);
        const pctMatch = line.match(/\[\s*(\d+)%\s*\]/);
        // Only emit a metric update for VU/progress — no p95/p50 here.
        // That keeps chart history clean: history points are only added when
        // real latency data arrives from the JSON stream every 2s.
        if (runningVUMatch || pctMatch) {
            const vus = runningVUMatch ? parseInt(runningVUMatch[1]) : undefined;
            const progress = pctMatch ? parseInt(pctMatch[1]) : undefined;
            if (vus !== undefined || progress !== undefined) {
                this.onUpdate({
                    type: 'metric',
                    timestamp: Date.now(),
                    data: { vus, progress },
                });
            }
        }
    }
}
exports.K6Runner = K6Runner;
