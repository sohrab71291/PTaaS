import { agentRegistry } from './agentRegistry';
import prisma from '../lib/prisma';

/**
 * Build the InfluxDB env vars the K6 script needs.
 * The script uses __ENV.INFLUX_V2_* to enable writeInfluxLines().
 * We map INFLUXDB_* (backend naming) → INFLUX_V2_* (K6 script naming).
 */
function buildInfluxEnvVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  if (process.env.INFLUXDB_URL)    vars['INFLUX_V2_URL']    = process.env.INFLUXDB_URL;
  if (process.env.INFLUXDB_TOKEN)  vars['INFLUX_V2_TOKEN']  = process.env.INFLUXDB_TOKEN;
  if (process.env.INFLUXDB_ORG)    vars['INFLUX_V2_ORG']    = process.env.INFLUXDB_ORG;
  if (process.env.INFLUXDB_BUCKET) vars['INFLUX_V2_BUCKET'] = process.env.INFLUXDB_BUCKET;
  return vars;
}

async function sendToAgent(
  agentId: string,
  executionId: string,
  script: string,
  config: Record<string, any>,
): Promise<string> {
  // Generate the run identity once here so the timestamp is shared between
  // startedAt (stored in DB) and RUN_ID (passed to k6 / InfluxDB).
  // This lets queryFromRequestsRaw reconstruct the runId from startedAt
  // without needing a separate DB column.
  const startedAt = new Date();
  const runId     = `PerfOps-${startedAt.getTime()}`;

  await prisma.execution.update({
    where: { id: executionId },
    data: {
      status: 'running',
      agentId,
      startedAt,
    },
  });

  agentRegistry.setStatus(agentId, 'busy');

  const enrichedConfig = {
    ...config,
    envVars: {
      ...buildInfluxEnvVars(),       // INFLUX_V2_* from backend/.env
      RUN_ID:  runId,                // PerfOps-{ms} — stable, human-readable in Grafana
      TESTID:  executionId,
      ...(config.envVars ?? {}),     // user overrides win
    },
  };

  const dispatched = agentRegistry.dispatch(agentId, {
    type: 'dispatch_job',
    executionId,
    script,
    config: enrichedConfig,
  });

  if (!dispatched) {
    agentRegistry.setStatus(agentId, 'online');
    throw new Error('Failed to dispatch job to agent — connection may have dropped');
  }

  return agentId;
}

export async function dispatchJob(
  executionId: string,
  script: string,
  config: Record<string, any>
): Promise<string> {
  const agent = agentRegistry.getAvailable();
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
export async function dispatchJobToAgent(
  agentId: string,
  executionId: string,
  script: string,
  config: Record<string, any>,
): Promise<string> {
  if (!agentRegistry.isConnected(agentId)) {
    return dispatchJob(executionId, script, config);
  }
  return sendToAgent(agentId, executionId, script, config);
}
