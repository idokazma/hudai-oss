import { describe, it, expect, beforeEach } from 'vitest';
import { useNotificationStore } from '../stores/notification-store.js';

describe('useNotificationStore', () => {
  beforeEach(() => {
    useNotificationStore.getState().clear();
  });

  it('tracks activity changes', () => {
    useNotificationStore.getState().handleActivityChange('working');
    expect(useNotificationStore.getState().lastActivity).toBe('working');
  });

  it('tracks activity detail', () => {
    useNotificationStore.getState().handleActivityChange('waiting_permission', 'Run bash command');
    expect(useNotificationStore.getState().lastActivity).toBe('waiting_permission');
    expect(useNotificationStore.getState().lastActivityDetail).toBe('Run bash command');
  });

  it('ignores duplicate activity with same detail', () => {
    useNotificationStore.getState().handleActivityChange('working');
    useNotificationStore.getState().handleActivityChange('working');
    // Should not throw, just no-op
    expect(useNotificationStore.getState().lastActivity).toBe('working');
  });

  it('clear resets state', () => {
    useNotificationStore.getState().handleActivityChange('working');
    useNotificationStore.getState().clear();
    expect(useNotificationStore.getState().lastActivity).toBeNull();
    expect(useNotificationStore.getState().lastActivityDetail).toBeNull();
  });
});
