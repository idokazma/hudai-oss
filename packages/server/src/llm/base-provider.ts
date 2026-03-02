import type { LlmStatus } from '@hudai/shared';
import type { LLMProvider, LLMClient } from './llm-provider.js';

const MIN_INTERVAL_MS = 3000;
const MAX_QUEUE_SIZE = 5;

/**
 * Base class for LLM providers. Handles queue, rate limiting, and status tracking.
 * Subclasses only need to implement `callLLM()` and `verifyKey()`.
 */
export abstract class BaseLLMProvider implements LLMProvider, LLMClient {
  private lastCallAt = 0;
  private queue: Array<{ prompt: string; label: string; resolve: (v: string | null) => void }> = [];
  private processing = false;
  private _status: LlmStatus = 'connected';
  private _baseStatus: LlmStatus = 'connected';
  private _activeCalls = 0;

  onStatusChange?: (status: LlmStatus) => void;
  onActivityChange?: (label: string | null) => void;

  get status(): LlmStatus { return this._status; }

  /** The provider name for logging (e.g. 'gemini', 'openai', 'claude') */
  protected abstract readonly providerName: string;

  /** Make a raw LLM call. Subclasses implement this. */
  protected abstract callLLM(prompt: string): Promise<string>;

  /** Verify the API key works. Subclasses implement this. */
  protected abstract verifyKey(): Promise<boolean>;

  private setStatus(s: LlmStatus) {
    if (s !== this._status) {
      this._status = s;
      this.onStatusChange?.(s);
    }
  }

  private trackCallStart(label: string) {
    this._activeCalls++;
    this.setStatus('thinking');
    this.onActivityChange?.(label);
  }

  private trackCallEnd() {
    this._activeCalls = Math.max(0, this._activeCalls - 1);
    if (this._activeCalls === 0) {
      this.setStatus(this._baseStatus);
      this.onActivityChange?.(null);
    }
  }

  async verify(): Promise<boolean> {
    try {
      const ok = await this.verifyKey();
      if (ok) {
        this.lastCallAt = Date.now();
        this.setStatus('connected');
        console.log(`[${this.providerName}] API key verified — LLM connected`);
      }
      return ok;
    } catch (err) {
      console.error(`[${this.providerName}] API key verification failed:`, err);
      this.setStatus('error');
      return false;
    }
  }

  async ask(prompt: string, label = 'LLM'): Promise<string | null> {
    return new Promise((resolve) => {
      if (this.queue.length >= MAX_QUEUE_SIZE) {
        const dropped = this.queue.shift();
        dropped?.resolve(null);
      }
      this.queue.push({ prompt, label, resolve });
      this.drain();
    });
  }

  /** LLMClient interface — direct generation without queue metadata */
  async generate(prompt: string): Promise<string> {
    const result = await this.ask(prompt);
    return result ?? '';
  }

  private async drain() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      const now = Date.now();
      const wait = Math.max(0, MIN_INTERVAL_MS - (now - this.lastCallAt));
      if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
      }

      this.trackCallStart(item.label);
      try {
        this.lastCallAt = Date.now();
        const text = await this.callLLM(item.prompt);
        this._baseStatus = 'connected';
        this.trackCallEnd();
        item.resolve(text);
      } catch (err) {
        console.error(`[${this.providerName}] LLM call failed:`, err);
        this._baseStatus = 'error';
        this.trackCallEnd();
        item.resolve(null);
      }
    }

    this.processing = false;
  }
}
