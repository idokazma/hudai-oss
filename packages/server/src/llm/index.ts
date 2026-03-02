export type { LLMProvider, LLMClient } from './llm-provider.js';
export { BaseLLMProvider } from './base-provider.js';
export { GeminiService } from './gemini-service.js';
export { OpenAIProvider } from './openai-provider.js';
export { ClaudeProvider } from './claude-provider.js';
export { InsightEngine } from './insight-engine.js';
export { CommanderChat } from './commander-chat.js';
export { SwarmRegistry } from './swarm-registry.js';
export { generateSkill, generateAgent } from './generator.js';

import type { LLMProvider } from './llm-provider.js';
import { GeminiService } from './gemini-service.js';
import { OpenAIProvider } from './openai-provider.js';
import { ClaudeProvider } from './claude-provider.js';

export type LLMProviderType = 'gemini' | 'openai' | 'claude';

export interface LLMProviderConfig {
  provider: LLMProviderType;
  apiKey: string;
  /** Base URL override — useful for OpenRouter, Ollama, etc. */
  baseUrl?: string;
  /** Model override */
  model?: string;
}

/**
 * Create an LLM provider from config.
 * Provider is selected via LLM_PROVIDER env var or explicit config.
 */
export function createLLMProvider(config: LLMProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'gemini':
      return new GeminiService(config.apiKey);
    case 'openai':
      return new OpenAIProvider(config.apiKey, {
        baseUrl: config.baseUrl,
        model: config.model,
      });
    case 'claude':
      return new ClaudeProvider(config.apiKey, {
        model: config.model,
      });
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

/**
 * Detect which provider to use based on available API keys.
 * Priority: LLM_PROVIDER env var → first available key.
 */
export function detectProvider(keys: {
  geminiApiKey?: string;
  openaiApiKey?: string;
  claudeApiKey?: string;
}): LLMProviderConfig | null {
  const explicit = process.env.LLM_PROVIDER as LLMProviderType | undefined;

  if (explicit === 'openai' && keys.openaiApiKey) {
    return { provider: 'openai', apiKey: keys.openaiApiKey, baseUrl: process.env.OPENAI_BASE_URL, model: process.env.LLM_MODEL };
  }
  if (explicit === 'claude' && keys.claudeApiKey) {
    return { provider: 'claude', apiKey: keys.claudeApiKey, model: process.env.LLM_MODEL };
  }
  if (explicit === 'gemini' && keys.geminiApiKey) {
    return { provider: 'gemini', apiKey: keys.geminiApiKey };
  }

  // Auto-detect from available keys
  if (keys.geminiApiKey) return { provider: 'gemini', apiKey: keys.geminiApiKey };
  if (keys.openaiApiKey) return { provider: 'openai', apiKey: keys.openaiApiKey, baseUrl: process.env.OPENAI_BASE_URL };
  if (keys.claudeApiKey) return { provider: 'claude', apiKey: keys.claudeApiKey };

  return null;
}
