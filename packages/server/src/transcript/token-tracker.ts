import type { TokenState, TokenUsage } from '@hudai/shared';
import { calculateCost, getModelName } from '@hudai/shared';

const CONTEXT_WINDOW = 200_000;
const BURN_RATE_WINDOW_MS = 60_000; // 1 minute rolling window

/**
 * Tracks cumulative token usage and cost for a session.
 * Fed by JSONL message `usage` fields.
 */
export class TokenTracker {
  private state: TokenState = {
    totalInput: 0,
    totalOutput: 0,
    totalCacheCreation: 0,
    totalCacheRead: 0,
    totalCost: 0,
    contextPercent: 0,
    burnRate: 0,
    modelCounts: {},
    history: [],
    compactionCount: 0,
  };

  private recentTokens: Array<{ ts: number; tokens: number }> = [];

  getState(): TokenState {
    return this.state;
  }

  /**
   * Record token usage from a JSONL message.
   */
  recordUsage(usage: TokenUsage, model: string, timestamp: number): void {
    this.state.totalInput += usage.inputTokens;
    this.state.totalOutput += usage.outputTokens;
    this.state.totalCacheCreation += usage.cacheCreationTokens;
    this.state.totalCacheRead += usage.cacheReadTokens;

    const cost = calculateCost(usage, model);
    this.state.totalCost += cost;

    // Model distribution
    const modelName = getModelName(model);
    this.state.modelCounts[modelName] = (this.state.modelCounts[modelName] ?? 0) + 1;

    // Context estimate: input_tokens is roughly the context size
    // (input includes system prompt + conversation + tool results)
    this.state.contextPercent = Math.min(99, Math.round((usage.inputTokens / CONTEXT_WINDOW) * 100));

    // History entry
    this.state.history.push({
      timestamp,
      input: usage.inputTokens,
      output: usage.outputTokens,
      cost,
      model: modelName,
    });
    // Keep last 500 entries
    if (this.state.history.length > 500) {
      this.state.history = this.state.history.slice(-500);
    }

    // Burn rate (tokens per minute over rolling window)
    const totalTokens = usage.inputTokens + usage.outputTokens;
    const now = Date.now();
    this.recentTokens.push({ ts: now, tokens: totalTokens });
    this.recentTokens = this.recentTokens.filter((r) => now - r.ts < BURN_RATE_WINDOW_MS);
    const windowTokens = this.recentTokens.reduce((sum, r) => sum + r.tokens, 0);
    this.state.burnRate = Math.round(windowTokens); // tokens in last minute
  }

  /**
   * Record a compaction event.
   */
  recordCompaction(preTokens: number, timestamp: number): void {
    this.state.compactionCount++;
    this.state.lastCompaction = timestamp;
    // After compaction, context resets significantly
    this.state.contextPercent = Math.min(50, Math.round((preTokens * 0.3) / CONTEXT_WINDOW * 100));
  }

  reset(): void {
    this.state = {
      totalInput: 0,
      totalOutput: 0,
      totalCacheCreation: 0,
      totalCacheRead: 0,
      totalCost: 0,
      contextPercent: 0,
      burnRate: 0,
      modelCounts: {},
      history: [],
      compactionCount: 0,
    };
    this.recentTokens = [];
  }
}
