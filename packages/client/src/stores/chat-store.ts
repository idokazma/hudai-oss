import { create } from 'zustand';
import type { ChatMessage, AdvisorVerbosity, AdvisorScope } from '@hudai/shared';

const MAX_MESSAGES = 200;

interface ChatState {
  messages: ChatMessage[];
  typing: boolean;
  verbosity: AdvisorVerbosity;
  scope: AdvisorScope;
  addMessage: (m: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  resolveMessage: (id: string) => void;
  setTyping: (t: boolean) => void;
  setVerbosity: (v: AdvisorVerbosity) => void;
  setScope: (s: AdvisorScope) => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  typing: false,
  verbosity: 'normal',
  scope: 'global',

  addMessage: (m) =>
    set((s) => {
      // Dedup by ID — skip if a message with the same ID already exists
      if (s.messages.some((existing) => existing.id === m.id)) return s;
      return { messages: [...s.messages, m].slice(-MAX_MESSAGES) };
    }),

  setMessages: (messages) =>
    set({ messages: messages.slice(-MAX_MESSAGES) }),

  resolveMessage: (id) =>
    set((s) => ({
      messages: s.messages.filter((m) => m.id !== id),
    })),

  setTyping: (typing) => set({ typing }),

  setVerbosity: (verbosity) => set({ verbosity }),

  setScope: (scope) => set({ scope }),

  clear: () => set({ messages: [], typing: false }),
}));
