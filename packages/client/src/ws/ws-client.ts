import type { ClientMessage, ServerMessage } from '@hudai/shared';

type MessageHandler = (msg: ServerMessage) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('[ws] connected');
      // Request pane list immediately so UI doesn't need a refresh
      this.send({ kind: 'panes.list' });
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg: ServerMessage = JSON.parse(ev.data as string);
        for (const handler of this.handlers) {
          handler(msg);
        }
      } catch (err) {
        console.error('[ws] parse error', err);
      }
    };

    this.ws.onclose = () => {
      console.log('[ws] disconnected, reconnecting in 2s...');
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = (err) => {
      console.error('[ws] error', err);
    };
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onMessage(handler: MessageHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Force reconnect — closes and immediately re-establishes connection */
  reconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null; // Prevent auto-reconnect from firing
      this.ws.close();
      this.ws = null;
    }
    this.connect();
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}

// Singleton instance — connects to the Vite proxy
export const wsClient = new WsClient(
  `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
);
