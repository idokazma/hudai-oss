import type { LlmStatus } from '@hudai/shared';

/** Minimal interface for components that just need raw LLM generation (no queue/status) */
export interface LLMClient {
  generate(prompt: string): Promise<string>;
}

/**
 * Full LLM provider interface.
 * All providers (Gemini, OpenAI, Claude) implement this.
 * Extends LLMClient so providers can be passed to any consumer.
 */
export interface LLMProvider extends LLMClient {
  readonly status: LlmStatus;
  onStatusChange?: (status: LlmStatus) => void;
  onActivityChange?: (label: string | null) => void;

  /** Validate the API key with a lightweight call */
  verify(): Promise<boolean>;

  /** Queue a prompt for generation. Returns null on failure. */
  ask(prompt: string, label?: string): Promise<string | null>;
}
