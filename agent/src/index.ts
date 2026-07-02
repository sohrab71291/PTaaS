import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
dotenv.config({ path: path.join(__dirname, '../.env') });

import { AgentConnection } from './connection';
import { JobHandler } from './jobHandler';

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL;
const AGENT_API_KEY = process.env.AGENT_API_KEY;
let AGENT_ID = process.env.AGENT_ID;

if (!CONTROL_PLANE_URL || !AGENT_API_KEY || !AGENT_ID) {
  console.error(
    'Missing required env vars.\n' +
    'Set CONTROL_PLANE_URL, AGENT_API_KEY, and AGENT_ID in agent/.env\n\n' +
    'To register a new agent:\n' +
    `  curl -X POST ${CONTROL_PLANE_URL ?? 'http://localhost:3001'}/api/agents/register \\\n` +
    '       -H "Content-Type: application/json" \\\n' +
    `       -d \'{"name":"${os.hostname()}"}\'\n`
  );
  process.exit(1);
}

const connection = new AgentConnection(CONTROL_PLANE_URL, AGENT_ID, AGENT_API_KEY);
const jobHandler = new JobHandler(connection);

connection.on('connected', () => {
  connection.send({
    type: 'register',
    agentId: AGENT_ID,
    name: process.env.AGENT_NAME ?? os.hostname(),
    hostname: os.hostname(),
    k6Version: getK6Version(),
  });
});

connection.on('message', (msg: any) => {
  jobHandler.handle(msg);
});

connection.on('error', (err: Error) => {
  // reconnect is handled inside AgentConnection
});

console.log(`[Agent] Starting — connecting to ${CONTROL_PLANE_URL}`);
connection.connect();

process.on('SIGINT', () => {
  console.log('[Agent] Shutting down…');
  connection.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  connection.stop();
  process.exit(0);
});

function getK6Version(): string | null {
  try {
    const { execSync } = require('child_process');
    const out = execSync('k6 version 2>&1', { encoding: 'utf8', timeout: 3000 });
    const match = out.match(/k6 v([0-9.]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
