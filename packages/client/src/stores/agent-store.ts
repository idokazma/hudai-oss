import { create } from 'zustand';

export interface ActiveAgent {
  id: string;
  type: string;
  prompt: string;
  parentId: string | null;
  startedAt: number;
  background: boolean;
  eventCount: number;
}

interface AgentStore {
  agents: Map<string, ActiveAgent>;
  addAgent: (data: {
    agentId: string;
    agentType: string;
    prompt: string;
    parentAgentId: string | null;
    background?: boolean;
  }, timestamp: number) => void;
  removeAgent: (agentId: string) => void;
  incrementEventCount: (agentId: string) => void;
  clear: () => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  agents: new Map(),
  addAgent: (data, timestamp) =>
    set((state) => {
      const next = new Map(state.agents);
      next.set(data.agentId, {
        id: data.agentId,
        type: data.agentType,
        prompt: data.prompt,
        parentId: data.parentAgentId,
        startedAt: timestamp,
        background: data.background ?? false,
        eventCount: 0,
      });
      return { agents: next };
    }),
  removeAgent: (agentId) =>
    set((state) => {
      const next = new Map(state.agents);
      next.delete(agentId);
      return { agents: next };
    }),
  incrementEventCount: (agentId) =>
    set((state) => {
      const agent = state.agents.get(agentId);
      if (!agent) return state;
      const next = new Map(state.agents);
      next.set(agentId, { ...agent, eventCount: agent.eventCount + 1 });
      return { agents: next };
    }),
  clear: () => set({ agents: new Map() }),
}));
