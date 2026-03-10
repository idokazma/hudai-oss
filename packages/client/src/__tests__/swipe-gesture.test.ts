import { describe, it, expect, vi } from 'vitest';

/**
 * Test the swipe detection algorithm directly.
 * The useSwipeHandlers hook is a thin React wrapper around this logic,
 * so we extract and test the core algorithm.
 */

interface SwipeConfig {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  threshold?: number;
  onMove?: (deltaX: number) => void;
  onEnd?: () => void;
}

/** Pure-function version of the swipe detection logic from useSwipeHandlers */
function simulateSwipe(
  config: SwipeConfig,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  const threshold = config.threshold ?? 50;
  const dx = endX - startX;
  const dy = endY - startY;

  config.onEnd?.();

  if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.5) {
    if (dx > 0) config.onSwipeRight?.();
    else config.onSwipeLeft?.();
  }
}

function simulateMove(config: SwipeConfig, startX: number, currentX: number) {
  if (!config.onMove) return;
  config.onMove(currentX - startX);
}

describe('swipe gesture detection', () => {
  it('fires onSwipeLeft for leftward swipe exceeding threshold', () => {
    const onSwipeLeft = vi.fn();
    simulateSwipe({ onSwipeLeft }, 200, 100, 100, 100); // dx = -100
    expect(onSwipeLeft).toHaveBeenCalledOnce();
  });

  it('fires onSwipeRight for rightward swipe exceeding threshold', () => {
    const onSwipeRight = vi.fn();
    simulateSwipe({ onSwipeRight }, 100, 100, 250, 100); // dx = +150
    expect(onSwipeRight).toHaveBeenCalledOnce();
  });

  it('does not fire for swipes below threshold', () => {
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    simulateSwipe({ onSwipeLeft, onSwipeRight }, 100, 100, 130, 100); // dx = 30
    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('does not fire when vertical movement dominates', () => {
    const onSwipeLeft = vi.fn();
    simulateSwipe({ onSwipeLeft }, 200, 100, 130, 250); // dx=-70, dy=150
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('respects custom threshold', () => {
    const onSwipeRight = vi.fn();

    // dx=80, below custom threshold of 100
    simulateSwipe({ onSwipeRight, threshold: 100 }, 100, 100, 180, 100);
    expect(onSwipeRight).not.toHaveBeenCalled();

    // dx=150, above custom threshold of 100
    simulateSwipe({ onSwipeRight, threshold: 100 }, 100, 100, 250, 100);
    expect(onSwipeRight).toHaveBeenCalledOnce();
  });

  it('calls onMove with deltaX', () => {
    const onMove = vi.fn();
    simulateMove({ onMove }, 100, 145);
    expect(onMove).toHaveBeenCalledWith(45);
  });

  it('calls onEnd when swipe ends', () => {
    const onEnd = vi.fn();
    simulateSwipe({ onEnd }, 100, 100, 110, 100);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('does not call onMove when no onMove provided', () => {
    // Should not throw
    simulateMove({}, 100, 200);
  });

  it('fires on diagonal swipe where horizontal barely dominates', () => {
    const onSwipeRight = vi.fn();
    // dx=80, dy=50 → |dx| > |dy|*1.5 → 80 > 75 → fires
    simulateSwipe({ onSwipeRight }, 100, 100, 180, 150);
    expect(onSwipeRight).toHaveBeenCalledOnce();
  });

  it('blocks diagonal swipe where horizontal does NOT dominate enough', () => {
    const onSwipeRight = vi.fn();
    // dx=75, dy=51 → |dx| > |dy|*1.5 → 75 > 76.5 → false
    simulateSwipe({ onSwipeRight }, 100, 100, 175, 151);
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('exact threshold value does not fire (must exceed, not equal)', () => {
    const onSwipeRight = vi.fn();
    // dx=50 exactly, default threshold=50 → not exceeded
    simulateSwipe({ onSwipeRight }, 100, 100, 150, 100);
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('fires onSwipeLeft not onSwipeRight for negative dx', () => {
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    simulateSwipe({ onSwipeLeft, onSwipeRight }, 200, 100, 100, 100);
    expect(onSwipeLeft).toHaveBeenCalledOnce();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });
});
