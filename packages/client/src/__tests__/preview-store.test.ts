import { describe, it, expect, beforeEach } from 'vitest';
import { usePreviewStore } from '../stores/preview-store.js';

describe('usePreviewStore', () => {
  beforeEach(() => {
    usePreviewStore.getState().close();
  });

  it('starts with null url and map tab', () => {
    const s = usePreviewStore.getState();
    expect(s.url).toBeNull();
    expect(s.proxyPort).toBeNull();
    expect(s.proxyUrl).toBeNull();
    expect(s.centerTab).toBe('map');
  });

  it('setUrl sets url and switches to preview tab', () => {
    usePreviewStore.getState().setUrl('http://example.com');
    const s = usePreviewStore.getState();
    expect(s.url).toBe('http://example.com');
    expect(s.centerTab).toBe('preview');
    expect(s.proxyPort).toBeNull();
    expect(s.proxyUrl).toBeNull();
  });

  it('setProxyPort derives proxyUrl', () => {
    usePreviewStore.getState().setProxyPort(3000);
    const s = usePreviewStore.getState();
    expect(s.proxyPort).toBe(3000);
    expect(s.proxyUrl).toBe('http://localhost:3000');
  });

  it('setCenterTab toggles between map and preview', () => {
    usePreviewStore.getState().setCenterTab('preview');
    expect(usePreviewStore.getState().centerTab).toBe('preview');
    usePreviewStore.getState().setCenterTab('map');
    expect(usePreviewStore.getState().centerTab).toBe('map');
  });

  it('close resets all state', () => {
    usePreviewStore.getState().setUrl('http://x.com');
    usePreviewStore.getState().setProxyPort(8080);
    usePreviewStore.getState().close();
    const s = usePreviewStore.getState();
    expect(s.url).toBeNull();
    expect(s.proxyPort).toBeNull();
    expect(s.proxyUrl).toBeNull();
    expect(s.centerTab).toBe('map');
  });

  it('setUrl clears previous proxy state', () => {
    usePreviewStore.getState().setProxyPort(5000);
    usePreviewStore.getState().setUrl('http://new.com');
    const s = usePreviewStore.getState();
    expect(s.proxyPort).toBeNull();
    expect(s.proxyUrl).toBeNull();
    expect(s.url).toBe('http://new.com');
  });
});
