import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InsightEngine } from '../../llm/insight-engine.js';
import { CommanderChat } from '../../llm/commander-chat.js';
import { MockLLMProvider } from './helpers/mock-llm-provider.js';
import { LlmVerifier } from './helpers/llm-verifier.js';
import type { AVPEvent, SessionState, DependencyEdge } from '@hudai/shared';

/** Helper to create a test.result event */
function makeTestResult(
  passed: number,
  failed: number,
  overrides?: Partial<AVPEvent>,
): AVPEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sessionId: 'test-session',
    timestamp: Date.now(),
    category: 'testing',
    type: 'test.result',
    data: {
      passed,
      failed,
      total: passed + failed,
      failures: failed > 0 ? ['some test failed'] : [],
      durationMs: 1200,
    },
    ...overrides,
  } as AVPEvent;
}

function makeSessionState(overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: 'test-session',
    status: 'running',
    agentCurrentFile: 'src/app.ts',
    taskLabel: 'Fix failing tests',
    startedAt: Date.now() - 120_000,
    eventCount: 20,
    agentActivity: 'working',
    ...overrides,
  };
}

describe('Test Failure -> Advisor Proactive Alert', () => {
  let mockLLM: MockLLMProvider;
  let engine: InsightEngine;
  let chat: CommanderChat;
  let notifications: Array<{ context: string; severity: string; triggeredBy: string }>;
  let sessionState: SessionState;
  const graphEdges: DependencyEdge[] = [];

  beforeEach(() => {
    mockLLM = new MockLLMProvider();
    mockLLM.setDefaultResponse('Agent is struggling with repeated test failures.');

    sessionState = makeSessionState();

    engine = new InsightEngine(mockLLM, () => graphEdges);
    chat = new CommanderChat(
      mockLLM,
      () => engine.recentEvents,
      () => sessionState,
      () => engine.intentHistory,
      () => graphEdges,
    );
    chat.setSessionId('test-session');
    chat.setVerbosity('verbose'); // Allow proactive messages through

    // Capture notifications from InsightEngine
    notifications = [];
    engine.onNotification = (context, severity, triggeredBy) => {
      notifications.push({ context, severity, triggeredBy });
    };
  });

  it('fires notification after 3 consecutive test failures', () => {
    // Step 1: First failure — no notification
    engine.onEvent(makeTestResult(3, 1), sessionState);
    expect(notifications).toHaveLength(0);

    // Step 2: Second failure — no notification
    engine.onEvent(makeTestResult(2, 2), sessionState);
    expect(notifications).toHaveLength(0);

    // Step 3: Third failure — notification fires
    engine.onEvent(makeTestResult(1, 3), sessionState);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].severity).toBe('warning');
    expect(notifications[0].triggeredBy).toBe('consecutive.failures');
    expect(notifications[0].context).toContain('failures');
  });

  it('routes notification through CommanderChat as proactive advisor message', async () => {
    // Accumulate 3 failures to trigger notification
    engine.onEvent(makeTestResult(3, 1), sessionState);
    engine.onEvent(makeTestResult(2, 2), sessionState);
    engine.onEvent(makeTestResult(1, 3), sessionState);

    expect(notifications).toHaveLength(1);

    // Route the notification through CommanderChat.pushProactive
    const n = notifications[0];
    await chat.pushProactive(n.context, n.severity as any, n.triggeredBy);

    // Flush should contain a chat.message with proactive flag
    const messages = chat.flush();
    const chatMessages = messages.filter(m => m.kind === 'chat.message');
    expect(chatMessages.length).toBeGreaterThanOrEqual(1);

    const advisorMsg = chatMessages.find(
      m => m.kind === 'chat.message' && (m as any).message?.role === 'advisor',
    );
    expect(advisorMsg).toBeDefined();
    const msg = (advisorMsg as any).message;
    expect(msg.proactive).toBe(true);
    expect(msg.role).toBe('advisor');
    expect(msg.triggeredBy).toBe('consecutive.failures');
  });

  it('does not fire notification for passing tests', () => {
    // Feed 3 failures first
    engine.onEvent(makeTestResult(3, 1), sessionState);
    engine.onEvent(makeTestResult(2, 2), sessionState);
    engine.onEvent(makeTestResult(1, 3), sessionState);
    expect(notifications).toHaveLength(1);

    // Now a passing test — should not trigger another failure notification
    const countBefore = notifications.length;
    engine.onEvent(makeTestResult(10, 0), sessionState);
    // The recovery notification is a separate trigger, but no new failure notification
    const failureNotifications = notifications.filter(
      n => n.triggeredBy === 'consecutive.failures',
    );
    expect(failureNotifications).toHaveLength(1); // Still just the original one
  });

  it('deduplicates rapid-fire proactive messages with same triggeredBy', async () => {
    // Trigger 3 failures
    engine.onEvent(makeTestResult(3, 1), sessionState);
    engine.onEvent(makeTestResult(2, 2), sessionState);
    engine.onEvent(makeTestResult(1, 3), sessionState);

    // Route first notification
    const n = notifications[0];
    await chat.pushProactive(n.context, n.severity as any, n.triggeredBy);
    const callCountAfterFirst = mockLLM.callLog.length;

    // Fire 3 more failures immediately
    engine.onEvent(makeTestResult(0, 4), sessionState);
    engine.onEvent(makeTestResult(0, 5), sessionState);
    engine.onEvent(makeTestResult(0, 6), sessionState);

    // Get any new notifications with the same triggeredBy
    const newNotifications = notifications.filter(
      (_, i) => i > 0 && notifications[i].triggeredBy === 'consecutive.failures',
    );

    // Even if new notifications fire, pushing them should be deduped
    for (const nn of newNotifications) {
      await chat.pushProactive(nn.context, nn.severity as any, nn.triggeredBy);
    }

    // LLM should NOT have been called again for the same triggeredBy
    // (CommanderChat deduplicates consecutive same-trigger proactive messages)
    const proactiveCalls = mockLLM.callLog.filter(
      c => c.prompt.includes('ALERT'),
    );
    expect(proactiveCalls).toHaveLength(1);
  });

  it('optionally runs LLM verifier when HUDAI_LLM_VERIFY=1', async () => {
    if (!LlmVerifier.isEnabled()) {
      // Skip — just verify the flag check works
      expect(LlmVerifier.isEnabled()).toBe(false);
      return;
    }

    // Run scenario
    engine.onEvent(makeTestResult(3, 1), sessionState);
    engine.onEvent(makeTestResult(2, 2), sessionState);
    engine.onEvent(makeTestResult(1, 3), sessionState);

    const n = notifications[0];
    await chat.pushProactive(n.context, n.severity as any, n.triggeredBy);
    const messages = chat.flush();

    // Verify with LLM
    const verifier = new LlmVerifier(mockLLM);
    mockLLM.whenPromptContains('test verifier', JSON.stringify({
      pass: true,
      violations: [],
      notes: ['Notification correctly fired after 3 failures'],
    }));

    const result = await verifier.verify(
      'After 3 consecutive test failures, InsightEngine should fire a warning notification, and CommanderChat should produce a proactive advisor message.',
      {
        wsMessages: messages,
        llmCallLog: mockLLM.callLog,
        agentWrites: [],
      },
    );
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});
