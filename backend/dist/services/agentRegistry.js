"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentRegistry = void 0;
const ws_1 = require("ws");
class AgentRegistry {
    constructor() {
        this.connections = new Map();
    }
    register(agentId, ws) {
        this.connections.set(agentId, { ws, agentId, lastSeen: new Date(), status: 'online' });
    }
    unregister(agentId) {
        this.connections.delete(agentId);
    }
    getAvailable() {
        for (const conn of this.connections.values()) {
            if (conn.status === 'online')
                return conn;
        }
        return undefined;
    }
    // Unlike getAvailable(), this doesn't care whether our bookkeeping still
    // thinks the agent is 'busy' — used for redispatching to the specific agent
    // that already finished a job (e.g. an auto-fix retry), where the busy flag
    // hasn't been flipped back yet but the agent is in fact free.
    isConnected(agentId) {
        const conn = this.connections.get(agentId);
        return !!conn && conn.ws.readyState === ws_1.WebSocket.OPEN;
    }
    setStatus(agentId, status) {
        const conn = this.connections.get(agentId);
        if (conn) {
            conn.status = status;
            conn.lastSeen = new Date();
        }
    }
    updateLastSeen(agentId) {
        const conn = this.connections.get(agentId);
        if (conn)
            conn.lastSeen = new Date();
    }
    dispatch(agentId, message) {
        const conn = this.connections.get(agentId);
        if (!conn || conn.ws.readyState !== ws_1.WebSocket.OPEN)
            return false;
        conn.ws.send(JSON.stringify(message));
        return true;
    }
    listAll() {
        return Array.from(this.connections.values()).map(c => ({
            agentId: c.agentId,
            status: c.status,
            lastSeen: c.lastSeen,
        }));
    }
}
exports.agentRegistry = new AgentRegistry();
