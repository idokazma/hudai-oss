const DEBOUNCE_MS = 15_000;

export type RefreshCallback = (changedFiles: string[]) => Promise<void>;

/**
 * Debounced file change manager for incremental library/pipeline refreshes.
 * Agents edit files in bursts — waits 15 seconds after the last change before triggering.
 */
export class IncrementalRefreshManager {
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private queuedWhileRunning = new Set<string>();
  private callback: RefreshCallback;

  constructor(callback: RefreshCallback) {
    this.callback = callback;
  }

  /**
   * Notify that a file has been changed by the agent.
   * Resets the debounce timer on each call.
   */
  notifyFileChange(filePath: string): void {
    if (this.running) {
      // Queue changes that come in during an active refresh
      this.queuedWhileRunning.add(filePath);
      return;
    }

    this.pending.add(filePath);
    this.resetTimer();
  }

  /**
   * Clean up timers and state. Call on detach.
   */
  reset(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
    this.queuedWhileRunning.clear();
    this.running = false;
  }

  private resetTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  private async flush(): Promise<void> {
    this.timer = null;

    if (this.pending.size === 0) return;

    const files = Array.from(this.pending);
    this.pending.clear();
    this.running = true;

    console.log(`[refresh] Triggering incremental refresh for ${files.length} changed files`);

    try {
      await this.callback(files);
    } catch (err) {
      console.error('[refresh] Incremental refresh failed:', err);
    } finally {
      this.running = false;

      // If files changed during the refresh, start a new debounce cycle
      if (this.queuedWhileRunning.size > 0) {
        for (const f of this.queuedWhileRunning) {
          this.pending.add(f);
        }
        this.queuedWhileRunning.clear();
        this.resetTimer();
      }
    }
  }
}
