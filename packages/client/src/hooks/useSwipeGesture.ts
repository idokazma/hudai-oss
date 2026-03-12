import { useRef, useCallback, type RefObject } from 'react';

interface SwipeConfig {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Minimum horizontal distance in px to trigger (default: 50) */
  threshold?: number;
  /** Track real-time delta for visual feedback */
  onMove?: (deltaX: number) => void;
  onEnd?: () => void;
}

export function useSwipeGesture<T extends HTMLElement>(config: SwipeConfig): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const threshold = config.threshold ?? 50;

  const attach = useCallback(
    (node: T | null) => {
      // Cleanup previous
      if (ref.current) {
        ref.current.removeEventListener('touchstart', handleStart);
        ref.current.removeEventListener('touchmove', handleMove);
        ref.current.removeEventListener('touchend', handleEnd);
      }
      ref.current = node;
      if (node) {
        node.addEventListener('touchstart', handleStart, { passive: true });
        node.addEventListener('touchmove', handleMove, { passive: true });
        node.addEventListener('touchend', handleEnd, { passive: true });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function handleStart(e: TouchEvent) {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
  }

  function handleMove(e: TouchEvent) {
    if (!config.onMove) return;
    const dx = e.touches[0].clientX - startX.current;
    config.onMove(dx);
  }

  function handleEnd(e: TouchEvent) {
    const dx = e.changedTouches[0].clientX - startX.current;
    const dy = e.changedTouches[0].clientY - startY.current;
    config.onEnd?.();

    // Only fire if horizontal movement dominates vertical
    if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0) config.onSwipeRight?.();
      else config.onSwipeLeft?.();
    }
  }

  // Return a ref-callback-based ref
  return { current: null, ...({} as any) } as RefObject<T | null>;
}

/** Simpler version that returns event handlers for attachment */
export function useSwipeHandlers(config: SwipeConfig) {
  const startX = useRef(0);
  const startY = useRef(0);
  const threshold = config.threshold ?? 50;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
  }, []);

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!config.onMove) return;
      const dx = e.touches[0].clientX - startX.current;
      config.onMove(dx);
    },
    [config.onMove],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startX.current;
      const dy = e.changedTouches[0].clientY - startY.current;
      config.onEnd?.();

      if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx > 0) config.onSwipeRight?.();
        else config.onSwipeLeft?.();
      }
    },
    [config.onSwipeLeft, config.onSwipeRight, config.onEnd, threshold],
  );

  return { onTouchStart, onTouchMove, onTouchEnd };
}
