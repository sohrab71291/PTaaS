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
const os = __importStar(require("os"));
dotenv.config({ path: path.join(__dirname, '../.env') });
const connection_1 = require("./connection");
const jobHandler_1 = require("./jobHandler");
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL;
const AGENT_API_KEY = process.env.AGENT_API_KEY;
let AGENT_ID = process.env.AGENT_ID;
if (!CONTROL_PLANE_URL || !AGENT_API_KEY || !AGENT_ID) {
    console.error('Missing required env vars.\n' +
        'Set CONTROL_PLANE_URL, AGENT_API_KEY, and AGENT_ID in agent/.env\n\n' +
        'To register a new agent:\n' +
        `  curl -X POST ${CONTROL_PLANE_URL ?? 'http://localhost:3001'}/api/agents/register \\\n` +
        '       -H "Content-Type: application/json" \\\n' +
        `       -d \'{"name":"${os.hostname()}"}\'\n`);
    process.exit(1);
}
const connection = new connection_1.AgentConnection(CONTROL_PLANE_URL, AGENT_ID, AGENT_API_KEY);
const jobHandler = new jobHandler_1.JobHandler(connection);
connection.on('connected', () => {
    connection.send({
        type: 'register',
        agentId: AGENT_ID,
        name: process.env.AGENT_NAME ?? os.hostname(),
        hostname: os.hostname(),
        k6Version: getK6Version(),
    });
});
connection.on('message', (msg) => {
    jobHandler.handle(msg);
});
connection.on('error', (err) => {
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
