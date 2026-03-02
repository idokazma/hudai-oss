import WebSocket from 'ws';
import type {
  ClientMessage,
  ServerMessage,
  SessionState,
  TokenState,
  TmuxPane,
  InsightSummary,
  InsightIntent,
  InsightNotification,
  ChatMessage,
} from '@hudai/shared';

type MessageHandler = (msg: ServerMessage) => void;

export interface CachedState {
  session: SessionState | null;
  paneContent: string | null;
  tokens: TokenState | null;
  intent: InsightIntent | null;
  summary: InsightSummary | null;
  notifications: InsightNotification[];
  panes: TmuxPane[];
  chatMessages: ChatMessage[];
  chatTyping: boolean;
  connected: boolean;
}

export class WsBridge {
  private ws: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private reconnectDelay = 2000;
  private maxReconnectDelay = 30000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private shouldReconnect = true;

  readonly cache: CachedState = {
    session: null,
    paneContent: null,
    tokens: null,
    intent: null,
    summary: null,
    notifications: [],
    panes: [],
    chatMessages: [],
    chatTyping: false,
    connected: false,
  };

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    this.shouldReconnect = true;
    this._connect();
  }

  private _connect(): void {
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.error('[ws-bridge] failed to create WebSocket:', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      console.log('[ws-bridge] connected to', this.url);
      this.cache.connected = true;
      this.reconnectDelay = 2000;
    });

    this.ws.on('message', (data) => {
      try {
        const msg: ServerMessage = JSON.parse(data.toString());
        this.updateCache(msg);
        for (const handler of this.handlers) {
          handler(msg);
        }
      } catch (err) {
        console.error('[ws-bridge] parse error:', err);
      }
    });

    this.ws.on('close', () => {
      console.log('[ws-bridge] disconnected');
      this.cache.connected = false;
      this.ws = null;
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (err) => {
      console.error('[ws-bridge] error:', err.message);
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    console.log(`[ws-bridge] reconnecting in ${this.reconnectDelay / 1000}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
      this._connect();
    }, this.reconnectDelay);
  }

  private updateCache(msg: ServerMessage): void {
    switch (msg.kind) {
      case 'session.state':
        this.cache.session = msg.state;
        break;
      case 'pane.content':
        this.cache.paneContent = msg.content;
        break;
      case 'tokens.state':
        this.cache.tokens = msg.state;
        break;
      case 'insight.intent':
        this.cache.intent = msg.intent;
        break;
      case 'insight.summary':
        this.cache.summary = msg.summary;
        break;
      case 'insight.notification':
        this.cache.notifications = [
          msg.notification,
          ...this.cache.notifications.slice(0, 9),
        ];
        break;
      case 'panes.list':
        this.cache.panes = msg.panes;
        break;
      case 'chat.message':
        this.cache.chatMessages = [
          ...this.cache.chatMessages.slice(-49),
          msg.message,
        ];
        break;
      case 'chat.history':
        this.cache.chatMessages = msg.messages.slice(-50);
        break;
      case 'chat.typing':
        this.cache.chatTyping = msg.typing;
        break;
      case 'service.status':
        // Pass through to handlers (bot start/stop logic)
        break;
    }
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.cache.connected = false;
  }
}
