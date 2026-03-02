import { BaseLLMProvider } from './base-provider.js';

const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * OpenAI-compatible provider.
 * Works with OpenAI, OpenRouter, and local servers (Ollama, LM Studio)
 * that expose an OpenAI-compatible chat completions endpoint.
 */
export class OpenAIProvider extends BaseLLMProvider {
  protected readonly providerName = 'openai';
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(apiKey: string, opts?: { baseUrl?: string; model?: string }) {
    super();
    this.apiKey = apiKey;
    this.baseUrl = (opts?.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.model = opts?.model ?? DEFAULT_MODEL;
  }

  protected async verifyKey(): Promise<boolean> {
    const text = await this.callLLM('ping');
    return text.length > 0;
  }

  protected async callLLM(prompt: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenAI API error ${res.status}: ${body}`);
    }

    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? '';
  }
}
