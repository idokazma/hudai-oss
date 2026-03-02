import { describe, it, expect } from 'vitest';
import { LoopDetector } from '../parser/loop-detector.js';

describe('LoopDetector', () => {
  it('returns null below threshold (3 repetitions)', () => {
    const detector = new LoopDetector();
    const now = Date.now();
    expect(detector.recordAction('Read', '/foo.ts', now)).toBeNull();
    expect(detector.recordAction('Read', '/foo.ts', now + 100)).toBeNull();
    expect(detector.recordAction('Read', '/foo.ts', now + 200)).toBeNull();
  });

  it('returns warning at 4th repetition', () => {
    const detector = new LoopDetector();
    const now = Date.now();
    detector.recordAction('Read', '/foo.ts', now);
    detector.recordAction('Read', '/foo.ts', now + 100);
    detector.recordAction('Read', '/foo.ts', now + 200);
    const warning = detector.recordAction('Read', '/foo.ts', now + 300);
    expect(warning).not.toBeNull();
    expect(warning!.pattern).toBe('Read:/foo.ts');
    expect(warning!.count).toBe(4);
  });

  it('different keys do not interfere', () => {
    const detector = new LoopDetector();
    const now = Date.now();
    detector.recordAction('Read', '/a.ts', now);
    detector.recordAction('Read', '/a.ts', now + 100);
    detector.recordAction('Edit', '/b.ts', now + 200);
    detector.recordAction('Read', '/a.ts', now + 300);
    // Only 3 Read:/a.ts — no warning yet
    expect(detector.recordAction('Edit', '/b.ts', now + 400)).toBeNull();
  });

  it('emits warning only once per key (dedup)', () => {
    const detector = new LoopDetector();
    const now = Date.now();
    for (let i = 0; i < 4; i++) {
      detector.recordAction('Read', '/foo.ts', now + i * 100);
    }
    // 5th repetition — should not emit again
    const warning = detector.recordAction('Read', '/foo.ts', now + 500);
    expect(warning).toBeNull();
  });

  it('prunes entries outside 2-minute window', () => {
    const detector = new LoopDetector();
    const now = Date.now();
    // Add 3 actions at time 0
    for (let i = 0; i < 3; i++) {
      detector.recordAction('Read', '/foo.ts', now + i * 100);
    }
    // 4th action 3 minutes later — old entries should be pruned
    const warning = detector.recordAction('Read', '/foo.ts', now + 180_000);
    expect(warning).toBeNull();
  });

  it('reset clears all state', () => {
    const detector = new LoopDetector();
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      detector.recordAction('Read', '/foo.ts', now + i * 100);
    }
    detector.reset();
    // After reset, should start fresh — no warning at 1st action
    expect(detector.recordAction('Read', '/foo.ts', now + 1000)).toBeNull();
  });
});
