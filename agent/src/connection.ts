import { EventEmitter } from 'events';
import WebSocket from 'ws';

export class AgentConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private controlPlaneUrl: string,
    private agentId: string,
    private apiKey: string,
  ) {
    super();
  }

  connect(): void {
    if (this.stopped) return;
    const wsBase = this.controlPlaneUrl.replace(/^http/, 'ws');
    const url = `${wsBase}/ws/agent/${this.agentId}?apiKey=${this.apiKey}`;

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('[Agent] Connected to control plane');
      this.emit('connected');
      this.startHeartbeat();
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        this.emit('message', JSON.parse(data.toString()));
      } catch {}
    });

    this.ws.on('close', (code, reason) => {
      this.stopHeartbeat();
      console.log(`[Agent] Disconnected (${code}). Reconnecting in 5s…`);
      this.emit('disconnected');
      if (!this.stopped) this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[Agent] WebSocket error:', err.message);
      this.emit('error', err);
    });
  }

  send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  stop(): void {
    this.stopped = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat' });
    }, 15_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5_000);
  }
}
