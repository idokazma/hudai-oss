import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WsClient } from '../ws/ws-client.js';

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((err: any) => void) | null = null;
  sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
}

describe('WsClient', () => {
  let client: WsClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', MockWebSocket);
    client = new WsClient('ws://localhost:4200/ws');
  });

  afterEach(() => {
    client.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function getWs(): MockWebSocket {
    // Access internal ws field
    return (client as any).ws as MockWebSocket;
  }

  it('connect creates WebSocket and sends panes.list on open', () => {
    client.connect();
    const ws = getWs();
    expect(ws).toBeInstanceOf(MockWebSocket);
    ws.onopen?.();
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0]).kind).toBe('panes.list');
  });

  it('send only transmits when readyState is OPEN', () => {
    client.connect();
    const ws = getWs();
    ws.readyState = MockWebSocket.OPEN;
    client.send({ kind: 'panes.list' } as any);
    expect(ws.sent).toHaveLength(1);

    ws.readyState = MockWebSocket.CLOSED;
    client.send({ kind: 'panes.list' } as any);
    expect(ws.sent).toHaveLength(1); // not sent
  });

  it('onMessage registers handler and receives parsed messages', () => {
    client.connect();
    const ws = getWs();
    const received: any[] = [];
    client.onMessage((msg) => received.push(msg));
    ws.onmessage?.({ data: JSON.stringify({ kind: 'test', payload: 42 }) });
    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe('test');
  });

  it('onMessage returns unsubscribe function', () => {
    client.connect();
    const ws = getWs();
    const received: any[] = [];
    const unsub = client.onMessage((msg) => received.push(msg));
    unsub();
    ws.onmessage?.({ data: JSON.stringify({ kind: 'test' }) });
    expect(received).toHaveLength(0);
  });

  it('handles JSON parse errors gracefully', () => {
    client.connect();
    const ws = getWs();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Should not throw
    ws.onmessage?.({ data: 'invalid json{' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('auto-reconnects after 2s on close', () => {
    client.connect();
    const ws = getWs();
    ws.onclose?.();
    expect(getWs()).toBe(ws); // Still the old one before timer fires
    vi.advanceTimersByTime(2000);
    expect(getWs()).not.toBe(ws); // New WebSocket created
  });

  it('reconnect clears timer and re-establishes connection', () => {
    client.connect();
    const ws1 = getWs();
    client.reconnect();
    const ws2 = getWs();
    expect(ws2).not.toBe(ws1);
    expect(ws1.readyState).toBe(MockWebSocket.CLOSED);
  });

  it('reconnect prevents auto-reconnect from previous close', () => {
    client.connect();
    const ws1 = getWs();
    // Null out onclose to prevent auto-reconnect
    client.reconnect();
    // The old ws's onclose should have been nulled
    expect(ws1.onclose).toBeNull();
  });

  it('disconnect clears timer and nulls ws', () => {
    client.connect();
    client.disconnect();
    expect(getWs()).toBeNull();
  });

  it('multiple handlers receive the same message', () => {
    client.connect();
    const ws = getWs();
    const r1: any[] = [];
    const r2: any[] = [];
    client.onMessage((msg) => r1.push(msg));
    client.onMessage((msg) => r2.push(msg));
    ws.onmessage?.({ data: JSON.stringify({ kind: 'x' }) });
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
  });

  it('send with no connection does not throw', () => {
    // Don't connect
    expect(() => client.send({ kind: 'panes.list' } as any)).not.toThrow();
  });
});
