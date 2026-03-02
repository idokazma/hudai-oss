import { create } from 'zustand';
import type { AgentActivity } from '@hudai/shared';

/**
 * Simplified notification store — only tracks agent activity state.
 * Notifications now flow through the chat store as interactive messages.
 */

interface NotificationStore {
  lastActivity: AgentActivity | null;
  lastActivityDetail: string | null;
  handleActivityChange: (activity: AgentActivity | undefined, detail?: string, options?: string[]) => void;
  clear: () => void;
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  lastActivity: null,
  lastActivityDetail: null,

  handleActivityChange: (activity, detail) => {
    if (!activity) return;
    const { lastActivity, lastActivityDetail } = get();
    const detailChanged = detail !== lastActivityDetail;
    const isWaitingState = activity === 'waiting_answer' || activity === 'waiting_permission';
    if (activity === lastActivity && !(isWaitingState && detailChanged)) return;

    set({ lastActivity: activity, lastActivityDetail: detail ?? null });
  },

  clear: () => {
    set({ lastActivity: null, lastActivityDetail: null });
  },
}));
