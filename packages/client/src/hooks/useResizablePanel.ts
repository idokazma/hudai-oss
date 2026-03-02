import { useState, useCallback, useRef, useEffect } from 'react';

interface UseResizablePanelOptions {
  direction: 'horizontal' | 'vertical';
  defaultSize: number;
  minSize: number;
  maxSize: number;
  storageKey: string;
  collapsible?: boolean;
}

function readStorage(key: string): { size: number; collapsed: boolean } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeStorage(key: string, size: number, collapsed: boolean) {
  localStorage.setItem(key, JSON.stringify({ size, collapsed }));
}

export function useResizablePanel(options: UseResizablePanelOptions) {
  const { direction, defaultSize, minSize, maxSize, storageKey, collapsible = false } = options;

  const stored = readStorage(storageKey);
  const [size, setSize] = useState(stored?.size ?? defaultSize);
  const [collapsed, setCollapsed] = useState(stored?.collapsed ?? false);
  const lastSizeRef = useRef(size);
  const draggingRef = useRef(false);
  const startPosRef = useRef(0);
  const startSizeRef = useRef(0);
  const invertRef = useRef(false);

  // Keep lastSizeRef in sync when not collapsed
  useEffect(() => {
    if (!collapsed) lastSizeRef.current = size;
  }, [size, collapsed]);

  // Persist
  useEffect(() => {
    writeStorage(storageKey, size, collapsed);
  }, [size, collapsed, storageKey]);

  const startResize = useCallback((e: React.MouseEvent, invert = false) => {
    e.preventDefault();
    draggingRef.current = true;
    invertRef.current = invert;
    startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
    startSizeRef.current = collapsed ? lastSizeRef.current : size;

    if (collapsed) {
      setCollapsed(false);
    }

    // Disable pointer events on all iframes so they don't steal mouse events during drag
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach((f) => { (f as HTMLElement).style.pointerEvents = 'none'; });

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const pos = direction === 'horizontal' ? ev.clientX : ev.clientY;
      const rawDelta = pos - startPosRef.current;
      const delta = invertRef.current ? -rawDelta : rawDelta;
      const next = Math.round(Math.min(maxSize, Math.max(minSize, startSizeRef.current + delta)));
      setSize(next);
    };

    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Restore pointer events on iframes
      iframes.forEach((f) => { (f as HTMLElement).style.pointerEvents = ''; });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [direction, maxSize, minSize, size, collapsed]);

  const toggleCollapse = useCallback(() => {
    if (!collapsible) return;
    if (collapsed) {
      setCollapsed(false);
      setSize(lastSizeRef.current || defaultSize);
    } else {
      lastSizeRef.current = size;
      setCollapsed(true);
    }
  }, [collapsible, collapsed, size, defaultSize]);

  return {
    size: collapsed ? 0 : size,
    collapsed,
    startResize,
    toggleCollapse,
  };
}
