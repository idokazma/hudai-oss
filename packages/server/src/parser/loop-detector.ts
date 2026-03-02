/**
 * Detects repeated patterns in agent behavior that suggest
 * autonomous loops (e.g., Ralph-style retry loops).
 *
 * Looks for: same tool called on same file/pattern repeatedly,
 * or repeated prompt patterns.
 */

export interface LoopWarning {
  pattern: string;
  count: number;
  windowMs: number;
  firstSeen: number;
  lastSeen: number;
}

const WINDOW_MS = 120_000; // 2 minute window
const THRESHOLD = 4; // 4 repetitions = potential loop

export class LoopDetector {
  private recentActions: Array<{ key: string; ts: number }> = [];
  private emittedWarnings = new Set<string>();

  /**
   * Record an action and check for loops.
   * Returns a warning if a loop is detected.
   */
  recordAction(toolName: string, primaryArg: string, timestamp: number): LoopWarning | null {
    const key = `${toolName}:${primaryArg.slice(0, 100)}`;
    const now = timestamp || Date.now();

    this.recentActions.push({ key, ts: now });

    // Prune old entries
    this.recentActions = this.recentActions.filter((a) => now - a.ts < WINDOW_MS);

    // Count occurrences of this key
    const matches = this.recentActions.filter((a) => a.key === key);
    if (matches.length >= THRESHOLD && !this.emittedWarnings.has(key)) {
      this.emittedWarnings.add(key);
      return {
        pattern: key,
        count: matches.length,
        windowMs: WINDOW_MS,
        firstSeen: matches[0].ts,
        lastSeen: now,
      };
    }

    // Reset warning if pattern breaks (no occurrence in last 30s)
    if (matches.length < 2) {
      this.emittedWarnings.delete(key);
    }

    return null;
  }

  reset(): void {
    this.recentActions = [];
    this.emittedWarnings.clear();
  }
}
