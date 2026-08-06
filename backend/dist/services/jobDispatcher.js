"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchJob = dispatchJob;
exports.dispatchJobToAgent = dispatchJobToAgent;
const agentRegistry_1 = require("./agentRegistry");
const prisma_1 = __importDefault(require("../lib/prisma"));
/**
 * Build the InfluxDB env vars the K6 script needs.
 * The script uses __ENV.INFLUX_V2_* to enable writeInfluxLines().
 * We map INFLUXDB_* (backend naming) → INFLUX_V2_* (K6 script naming).
 */
function buildInfluxEnvVars() {
    const vars = {};
    if (process.env.INFLUXDB_URL)
        vars['INFLUX_V2_URL'] = process.env.INFLUXDB_URL;
    if (process.env.INFLUXDB_TOKEN)
        vars['INFLUX_V2_TOKEN'] = process.env.INFLUXDB_TOKEN;
    if (process.env.INFLUXDB_ORG)
        vars['INFLUX_V2_ORG'] = process.env.INFLUXDB_ORG;
    if (process.env.INFLUXDB_BUCKET)
        vars['INFLUX_V2_BUCKET'] = process.env.INFLUXDB_BUCKET;
    return vars;
}
async function sendToAgent(agentId, executionId, script, config) {
    // Generate the run identity once here so the timestamp is shared between
    // startedAt (stored in DB) and RUN_ID (passed to k6 / InfluxDB).
    // This lets queryFromRequestsRaw reconstruct the runId from startedAt
    // without needing a separate DB column.
    const startedAt = new Date();
    const runId = `PerfOps-${startedAt.getTime()}`;
    await prisma_1.default.execution.update({
        where: { id: executionId },
        data: {
            status: 'running',
            agentId,
            startedAt,
        },
    });
    agentRegistry_1.agentRegistry.setStatus(agentId, 'busy');
    const enrichedConfig = {
        ...config,
        envVars: {
            ...buildInfluxEnvVars(), // INFLUX_V2_* from backend/.env
            RUN_ID: runId, // PerfOps-{ms} — stable, human-readable in Grafana
            TESTID: executionId,
            ...(config.envVars ?? {}), // user overrides win
        },
    };
    const dispatched = agentRegistry_1.agentRegistry.dispatch(agentId, {
        type: 'dispatch_job',
        executionId,
        script,
        config: enrichedConfig,
    });
    if (!dispatched) {
        agentRegistry_1.agentRegistry.setStatus(agentId, 'online');
        throw new Error('Failed to dispatch job to agent — connection may have dropped');
    }
    return agentId;
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function dispatchJob(executionId, script, config) {
    // Agents reconnect ~5s after a drop (e.g. a backend restart during deploy/dev).
    // A scheduled cron tick that fires in that exact window used to fail outright
    // with no k6 process ever launched — retry briefly instead of failing on the
    // very first check.
    let agent = agentRegistry_1.agentRegistry.getAvailable();
    for (let attempt = 0; !agent && attempt < 6; attempt++) {
        await sleep(2000);
        agent = agentRegistry_1.agentRegistry.getAvailable();
    }
    if (!agent) {
        throw new Error('No execution agents are online. Start an agent to run tests.');
    }
    return sendToAgent(agent.agentId, executionId, script, config);
}
// Redispatch to the SAME agent that just finished a job — used by the
// auto-fix/retry loop. getAvailable()/dispatchJob won't work here: the agent
// that finished this job is still marked 'busy' in our bookkeeping (only
// flipped back to 'online' once the retry/finalize path completes), even
// though it's actually free. isConnected() checks the socket instead of that
// stale status flag. Falls back to picking any other available agent if the
// original one has disconnected since.
async function dispatchJobToAgent(agentId, executionId, script, config) {
    if (!agentRegistry_1.agentRegistry.isConnected(agentId)) {
        return dispatchJob(executionId, script, config);
    }
    return sendToAgent(agentId, executionId, script, config);
}
