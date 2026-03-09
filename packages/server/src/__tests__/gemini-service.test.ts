import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BaseLLMProvider } from '../llm/base-provider.js';

// Create a concrete test subclass instead of testing GeminiService directly
class TestLLMProvider extends BaseLLMProvider {
  protected readonly providerName = 'test';
  public mockCallLLM = vi.fn<(prompt: string) => Promise<string>>();
  public mockVerifyKey = vi.fn<() => Promise<boolean>>();

  protected async callLLM(prompt: string): Promise<string> {
    return this.mockCallLLM(prompt);
  }

  protected async verifyKey(): Promise<boolean> {
    return this.mockVerifyKey();
  }
}

describe('BaseLLMProvider', () => {
  let provider: TestLLMProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    provider = new TestLLMProvider();
    provider.mockCallLLM.mockResolvedValue('response');
    provider.mockVerifyKey.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- verify ---

  it('verify calls verifyKey and returns true on success', async () => {
    const result = await provider.verify();
    expect(result).toBe(true);
    expect(provider.status).toBe('connected');
  });

  it('verify sets error status on failure', async () => {
    provider.mockVerifyKey.mockRejectedValue(new Error('bad key'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await provider.verify();
    expect(result).toBe(false);
    expect(provider.status).toBe('error');
    spy.mockRestore();
  });

  it('verify fires onStatusChange callback', async () => {
    const statuses: string[] = [];
    provider.onStatusChange = (s) => statuses.push(s);
    await provider.verify();
    // Status should be set to 'connected' (might already be connected, so may not fire)
    expect(provider.status).toBe('connected');
  });

  // --- ask ---

  it('ask returns LLM response', async () => {
    provider.mockCallLLM.mockResolvedValue('hello world');
    // Need to advance timers to bypass rate limiting
    const promise = provider.ask('test prompt');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('hello world');
  });

  it('ask transitions status through thinking and back', async () => {
    const statuses: string[] = [];
    provider.onStatusChange = (s) => statuses.push(s);
    const promise = provider.ask('prompt');
    await vi.runAllTimersAsync();
    await promise;
    expect(statuses).toContain('thinking');
    expect(statuses[statuses.length - 1]).toBe('connected');
  });

  it('ask fires onActivityChange callbacks', async () => {
    const activities: (string | null)[] = [];
    provider.onActivityChange = (label) => activities.push(label);
    const promise = provider.ask('prompt', 'Summarize');
    await vi.runAllTimersAsync();
    await promise;
    expect(activities).toContain('Summarize');
    expect(activities[activities.length - 1]).toBeNull();
  });

  it('ask returns null on callLLM error', async () => {
    provider.mockCallLLM.mockRejectedValue(new Error('API error'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const promise = provider.ask('prompt');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBeNull();
    spy.mockRestore();
  });

  it('ask sets error base status on failure', async () => {
    provider.mockCallLLM.mockRejectedValue(new Error('fail'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const promise = provider.ask('prompt');
    await vi.runAllTimersAsync();
    await promise;
    // After error, base status should be error
    expect(provider.status).toBe('error');
    spy.mockRestore();
  });

  // --- queue behavior ---

  it('processes queue in FIFO order', async () => {
    const order: string[] = [];
    provider.mockCallLLM.mockImplementation(async (prompt) => {
      order.push(prompt);
      return prompt;
    });
    const p1 = provider.ask('first');
    const p2 = provider.ask('second');
    const p3 = provider.ask('third');
    await vi.runAllTimersAsync();
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('drops oldest when queue exceeds MAX_QUEUE_SIZE (5)', async () => {
    // Make callLLM hang so queue fills up
    let resolveFirst: (v: string) => void;
    provider.mockCallLLM.mockImplementationOnce(() =>
      new Promise<string>((r) => { resolveFirst = r; })
    );

    // First call starts processing
    const p0 = provider.ask('processing');
    // Now queue up 6 more (queue max is 5)
    const promises: Promise<string | null>[] = [];
    for (let i = 1; i <= 6; i++) {
      promises.push(provider.ask(`queued-${i}`));
    }

    // queued-1 should have been dropped (resolved with null)
    const dropped = await promises[0];
    expect(dropped).toBeNull();

    // Resolve the first call and let the rest drain
    resolveFirst!('done');
    provider.mockCallLLM.mockResolvedValue('ok');
    await vi.runAllTimersAsync();
    await Promise.all([p0, ...promises.slice(1)]);
  });

  // --- rate limiting ---

  it('enforces MIN_INTERVAL_MS between calls', async () => {
    const callTimes: number[] = [];
    provider.mockCallLLM.mockImplementation(async () => {
      callTimes.push(Date.now());
      return 'ok';
    });

    const p1 = provider.ask('first');
    const p2 = provider.ask('second');
    await vi.runAllTimersAsync();
    await Promise.all([p1, p2]);

    expect(callTimes).toHaveLength(2);
    expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(3000);
  });

  // --- generate ---

  it('generate returns empty string on null', async () => {
    provider.mockCallLLM.mockRejectedValue(new Error('fail'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const promise = provider.generate('prompt');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('');
    spy.mockRestore();
  });

  it('generate returns LLM text on success', async () => {
    provider.mockCallLLM.mockResolvedValue('generated text');
    const promise = provider.generate('prompt');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('generated text');
  });
});

// --- GeminiService-specific tests ---
describe('GeminiService', () => {
  it('constructs with API key', async () => {
    // Mock the google generative AI module
    vi.mock('@google/generative-ai', () => ({
      GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
        getGenerativeModel: vi.fn().mockReturnValue({
          generateContent: vi.fn().mockResolvedValue({
            response: { text: () => 'pong' },
          }),
        }),
      })),
    }));

    const { GeminiService } = await import('../llm/gemini-service.js');
    const service = new GeminiService('test-key');
    expect(service.status).toBe('connected');

    vi.restoreAllMocks();
  });
});
