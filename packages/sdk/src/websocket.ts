import type { StreamEvent } from './types.js';

type Handler = (payload: unknown) => void;

export type WebSocketClientOptions = {
  apiKey: string;
  baseUrl: string;
  maxRetries?: number;
};

/**
 * Browser/Node-compatible WebSocket client with exponential backoff reconnect.
 */
export class WebSocketClient {
  private socket: WebSocket | null = null;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly apiKey: string;
  private readonly wsUrl: string;
  private readonly maxRetries: number;
  private retries = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: WebSocketClientOptions) {
    this.apiKey = options.apiKey;
    this.maxRetries = options.maxRetries ?? 5;
    const httpBase = options.baseUrl.replace(/\/$/, '');
    const wsBase = httpBase.replace(/^http/, 'ws');
    this.wsUrl = `${wsBase}/v1/stream?api_key=${encodeURIComponent(this.apiKey)}`;
  }

  connect(): this {
    this.closedByUser = false;
    this.open();
    return this;
  }

  on(event: StreamEvent | string, handler: Handler): this {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(event, set);
    return this;
  }

  off(event: StreamEvent | string, handler: Handler): this {
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  private open(): void {
    const WSImpl = globalThis.WebSocket;
    if (!WSImpl) {
      throw new Error('WebSocket is not available in this environment');
    }

    this.socket = new WSImpl(this.wsUrl);

    this.socket.addEventListener('open', () => {
      this.retries = 0;
    });

    this.socket.addEventListener('message', (event) => {
      try {
        const raw = typeof event.data === 'string' ? event.data : String(event.data);
        const payload = JSON.parse(raw) as { event?: string };
        const eventName = payload.event ?? 'message';
        this.emit(eventName, payload);
        this.emit('*', payload);
      } catch {
        // ignore malformed payloads
      }
    });

    this.socket.addEventListener('close', () => {
      if (this.closedByUser) return;
      this.scheduleReconnect();
    });

    this.socket.addEventListener('error', () => {
      // close handler schedules reconnect
    });
  }

  private scheduleReconnect(): void {
    if (this.retries >= this.maxRetries) {
      this.emit('error', { code: 'WS_RECONNECT_EXHAUSTED', retries: this.retries });
      return;
    }
    const delay = Math.min(1000 * 2 ** this.retries, 30_000);
    this.retries += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private emit(event: string, payload: unknown): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      handler(payload);
    }
  }
}
