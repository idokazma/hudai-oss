import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../stores/chat-store.js';

function makeMsg(id: string, text = 'hello') {
  return { id, text, role: 'assistant', timestamp: Date.now() } as any;
}

describe('useChatStore', () => {
  beforeEach(() => {
    useChatStore.getState().clear();
  });

  it('starts with empty messages and typing false', () => {
    const s = useChatStore.getState();
    expect(s.messages).toHaveLength(0);
    expect(s.typing).toBe(false);
    expect(s.verbosity).toBe('normal');
    expect(s.scope).toBe('global');
  });

  it('addMessage appends message', () => {
    useChatStore.getState().addMessage(makeMsg('m1'));
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].id).toBe('m1');
  });

  it('addMessage deduplicates by id', () => {
    useChatStore.getState().addMessage(makeMsg('m1'));
    useChatStore.getState().addMessage(makeMsg('m1'));
    expect(useChatStore.getState().messages).toHaveLength(1);
  });

  it('addMessage ring buffer caps at 200', () => {
    for (let i = 0; i < 210; i++) {
      useChatStore.getState().addMessage(makeMsg(`m${i}`));
    }
    expect(useChatStore.getState().messages).toHaveLength(200);
    // oldest messages should be dropped (keeps last 200)
    expect(useChatStore.getState().messages[0].id).toBe('m10');
    expect(useChatStore.getState().messages[199].id).toBe('m209');
  });

  it('setMessages replaces all, capping at 200', () => {
    const msgs = Array.from({ length: 250 }, (_, i) => makeMsg(`m${i}`));
    useChatStore.getState().setMessages(msgs);
    expect(useChatStore.getState().messages).toHaveLength(200);
  });

  it('resolveMessage removes by id', () => {
    useChatStore.getState().addMessage(makeMsg('m1'));
    useChatStore.getState().addMessage(makeMsg('m2'));
    useChatStore.getState().resolveMessage('m1');
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].id).toBe('m2');
  });

  it('setTyping updates typing flag', () => {
    useChatStore.getState().setTyping(true);
    expect(useChatStore.getState().typing).toBe(true);
    useChatStore.getState().setTyping(false);
    expect(useChatStore.getState().typing).toBe(false);
  });

  it('clear resets messages and typing', () => {
    useChatStore.getState().addMessage(makeMsg('m1'));
    useChatStore.getState().setTyping(true);
    useChatStore.getState().clear();
    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(useChatStore.getState().typing).toBe(false);
  });
});
