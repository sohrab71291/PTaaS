import { WebSocket } from 'ws';

interface AgentConnection {
  ws: WebSocket;
  agentId: string;
  lastSeen: Date;
  status: 'online' | 'busy';
}

class AgentRegistry {
  private connections = new Map<string, AgentConnection>();

  register(agentId: string, ws: WebSocket): void {
    this.connections.set(agentId, { ws, agentId, lastSeen: new Date(), status: 'online' });
  }

  unregister(agentId: string): void {
    this.connections.delete(agentId);
  }

  getAvailable(): AgentConnection | undefined {
    for (const conn of this.connections.values()) {
      if (conn.status === 'online') return conn;
    }
    return undefined;
  }

  // Unlike getAvailable(), this doesn't care whether our bookkeeping still
  // thinks the agent is 'busy' — used for redispatching to the specific agent
  // that already finished a job (e.g. an auto-fix retry), where the busy flag
  // hasn't been flipped back yet but the agent is in fact free.
  isConnected(agentId: string): boolean {
    const conn = this.connections.get(agentId);
    return !!conn && conn.ws.readyState === WebSocket.OPEN;
  }

  setStatus(agentId: string, status: 'online' | 'busy'): void {
    const conn = this.connections.get(agentId);
    if (conn) {
      conn.status = status;
      conn.lastSeen = new Date();
    }
  }

  updateLastSeen(agentId: string): void {
    const conn = this.connections.get(agentId);
    if (conn) conn.lastSeen = new Date();
  }

  dispatch(agentId: string, message: object): boolean {
    const conn = this.connections.get(agentId);
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) return false;
    conn.ws.send(JSON.stringify(message));
    return true;
  }

  listAll(): { agentId: string; status: string; lastSeen: Date }[] {
    return Array.from(this.connections.values()).map(c => ({
      agentId: c.agentId,
      status: c.status,
      lastSeen: c.lastSeen,
    }));
  }
}

export const agentRegistry = new AgentRegistry();
