import { describe, it, expect } from 'vitest';
import { getModelPricing, getModelName, calculateCost, MODEL_PRICING } from '../token-types.js';
import type { TokenUsage } from '../token-types.js';

describe('getModelPricing', () => {
  it('returns opus pricing for opus model string', () => {
    expect(getModelPricing('claude-opus-4-6-20250514')).toEqual(MODEL_PRICING.opus);
  });

  it('returns haiku pricing for haiku model string', () => {
    expect(getModelPricing('claude-haiku-4-5-20251001')).toEqual(MODEL_PRICING.haiku);
  });

  it('returns sonnet pricing for sonnet model string', () => {
    expect(getModelPricing('claude-sonnet-4-6-20250514')).toEqual(MODEL_PRICING.sonnet);
  });

  it('defaults to sonnet pricing for unknown model', () => {
    expect(getModelPricing('gpt-4o')).toEqual(MODEL_PRICING.sonnet);
  });
});

describe('getModelName', () => {
  it('returns "opus" for opus model ID', () => {
    expect(getModelName('claude-opus-4-6-20250514')).toBe('opus');
  });

  it('returns "haiku" for haiku model ID', () => {
    expect(getModelName('claude-haiku-4-5-20251001')).toBe('haiku');
  });

  it('returns "sonnet" for sonnet model ID', () => {
    expect(getModelName('claude-sonnet-4-6-20250514')).toBe('sonnet');
  });

  it('returns "unknown" for unrecognized model', () => {
    expect(getModelName('gpt-4o')).toBe('unknown');
  });
});

describe('calculateCost', () => {
  const usage: TokenUsage = {
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };

  it('calculates cost for sonnet model', () => {
    // input: 1M * $3/1M = $3, output: 100k * $15/1M = $1.5
    const cost = calculateCost(usage, 'sonnet');
    expect(cost).toBeCloseTo(4.5);
  });

  it('calculates cost for opus model', () => {
    // input: 1M * $15/1M = $15, output: 100k * $75/1M = $7.5
    const cost = calculateCost(usage, 'opus');
    expect(cost).toBeCloseTo(22.5);
  });

  it('applies 10% cache read discount', () => {
    const usageWithCache: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 1_000_000,
    };
    // cache reads: 1M * $3 * 0.1 / 1M = $0.30 for sonnet
    const cost = calculateCost(usageWithCache, 'sonnet');
    expect(cost).toBeCloseTo(0.3);
  });

  it('includes cache creation tokens in input cost', () => {
    const usageWithCreation: TokenUsage = {
      inputTokens: 500_000,
      outputTokens: 0,
      cacheCreationTokens: 500_000,
      cacheReadTokens: 0,
    };
    // (500k + 500k) * $3/1M = $3
    const cost = calculateCost(usageWithCreation, 'sonnet');
    expect(cost).toBeCloseTo(3);
  });
});
