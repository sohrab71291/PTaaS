"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchJob = dispatchJob;
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
async function dispatchJob(executionId, script, config) {
    const agent = agentRegistry_1.agentRegistry.getAvailable();
    if (!agent) {
        throw new Error('No execution agents are online. Start an agent to run tests.');
    }
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
            agentId: agent.agentId,
            startedAt,
        },
    });
    agentRegistry_1.agentRegistry.setStatus(agent.agentId, 'busy');
    const enrichedConfig = {
        ...config,
        envVars: {
            ...buildInfluxEnvVars(), // INFLUX_V2_* from backend/.env
            RUN_ID: runId, // PerfOps-{ms} — stable, human-readable in Grafana
            TESTID: executionId,
            ...(config.envVars ?? {}), // user overrides win
        },
    };
    const dispatched = agentRegistry_1.agentRegistry.dispatch(agent.agentId, {
        type: 'dispatch_job',
        executionId,
        script,
        config: enrichedConfig,
    });
    if (!dispatched) {
        agentRegistry_1.agentRegistry.setStatus(agent.agentId, 'online');
        throw new Error('Failed to dispatch job to agent — connection may have dropped');
    }
    return agent.agentId;
}
