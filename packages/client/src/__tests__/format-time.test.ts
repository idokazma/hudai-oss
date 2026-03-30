import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatDuration, formatDurationMs, formatElapsed, formatUptime } from '../utils/format-time.js';

describe('formatDuration', () => {
  it('formats seconds only', () => {
    const start = 1000;
    const end = 46000; // 45 seconds later
    expect(formatDuration(start, end)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    const start = 0;
    const end = 150_000; // 2m 30s
    expect(formatDuration(start, end)).toBe('2m 30s');
  });

  it('formats exact minutes without remainder', () => {
    const start = 0;
    const end = 120_000; // exactly 2m
    expect(formatDuration(start, end)).toBe('2m');
  });

  it('uses Date.now() when endMs is null', () => {
    const now = 200_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    expect(formatDuration(170_000, null)).toBe('30s');
    vi.restoreAllMocks();
  });

  it('returns 0s for identical start and end', () => {
    expect(formatDuration(1000, 1000)).toBe('0s');
  });
});

describe('formatDurationMs', () => {
  it('returns dash for zero', () => {
    expect(formatDurationMs(0)).toBe('—');
  });

  it('returns dash for negative', () => {
    expect(formatDurationMs(-100)).toBe('—');
  });

  it('formats seconds', () => {
    expect(formatDurationMs(45_000)).toBe('45s');
  });

  it('formats minutes', () => {
    expect(formatDurationMs(300_000)).toBe('5m');
  });

  it('formats hours', () => {
    expect(formatDurationMs(7_200_000)).toBe('2.0h');
  });

  it('formats days', () => {
    expect(formatDurationMs(172_800_000)).toBe('2.0d');
  });
});

describe('formatElapsed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 0:00 for zero/falsy startedAt', () => {
    expect(formatElapsed(0)).toBe('0:00');
  });

  it('formats minutes and zero-padded seconds', () => {
    vi.spyOn(Date, 'now').mockReturnValue(150_000);
    expect(formatElapsed(1)).toBe('2:29'); // 149,999ms ≈ 149s = 2:29
  });

  it('pads single-digit seconds', () => {
    vi.spyOn(Date, 'now').mockReturnValue(66_000);
    expect(formatElapsed(1_000)).toBe('1:05');
  });

  it('handles large elapsed times', () => {
    vi.spyOn(Date, 'now').mockReturnValue(3_661_000);
    expect(formatElapsed(1_000)).toBe('61:00');
  });
});

describe('formatUptime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 0s for zero/falsy startedAt', () => {
    expect(formatUptime(0)).toBe('0s');
  });

  it('formats seconds', () => {
    vi.spyOn(Date, 'now').mockReturnValue(46_000);
    expect(formatUptime(1_000)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    vi.spyOn(Date, 'now').mockReturnValue(151_000);
    expect(formatUptime(1_000)).toBe('2m 30s');
  });

  it('formats hours and minutes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(7_501_000);
    expect(formatUptime(1_000)).toBe('2h 5m');
  });
});
