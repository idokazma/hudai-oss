import { BaseLLMProvider } from './base-provider.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

/**
 * Anthropic Claude provider.
 * Uses the Anthropic Messages API directly via fetch (no SDK dependency).
 */
export class ClaudeProvider extends BaseLLMProvider {
  protected readonly providerName = 'claude';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, opts?: { model?: string }) {
    super();
    this.apiKey = apiKey;
    this.model = opts?.model ?? DEFAULT_MODEL;
  }

  protected async verifyKey(): Promise<boolean> {
    const text = await this.callLLM('ping');
    return text.length > 0;
  }

  protected async callLLM(prompt: string): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Claude API error ${res.status}: ${body}`);
    }

    const data = await res.json() as { content: Array<{ type: string; text?: string }> };
    const textBlock = data.content.find(b => b.type === 'text');
    return textBlock?.text ?? '';
  }
}
