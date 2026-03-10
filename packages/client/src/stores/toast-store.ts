import { create } from 'zustand';

export interface Toast {
  id: string;
  type: 'success' | 'warning' | 'info' | 'error';
  message: string;
  duration?: number;
}

interface ToastStore {
  toasts: Toast[];
  add: (toast: Omit<Toast, 'id'>) => void;
  remove: (id: string) => void;
}

const MAX_TOASTS = 5;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (toast) => {
    const id = crypto.randomUUID();
    set((s) => ({
      toasts: [...s.toasts, { ...toast, id }].slice(-MAX_TOASTS),
    }));
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const addToast = (toast: Omit<Toast, 'id'>) => useToastStore.getState().add(toast);
