import { create } from 'zustand';

export interface DocsStore {
  selectedFile: string | null;
  content: string;
  loading: boolean;
  error: string | null;
  editMode: boolean;
  editContent: string;
  saving: boolean;
  saveError: string | null;

  selectFile: (path: string) => void;
  setContent: (path: string, content: string, error?: string) => void;
  setWriteResult: (path: string, success: boolean, error?: string) => void;
  setEditMode: (on: boolean) => void;
  setEditContent: (content: string) => void;
  close: () => void;
}

export const useDocsStore = create<DocsStore>((set, get) => ({
  selectedFile: null,
  content: '',
  loading: false,
  error: null,
  editMode: false,
  editContent: '',
  saving: false,
  saveError: null,

  selectFile: (path) => {
    set({ selectedFile: path, content: '', loading: true, error: null, editMode: false, editContent: '', saving: false, saveError: null });
  },

  setContent: (path, content, error) => {
    if (get().selectedFile !== path) return;
    set({ content, loading: false, error: error ?? null, editContent: content });
  },

  setWriteResult: (path, success, error) => {
    if (get().selectedFile !== path) return;
    if (success) {
      const editContent = get().editContent;
      set({ saving: false, saveError: null, content: editContent, editMode: false });
    } else {
      set({ saving: false, saveError: error ?? 'Write failed' });
    }
  },

  setEditMode: (on) => {
    if (on) {
      set({ editMode: true, editContent: get().content, saveError: null });
    } else {
      set({ editMode: false, saveError: null });
    }
  },

  setEditContent: (content) => set({ editContent: content }),

  close: () => set({ selectedFile: null, content: '', loading: false, error: null, editMode: false, editContent: '', saving: false, saveError: null }),
}));
