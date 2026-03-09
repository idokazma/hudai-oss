import { describe, it, expect, beforeEach } from 'vitest';
import { useDocsStore } from '../stores/docs-store.js';

describe('useDocsStore', () => {
  beforeEach(() => {
    useDocsStore.getState().close();
  });

  it('starts with null selectedFile and empty content', () => {
    const s = useDocsStore.getState();
    expect(s.selectedFile).toBeNull();
    expect(s.content).toBe('');
    expect(s.loading).toBe(false);
    expect(s.editMode).toBe(false);
  });

  it('selectFile sets path and resets all state', () => {
    useDocsStore.getState().selectFile('/foo/bar.ts');
    const s = useDocsStore.getState();
    expect(s.selectedFile).toBe('/foo/bar.ts');
    expect(s.loading).toBe(true);
    expect(s.content).toBe('');
    expect(s.editMode).toBe(false);
    expect(s.saving).toBe(false);
    expect(s.saveError).toBeNull();
  });

  it('setContent updates content when path matches', () => {
    useDocsStore.getState().selectFile('/foo.ts');
    useDocsStore.getState().setContent('/foo.ts', 'file content');
    const s = useDocsStore.getState();
    expect(s.content).toBe('file content');
    expect(s.loading).toBe(false);
    expect(s.editContent).toBe('file content');
  });

  it('setContent is ignored when path does not match', () => {
    useDocsStore.getState().selectFile('/foo.ts');
    useDocsStore.getState().setContent('/bar.ts', 'wrong file');
    expect(useDocsStore.getState().content).toBe('');
    expect(useDocsStore.getState().loading).toBe(true);
  });

  it('setContent with error stores the error', () => {
    useDocsStore.getState().selectFile('/foo.ts');
    useDocsStore.getState().setContent('/foo.ts', '', 'File not found');
    const s = useDocsStore.getState();
    expect(s.error).toBe('File not found');
    expect(s.loading).toBe(false);
  });

  it('setEditMode(true) copies content to editContent', () => {
    useDocsStore.getState().selectFile('/foo.ts');
    useDocsStore.getState().setContent('/foo.ts', 'original');
    useDocsStore.getState().setEditMode(true);
    const s = useDocsStore.getState();
    expect(s.editMode).toBe(true);
    expect(s.editContent).toBe('original');
  });

  it('setEditMode(false) clears saveError', () => {
    useDocsStore.setState({ editMode: true, saveError: 'some error' });
    useDocsStore.getState().setEditMode(false);
    const s = useDocsStore.getState();
    expect(s.editMode).toBe(false);
    expect(s.saveError).toBeNull();
  });

  it('setWriteResult success saves editContent to content and exits edit mode', () => {
    useDocsStore.getState().selectFile('/foo.ts');
    useDocsStore.getState().setContent('/foo.ts', 'old');
    useDocsStore.getState().setEditMode(true);
    useDocsStore.getState().setEditContent('new content');
    useDocsStore.getState().setWriteResult('/foo.ts', true);
    const s = useDocsStore.getState();
    expect(s.content).toBe('new content');
    expect(s.editMode).toBe(false);
    expect(s.saving).toBe(false);
    expect(s.saveError).toBeNull();
  });

  it('setWriteResult failure sets saveError', () => {
    useDocsStore.getState().selectFile('/foo.ts');
    useDocsStore.getState().setWriteResult('/foo.ts', false, 'Permission denied');
    const s = useDocsStore.getState();
    expect(s.saveError).toBe('Permission denied');
    expect(s.saving).toBe(false);
  });

  it('setWriteResult failure defaults error message', () => {
    useDocsStore.getState().selectFile('/foo.ts');
    useDocsStore.getState().setWriteResult('/foo.ts', false);
    expect(useDocsStore.getState().saveError).toBe('Write failed');
  });

  it('setWriteResult is ignored when path does not match', () => {
    useDocsStore.getState().selectFile('/foo.ts');
    useDocsStore.getState().setWriteResult('/bar.ts', true);
    // Should not affect state
    expect(useDocsStore.getState().content).toBe('');
  });

  it('close resets all state', () => {
    useDocsStore.getState().selectFile('/foo.ts');
    useDocsStore.getState().setContent('/foo.ts', 'data');
    useDocsStore.getState().close();
    const s = useDocsStore.getState();
    expect(s.selectedFile).toBeNull();
    expect(s.content).toBe('');
    expect(s.loading).toBe(false);
    expect(s.editMode).toBe(false);
  });
});
