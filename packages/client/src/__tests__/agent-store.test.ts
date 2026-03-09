import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../stores/agent-store.js';

describe('useAgentStore', () => {
  beforeEach(() => {
    useAgentStore.getState().clear();
  });

  it('starts with empty agents map', () => {
    expect(useAgentStore.getState().agents.size).toBe(0);
  });

  it('addAgent inserts agent with correct fields', () => {
    useAgentStore.getState().addAgent({
      agentId: 'a1',
      agentType: 'explore',
      prompt: 'find files',
      parentAgentId: null,
    }, 1000);
    const agent = useAgentStore.getState().agents.get('a1');
    expect(agent).toBeDefined();
    expect(agent!.id).toBe('a1');
    expect(agent!.type).toBe('explore');
    expect(agent!.prompt).toBe('find files');
    expect(agent!.parentId).toBeNull();
    expect(agent!.startedAt).toBe(1000);
    expect(agent!.background).toBe(false);
    expect(agent!.eventCount).toBe(0);
  });

  it('addAgent sets background flag when provided', () => {
    useAgentStore.getState().addAgent({
      agentId: 'a2',
      agentType: 'plan',
      prompt: 'plan work',
      parentAgentId: 'a1',
      background: true,
    }, 2000);
    expect(useAgentStore.getState().agents.get('a2')!.background).toBe(true);
    expect(useAgentStore.getState().agents.get('a2')!.parentId).toBe('a1');
  });

  it('removeAgent deletes from map', () => {
    useAgentStore.getState().addAgent({
      agentId: 'a1', agentType: 'x', prompt: 'y', parentAgentId: null,
    }, 0);
    useAgentStore.getState().removeAgent('a1');
    expect(useAgentStore.getState().agents.has('a1')).toBe(false);
  });

  it('incrementEventCount increments only targeted agent', () => {
    useAgentStore.getState().addAgent({
      agentId: 'a1', agentType: 'x', prompt: 'y', parentAgentId: null,
    }, 0);
    useAgentStore.getState().addAgent({
      agentId: 'a2', agentType: 'x', prompt: 'z', parentAgentId: null,
    }, 0);
    useAgentStore.getState().incrementEventCount('a1');
    useAgentStore.getState().incrementEventCount('a1');
    expect(useAgentStore.getState().agents.get('a1')!.eventCount).toBe(2);
    expect(useAgentStore.getState().agents.get('a2')!.eventCount).toBe(0);
  });

  it('incrementEventCount is no-op for unknown agentId', () => {
    useAgentStore.getState().incrementEventCount('nonexistent');
    expect(useAgentStore.getState().agents.size).toBe(0);
  });

  it('clear resets to empty map', () => {
    useAgentStore.getState().addAgent({
      agentId: 'a1', agentType: 'x', prompt: 'y', parentAgentId: null,
    }, 0);
    useAgentStore.getState().clear();
    expect(useAgentStore.getState().agents.size).toBe(0);
  });

  it('addAgent overwrites existing agent with same id', () => {
    useAgentStore.getState().addAgent({
      agentId: 'a1', agentType: 'explore', prompt: 'first', parentAgentId: null,
    }, 100);
    useAgentStore.getState().addAgent({
      agentId: 'a1', agentType: 'plan', prompt: 'second', parentAgentId: null,
    }, 200);
    const agent = useAgentStore.getState().agents.get('a1');
    expect(agent!.type).toBe('plan');
    expect(agent!.prompt).toBe('second');
    expect(useAgentStore.getState().agents.size).toBe(1);
  });
});
