import { GoogleGenerativeAI } from '@google/generative-ai';
import { BaseLLMProvider } from './base-provider.js';

const MODEL = 'gemini-2.5-flash';

export class GeminiService extends BaseLLMProvider {
  protected readonly providerName = 'gemini';
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    super();
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  protected async verifyKey(): Promise<boolean> {
    const model = this.genAI.getGenerativeModel({ model: MODEL });
    await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
    });
    return true;
  }

  protected async callLLM(prompt: string): Promise<string> {
    const model = this.genAI.getGenerativeModel({ model: MODEL });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    return result.response.text();
  }
}
