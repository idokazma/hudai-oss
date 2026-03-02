/** Token usage from a single JSONL message */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/** Model pricing per 1M tokens */
export interface ModelPricing {
  input: number;
  output: number;
}

/** Cumulative token/cost state for a session */
export interface TokenState {
  /** Total tokens by category */
  totalInput: number;
  totalOutput: number;
  totalCacheCreation: number;
  totalCacheRead: number;
  /** Estimated cost in USD */
  totalCost: number;
  /** Context usage estimate (0-100%) */
  contextPercent: number;
  /** Tokens per minute burn rate */
  burnRate: number;
  /** Model distribution */
  modelCounts: Record<string, number>;
  /** Per-message history for charts */
  history: Array<{
    timestamp: number;
    input: number;
    output: number;
    cost: number;
    model?: string;
  }>;
  /** Last compaction timestamp */
  lastCompaction?: number;
  /** Number of compactions this session */
  compactionCount: number;
}

/** Known model pricing (USD per 1M tokens) */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'opus': { input: 15, output: 75 },
  'sonnet': { input: 3, output: 15 },
  'haiku': { input: 0.80, output: 4 },
};

/** Get pricing for a model string like "claude-sonnet-4-6-20250514" */
export function getModelPricing(model: string): ModelPricing {
  if (model.includes('opus')) return MODEL_PRICING.opus;
  if (model.includes('haiku')) return MODEL_PRICING.haiku;
  return MODEL_PRICING.sonnet; // default
}

/** Get short model name */
export function getModelName(model: string): string {
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  if (model.includes('sonnet')) return 'sonnet';
  return 'unknown';
}

/** Calculate cost from usage and model */
export function calculateCost(usage: TokenUsage, model: string): number {
  const pricing = getModelPricing(model);
  const inputCost = (usage.inputTokens + usage.cacheCreationTokens) * pricing.input / 1_000_000;
  const outputCost = usage.outputTokens * pricing.output / 1_000_000;
  // Cache reads are cheaper (typically 10% of input price)
  const cacheReadCost = usage.cacheReadTokens * pricing.input * 0.1 / 1_000_000;
  return inputCost + outputCost + cacheReadCost;
}
