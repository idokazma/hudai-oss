import type { LLMProvider } from '../../../llm/llm-provider.js';
import type { LlmStatus } from '@hudai/shared';

interface CannedResponse {
  substring: string;
  response: string;
}

export interface CallLogEntry {
  prompt: string;
  label?: string;
  response: string;
  timestamp: number;
}

/**
 * Mock LLMProvider with canned responses and call logging.
 * Implements both LLMProvider and LLMClient interfaces.
 */
export class MockLLMProvider implements LLMProvider {
  status: LlmStatus = 'connected';
  onStatusChange?: (status: LlmStatus) => void;
  onActivityChange?: (label: string | null) => void;

  private cannedResponses: CannedResponse[] = [];
  private defaultResponse = 'Mock LLM response';
  callLog: CallLogEntry[] = [];

  /** Register a canned response for prompts containing the given substring */
  whenPromptContains(substring: string, response: string): this {
    this.cannedResponses.push({ substring, response });
    return this;
  }

  /** Set fallback response when no canned match is found */
  setDefaultResponse(response: string): this {
    this.defaultResponse = response;
    return this;
  }

  private findResponse(prompt: string): string {
    for (const canned of this.cannedResponses) {
      if (prompt.includes(canned.substring)) {
        return canned.response;
      }
    }
    return this.defaultResponse;
  }

  async verify(): Promise<boolean> {
    return true;
  }

  async ask(prompt: string, label?: string): Promise<string | null> {
    this.onActivityChange?.(label || 'thinking');
    const response = this.findResponse(prompt);
    this.callLog.push({ prompt, label, response, timestamp: Date.now() });
    this.onActivityChange?.(null);
    return response;
  }

  async generate(prompt: string): Promise<string> {
    const response = this.findResponse(prompt);
    this.callLog.push({ prompt, response, timestamp: Date.now() });
    return response;
  }

  /** Assert that at least one call's prompt contains the given substring */
  assertCalled(substring: string): void {
    const found = this.callLog.some(c => c.prompt.includes(substring));
    if (!found) {
      throw new Error(
        `Expected LLM to be called with prompt containing "${substring}" but it was not.\n` +
        `Calls made: ${this.callLog.length}\n` +
        this.callLog.map((c, i) => `  [${i}] ${c.prompt.slice(0, 100)}...`).join('\n')
      );
    }
  }

  /** Reset all state */
  reset(): void {
    this.callLog = [];
    this.cannedResponses = [];
    this.defaultResponse = 'Mock LLM response';
  }
}
