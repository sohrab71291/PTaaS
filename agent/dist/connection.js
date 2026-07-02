"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentConnection = void 0;
const events_1 = require("events");
const ws_1 = __importDefault(require("ws"));
class AgentConnection extends events_1.EventEmitter {
    constructor(controlPlaneUrl, agentId, apiKey) {
        super();
        this.controlPlaneUrl = controlPlaneUrl;
        this.agentId = agentId;
        this.apiKey = apiKey;
        this.ws = null;
        this.reconnectTimer = null;
        this.heartbeatTimer = null;
        this.stopped = false;
    }
    connect() {
        if (this.stopped)
            return;
        const wsBase = this.controlPlaneUrl.replace(/^http/, 'ws');
        const url = `${wsBase}/ws/agent/${this.agentId}?apiKey=${this.apiKey}`;
        this.ws = new ws_1.default(url);
        this.ws.on('open', () => {
            console.log('[Agent] Connected to control plane');
            this.emit('connected');
            this.startHeartbeat();
        });
        this.ws.on('message', (data) => {
            try {
                this.emit('message', JSON.parse(data.toString()));
            }
            catch { }
        });
        this.ws.on('close', (code, reason) => {
            this.stopHeartbeat();
            console.log(`[Agent] Disconnected (${code}). Reconnecting in 5s…`);
            this.emit('disconnected');
            if (!this.stopped)
                this.scheduleReconnect();
        });
        this.ws.on('error', (err) => {
            console.error('[Agent] WebSocket error:', err.message);
            this.emit('error', err);
        });
    }
    send(msg) {
        if (this.ws?.readyState === ws_1.default.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }
    stop() {
        this.stopped = true;
        this.stopHeartbeat();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.ws?.close();
    }
    startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            this.send({ type: 'heartbeat' });
        }, 15000);
    }
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    scheduleReconnect() {
        if (this.reconnectTimer)
            return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, 5000);
    }
}
exports.AgentConnection = AgentConnection;
