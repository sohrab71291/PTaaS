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
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const envPath = path.join(__dirname, '../.env');
dotenv.config({ path: envPath });
const connection_1 = require("./connection");
const jobHandler_1 = require("./jobHandler");
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL;
const AGENT_NAME = process.env.AGENT_NAME || `${os.hostname()}-agent`;
if (!CONTROL_PLANE_URL) {
    console.error('Missing required env var.\n' +
        'Set CONTROL_PLANE_URL in agent/.env (AGENT_ID/AGENT_API_KEY are managed automatically).');
    process.exit(1);
}
// Rewrites AGENT_ID/AGENT_API_KEY in agent/.env in place (replacing existing
// lines, or appending them if this is the first run) so the file on disk
// always reflects whatever was just issued by the control plane.
function persistCredentials(agentId, apiKey) {
    let contents = '';
    try {
        contents = fs.readFileSync(envPath, 'utf8');
    }
    catch { }
    const setLine = (text, key, value) => {
        const line = `${key}="${value}"`;
        const re = new RegExp(`^${key}=.*$`, 'm');
        return re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
    };
    contents = setLine(contents, 'AGENT_ID', agentId);
    contents = setLine(contents, 'AGENT_API_KEY', apiKey);
    fs.writeFileSync(envPath, contents);
}
// Re-registers with the control plane on every process start. The backend
// upserts by name (see backend/src/routes/agents.ts), so this rotates this
// agent's key in the DB rather than creating a duplicate row — and since the
// fresh credentials are written straight back to agent/.env below, the file
// and the DB can never drift apart the way they used to when re-registration
// was a separate manual step (register-agent.ps1) run out of band from
// whatever process happened to already be running.
async function registerAgent() {
    const res = await fetch(`${CONTROL_PLANE_URL}/api/agents/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: AGENT_NAME, hostname: os.hostname() }),
    });
    if (!res.ok) {
        throw new Error(`${res.status} ${(await res.text().catch(() => '')) || res.statusText}`);
    }
    const data = (await res.json());
    persistCredentials(data.agentId, data.apiKey);
    return data;
}
async function main() {
    console.log(`[Agent] Registering '${AGENT_NAME}' with ${CONTROL_PLANE_URL}…`);
    let agentId;
    let apiKey;
    try {
        ({ agentId, apiKey } = await registerAgent());
        console.log(`[Agent] Registered as ${agentId}`);
    }
    catch (err) {
        console.error(`[Agent] Could not register with control plane: ${err.message}`);
        process.exit(1);
    }
    const connection = new connection_1.AgentConnection(CONTROL_PLANE_URL, agentId, apiKey);
    const jobHandler = new jobHandler_1.JobHandler(connection);
    connection.on('connected', () => {
        connection.send({
            type: 'register',
            agentId,
            name: AGENT_NAME,
            hostname: os.hostname(),
            k6Version: getK6Version(),
        });
    });
    connection.on('message', (msg) => {
        jobHandler.handle(msg);
    });
    connection.on('error', (_err) => {
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
}
function getK6Version() {
    try {
        const { execSync } = require('child_process');
        const out = execSync('k6 version 2>&1', { encoding: 'utf8', timeout: 3000 });
        const match = out.match(/k6 v([0-9.]+)/);
        return match ? match[1] : null;
    }
    catch {
        return null;
    }
}
main();
