import { useEffect } from 'react';
import { useDensityStore, type DensityMode } from '../stores/density-store.js';

const KEY_MODE_MAP: Record<string, DensityMode> = {
  '1': 'glance',
  '2': 'work',
};

export function useDensityKeys() {
  const setMode = useDensityStore((s) => s.setMode);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }

      const mode = KEY_MODE_MAP[e.key];
      if (mode) {
        e.preventDefault();
        setMode(mode);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setMode]);
}
