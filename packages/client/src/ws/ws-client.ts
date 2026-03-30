import type { ClientMessage, ServerMessage } from '@hudai/shared';

type MessageHandler = (msg: ServerMessage) => void;
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';
type StateHandler = (state: ConnectionState) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private stateHandlers = new Set<StateHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private _state: ConnectionState = 'disconnected';
  private reconnectDelay = 2000;
  private static readonly MAX_RECONNECT_DELAY = 30_000;
  private static readonly BASE_RECONNECT_DELAY = 2000;

  constructor(url: string) {
    this.url = url;
  }

  get state() { return this._state; }

  private setState(state: ConnectionState) {
    if (this._state === state) return;
    this._state = state;
    for (const handler of this.stateHandlers) {
      handler(state);
    }
  }

  connect() {
    this.setState('connecting');
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.setState('connected');
      this.reconnectDelay = WsClient.BASE_RECONNECT_DELAY;
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
      this.setState('disconnected');
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, WsClient.MAX_RECONNECT_DELAY);
    };

    this.ws.onerror = (err) => {
      console.error('[ws] error', err);
      this.setState('error');
    };
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch (err) {
        console.error('[ws] send failed', err);
      }
    }
  }

  onMessage(handler: MessageHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStateChange(handler: StateHandler) {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  reconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.reconnectDelay = WsClient.BASE_RECONNECT_DELAY;
    this.connect();
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.setState('disconnected');
  }
}

export const wsClient = new WsClient(
  `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
);
