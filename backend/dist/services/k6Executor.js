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
exports.K6Executor = void 0;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const pidusage_1 = __importDefault(require("pidusage"));
class K6Executor {
    constructor(onUpdate) {
        this.onUpdate = onUpdate;
        this.process = null;
        this.metricsInterval = null;
        this.executionId = `exec-local-${Date.now()}`;
    }
    async run(config) {
        const scriptContent = this.injectLoadProfile(config);
        const tmpDir = os.tmpdir();
        const scriptPath = path.join(tmpDir, `perfops-${Date.now()}.js`);
        const summaryPath = path.join(tmpDir, `perfops-summary-${Date.now()}.json`);
        fs.writeFileSync(scriptPath, scriptContent);
        const args = ['run', '--out', `json=${summaryPath}`, scriptPath];
        if (config.vus && config.profileType === 'constant') {
            args.push('--vus', String(config.vus));
            args.push('--duration', config.duration || '1m');
        }
        const env = {
            ...process.env,
            PATH: `${process.env.HOME}/bin:${process.env.PATH}:/usr/local/bin:/opt/homebrew/bin`,
            BASE_URL: config.baseUrl || 'http://localhost:3000',
            ...config.envVars,
        };
        // Resolve k6 binary — check common paths
        const k6Bin = [
            `${process.env.HOME}/bin/k6`,
            '/usr/local/bin/k6',
            '/opt/homebrew/bin/k6',
            'k6',
        ].find(p => { try {
            require('fs').accessSync(p);
            return true;
        }
        catch {
            return false;
        } }) || 'k6';
        this.process = (0, child_process_1.spawn)(k6Bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
        this.startSystemMetrics();
        this.process.stdout?.on('data', (chunk) => {
            const lines = chunk.toString().split('\n').filter(Boolean);
            lines.forEach(line => {
                this.onUpdate({ type: 'log', timestamp: Date.now(), data: { line } });
                this.tryParseMetricLine(line);
            });
        });
        this.process.stderr?.on('data', (chunk) => {
            const lines = chunk.toString().split('\n').filter(Boolean);
            lines.forEach(line => {
                this.onUpdate({ type: 'log', timestamp: Date.now(), data: { line, isStderr: true } });
                this.tryParseMetricLine(line);
            });
        });
        return new Promise((resolve, reject) => {
            this.process.on('close', (code) => {
                this.stopSystemMetrics();
                let summary = null;
                try {
                    summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
                }
                catch { }
                this.onUpdate({
                    type: 'complete',
                    timestamp: Date.now(),
                    data: { exitCode: code, executionId: this.executionId, summary },
                });
                try {
                    fs.unlinkSync(scriptPath);
                }
                catch { }
                try {
                    fs.unlinkSync(summaryPath);
                }
                catch { }
                resolve(this.executionId);
            });
            this.process.on('error', (err) => {
                this.stopSystemMetrics();
                if (err.code === 'ENOENT' || err.message.includes('ENOENT')) {
                    this.onUpdate({
                        type: 'error',
                        timestamp: Date.now(),
                        data: {
                            message: 'K6 not found. Please install k6: https://k6.io/docs/get-started/installation/',
                            code: 'K6_NOT_FOUND',
                        },
                    });
                }
                else {
                    this.onUpdate({ type: 'error', timestamp: Date.now(), data: { message: err.message } });
                }
                reject(err);
            });
        });
    }
    stop() {
        if (this.process) {
            this.process.kill('SIGTERM');
        }
        this.stopSystemMetrics();
    }
    injectLoadProfile(config) {
        if (!config.stages || config.stages.length === 0)
            return config.script;
        const stagesJson = JSON.stringify(config.stages);
        const replaced = config.script.replace(/stages:\s*\[[\s\S]*?\]/m, `stages: ${stagesJson}`);
        if (replaced !== config.script)
            return replaced;
        // If no stages found in script, prepend injection as comment
        return `// PerfOps injected stages: ${stagesJson}\n${config.script}`;
    }
    startSystemMetrics() {
        this.metricsInterval = setInterval(async () => {
            try {
                const cpus = os.cpus();
                const totalMem = os.totalmem();
                const freeMem = os.freemem();
                const usedMemPct = ((totalMem - freeMem) / totalMem) * 100;
                const cpuUsage = cpus.reduce((acc, cpu) => {
                    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
                    const idle = cpu.times.idle;
                    return acc + ((total - idle) / total) * 100;
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
    tryParseMetricLine(line) {
        // Normalise time values to ms (k6 prints µs, ms, or s)
        const toMs = (val, unit) => {
            const n = parseFloat(val);
            if (unit === 'µs' || unit === 'us')
                return n / 1000;
            if (unit === 's')
                return n * 1000;
            return n; // ms
        };
        const vuMatch = line.match(/(\d+)\s+VUs?/i);
        const pctMatch = line.match(/\[\s*(\d+)%\s*\]/);
        // k6 progress line:  running (04.0s), 3/3 VUs, ...
        const runningVUMatch = line.match(/running\s+\([^)]+\),\s*(\d+)\/(\d+)\s+VUs?/i);
        // Summary table line:  http_req_duration..............: avg=388µs ... p(90)=548µs p(95)=620µs
        const durLine = line.includes('http_req_duration') && !line.includes('expected_response');
        const p95Match = line.match(/p\(95\)=([0-9.]+)(µs|us|ms|s)\b/);
        const p90Match = line.match(/p\(90\)=([0-9.]+)(µs|us|ms|s)\b/);
        const p50Match = line.match(/med=([0-9.]+)(µs|us|ms|s)\b/) || line.match(/p\(50\)=([0-9.]+)(µs|us|ms|s)\b/);
        const avgMatch = line.match(/avg=([0-9.]+)(µs|us|ms|s)\b/);
        // http_reqs line: http_reqs....: 57628   7202.650087/s
        const rpsMatch = line.match(/http_reqs[^:]*:\s+\d+\s+([0-9.]+)\/s/);
        // running progress line also has rate info
        const runRpsMatch = line.match(/,\s*(\d+)\s+complete.*?(\d+\.?\d*)\/s/);
        const errPctMatch = line.match(/http_req_failed[^:]*:\s+([0-9.]+)%/);
        const currentVUs = runningVUMatch ? parseInt(runningVUMatch[1]) : (vuMatch ? parseInt(vuMatch[1]) : undefined);
        if (currentVUs !== undefined || p95Match || pctMatch || rpsMatch || (durLine && avgMatch)) {
            this.onUpdate({
                type: 'metric',
                timestamp: Date.now(),
                data: {
                    vus: currentVUs,
                    progress: pctMatch ? parseInt(pctMatch[1]) : undefined,
                    p95: p95Match ? toMs(p95Match[1], p95Match[2]) : undefined,
                    p90: p90Match ? toMs(p90Match[1], p90Match[2]) : undefined,
                    p50: p50Match ? toMs(p50Match[1], p50Match[2]) : undefined,
                    avg: avgMatch ? toMs(avgMatch[1], avgMatch[2]) : undefined,
                    rps: rpsMatch ? parseFloat(rpsMatch[1])
                        : runRpsMatch ? parseFloat(runRpsMatch[2])
                            : undefined,
                    errorRate: errPctMatch ? parseFloat(errPctMatch[1]) : undefined,
                },
            });
        }
    }
}
exports.K6Executor = K6Executor;
