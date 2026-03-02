# Integration Test Scenarios

End-to-end scenario tests that exercise full data flows across Hudai's server, parser, LLM, and Telegram bot layers. Each scenario is self-contained and can be implemented independently.

---

## Table of Contents

1. [Test Harness](#test-harness)
2. [Scenario 1: Permission Prompt Lifecycle](#scenario-1-permission-prompt-lifecycle)
3. [Scenario 2: Advisor Proactive Alert (Test Failure → Recovery)](#scenario-2-advisor-proactive-alert-test-failure--recovery)
4. [Scenario 3: Pipeline Analysis (LLM-Driven Code Understanding)](#scenario-3-pipeline-analysis-llm-driven-code-understanding)
5. [LLM Verifier](#llm-verifier)

---

## Test Harness

### Mock Components

All scenarios share these mock/fake implementations. They replace real infrastructure (tmux, WebSocket, Telegram API, LLM) with in-memory equivalents.

#### MockAgentProcess

Replaces `AgentProcess` (EventEmitter from `packages/server/src/pty/agent-process.ts`). Simulates tmux pane output without a real terminal.

```typescript
import { EventEmitter } from 'events';

class MockAgentProcess extends EventEmitter {
  private paneLines: string[] = [];
  private writtenData: string[] = [];
  running = true;

  /** Simulate pane content changing (as if tmux capture-pane returned new output) */
  simulatePaneContent(lines: string[]): void {
    this.paneLines = lines;
    const content = lines.join('\n');
    this.emit('pane-content', content, null);
    // Also emit 'data' for any new lines
    this.emit('data', content);
  }

  /** Append lines to existing pane content */
  appendLines(newLines: string[]): void {
    this.paneLines.push(...newLines);
    this.simulatePaneContent(this.paneLines);
  }

  /** Record what was written (replaces tmux send-keys) */
  write(text: string): void {
    this.writtenData.push(text);
  }

  sendEnter(): void {
    this.writtenData.push('<ENTER>');
  }

  sendInterrupt(): void {
    this.writtenData.push('<ESCAPE>');
  }

  /** Inspect what was sent to the agent */
  getWrittenData(): string[] {
    return [...this.writtenData];
  }

  clearWrittenData(): void {
    this.writtenData = [];
  }

  attach(): this { return this; }
  detach(): void { this.running = false; }
  kill(): void { this.running = false; }
}
```

#### MockLLMProvider

Replaces the `LLMProvider` interface (`packages/server/src/llm/llm-provider.ts`). Returns canned responses and logs all prompts received.

```typescript
import type { LLMProvider, LlmStatus } from '@hudai/shared';

interface LLMCallLog {
  prompt: string;
  label?: string;
  response: string;
  timestamp: number;
}

class MockLLMProvider implements LLMProvider {
  status: LlmStatus = 'connected';
  onStatusChange?: (status: LlmStatus) => void;
  onActivityChange?: (label: string | null) => void;

  private responses: Map<string, string> = new Map();
  private defaultResponse = '{}';
  readonly callLog: LLMCallLog[] = [];

  /** Register a canned response. If prompt contains the key, return the value. */
  whenPromptContains(substring: string, response: string): void {
    this.responses.set(substring, response);
  }

  setDefaultResponse(response: string): void {
    this.defaultResponse = response;
  }

  async verify(): Promise<boolean> {
    return true;
  }

  async generate(prompt: string): Promise<string> {
    return this.resolveResponse(prompt);
  }

  async ask(prompt: string, label?: string): Promise<string | null> {
    this.onActivityChange?.(label ?? null);
    const response = this.resolveResponse(prompt, label);
    this.onActivityChange?.(null);
    return response;
  }

  private resolveResponse(prompt: string, label?: string): string {
    for (const [key, value] of this.responses) {
      if (prompt.includes(key)) {
        this.callLog.push({ prompt, label, response: value, timestamp: Date.now() });
        return value;
      }
    }
    this.callLog.push({ prompt, label, response: this.defaultResponse, timestamp: Date.now() });
    return this.defaultResponse;
  }

  /** Assert that a prompt containing `substring` was sent at least once */
  assertCalled(substring: string): void {
    const found = this.callLog.some(c => c.prompt.includes(substring));
    if (!found) throw new Error(`Expected LLM call containing "${substring}" but none found`);
  }
}
```

#### FakeWsBridge

Replaces `WsBridge` (`packages/telegram-bot/src/ws-bridge.ts`). Captures all messages sent/received without a real WebSocket.

```typescript
import type { ServerMessage, ClientMessage, SessionState } from '@hudai/shared';

type MessageHandler = (msg: ServerMessage) => void;

class FakeWsBridge {
  readonly cache = {
    session: null as SessionState | null,
    paneContent: null as string | null,
    tokens: null,
    intent: null,
    summary: null,
    notifications: [] as any[],
    panes: [],
    chatMessages: [] as any[],
    chatTyping: false,
    connected: true,
  };

  private handlers = new Set<MessageHandler>();
  private sentMessages: ClientMessage[] = [];

  /** Simulate server pushing a message to the bridge */
  injectServerMessage(msg: ServerMessage): void {
    // Update cache like the real bridge does
    if (msg.kind === 'session.state') this.cache.session = msg.state;
    if (msg.kind === 'pane.content') this.cache.paneContent = msg.content;
    // Notify handlers
    for (const handler of this.handlers) {
      handler(msg);
    }
  }

  send(msg: ClientMessage): void {
    this.sentMessages.push(msg);
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Inspect messages the bot tried to send to the server */
  getSentMessages(): ClientMessage[] {
    return [...this.sentMessages];
  }

  get isConnected(): boolean {
    return true;
  }

  connect(): void {}
  disconnect(): void {}
}
```

#### SpyBot

Wraps the grammY `Bot` to capture outgoing Telegram API calls (sendMessage, editMessageReplyMarkup, answerCallbackQuery) without hitting the real API.

```typescript
interface TelegramCall {
  method: string;
  chatId: number;
  text?: string;
  replyMarkup?: any;
  parseMode?: string;
  timestamp: number;
}

class SpyBot {
  readonly calls: TelegramCall[] = [];
  private chatId: number;

  constructor(chatId = 12345) {
    this.chatId = chatId;
  }

  /** Captures a sendMessage call */
  api = {
    sendMessage: async (chatId: number, text: string, opts?: any) => {
      this.calls.push({
        method: 'sendMessage',
        chatId,
        text,
        replyMarkup: opts?.reply_markup,
        parseMode: opts?.parse_mode,
        timestamp: Date.now(),
      });
      return { message_id: this.calls.length, chat: { id: chatId } };
    },
  };

  /** Get all messages sent to a specific chat */
  getMessages(chatId?: number): TelegramCall[] {
    const id = chatId ?? this.chatId;
    return this.calls.filter(c => c.chatId === id);
  }

  /** Assert a message containing `text` was sent */
  assertMessageSent(substring: string): void {
    const found = this.calls.some(c =>
      c.method === 'sendMessage' && c.text?.includes(substring)
    );
    if (!found) throw new Error(`Expected Telegram message containing "${substring}"`);
  }

  /** Assert an inline keyboard was included in a message */
  assertHasInlineKeyboard(substring: string): void {
    const msg = this.calls.find(c =>
      c.method === 'sendMessage' && c.text?.includes(substring)
    );
    if (!msg) throw new Error(`No message containing "${substring}"`);
    if (!msg.replyMarkup?.inline_keyboard) {
      throw new Error(`Message "${substring}" has no inline keyboard`);
    }
  }
}
```

### Helper: Collected Evidence

Every scenario collects evidence for assertions and the optional LLM verifier.

```typescript
interface ScenarioEvidence {
  wsMessages: ServerMessage[];      // All WS messages broadcast
  telegramCalls: TelegramCall[];    // All Telegram API calls
  llmCallLog: LLMCallLog[];        // All LLM prompts & responses
  agentWrites: string[];            // All data written to agent process
  sessionStates: SessionState[];    // Session state snapshots over time
}
```

---

## Scenario 1: Permission Prompt Lifecycle

**Goal**: Verify the complete flow from a permission prompt appearing in the terminal through to the user approving it via Telegram.

### Components Under Test

| Component | Role |
|---|---|
| `analyzePaneContent()` | Detects `waiting_permission` from pane text |
| Session state broadcaster | Emits `session.state` with `agentActivity: 'waiting_permission'` |
| `setupAutoNotifier()` | Receives `session.state`, sends Telegram notification |
| `setupCallbackHandlers()` | Routes `action:approve` callback to WsBridge |
| Command handler | Translates `approve` command to `write('y')` + `sendEnter()` |

### Preconditions

```typescript
const mockAgent = new MockAgentProcess();
const mockLLM = new MockLLMProvider();
const bridge = new FakeWsBridge();
const spyBot = new SpyBot();
const evidence: ScenarioEvidence = { wsMessages: [], telegramCalls: [], llmCallLog: [], agentWrites: [], sessionStates: [] };
```

### Script

#### Step 1: Agent is working normally

Simulate the agent producing normal output.

```typescript
mockAgent.simulatePaneContent([
  '⏺ Read src/index.ts',
  '  Reading file...',
  '  Done.',
  '',
]);
```

**Expected**: `analyzePaneContent()` returns `{ activity: 'working' }`.

#### Step 2: Permission prompt appears

Simulate a permission prompt in the pane.

```typescript
mockAgent.simulatePaneContent([
  '⏺ Bash',
  '  ──────────────',
  '  Bash command',
  '    npm test',
  '    Run the test suite',
  '  ──────────────',
  '  Do you want to proceed?',
  '',
]);
```

**Expected**:
- `analyzePaneContent()` returns:
  ```typescript
  {
    activity: 'waiting_permission',
    detail: 'Bash: npm test'
  }
  ```

#### Step 3: Server broadcasts session state

The server detects the activity change and broadcasts.

```typescript
const sessionState: SessionState = {
  sessionId: 'test-session-1',
  status: 'running',
  agentCurrentFile: null,
  taskLabel: 'Running tests',
  startedAt: Date.now(),
  eventCount: 5,
  agentActivity: 'waiting_permission',
  agentActivityDetail: 'Bash: npm test',
};

bridge.injectServerMessage({ kind: 'session.state', state: sessionState });
```

**Expected**:
- Telegram bot sends a message containing the terminal snippet
- Message includes an inline keyboard with **Approve** and **Reject** buttons
- `spyBot.assertMessageSent('npm test')` passes
- `spyBot.assertHasInlineKeyboard('npm test')` passes

#### Step 4: User taps Approve in Telegram

Simulate the callback query from Telegram.

```typescript
// Simulate callback: action:approve
// This triggers setupCallbackHandlers which calls:
bridge.send({ kind: 'command', command: { type: 'approve' } });
```

**Expected**:
- Bridge sends `{ kind: 'command', command: { type: 'approve' } }`
- Command handler calls `mockAgent.write('y')` then `mockAgent.sendEnter()`
- `mockAgent.getWrittenData()` contains `['y', '<ENTER>']`

#### Step 5: Agent resumes working

```typescript
mockAgent.simulatePaneContent([
  '⏺ Bash',
  '  $ npm test',
  '  PASS src/index.test.ts',
  '  Tests: 3 passed',
  '',
  '⏺ Read package.json',
]);
```

**Expected**:
- `analyzePaneContent()` returns `{ activity: 'working' }`
- New `session.state` broadcast with `agentActivity: 'working'`
- No duplicate Telegram notifications

### Variant: Silent Mode Suppression

Repeat steps 1–3 but with silent mode enabled in the Telegram bot config.

```typescript
const config: TelegramConfig = {
  chatId: 12345,
  silentMode: true,
  // ...
};
```

**Expected**:
- Permission notification is **still sent** (permission prompts bypass silent mode — they are critical)
- Verify by checking `spyBot.calls.length > 0`
- Intent/summary notifications would be suppressed in silent mode, but permission notifications are not

### Assertions Checklist

- [ ] `analyzePaneContent` correctly identifies `waiting_permission` with detail
- [ ] `session.state` message contains correct `agentActivity` and `agentActivityDetail`
- [ ] Telegram message contains terminal snippet with the command
- [ ] Telegram message has inline keyboard with Approve/Reject buttons
- [ ] Approve callback sends `{ type: 'approve' }` command through bridge
- [ ] Agent receives `'y'` + Enter via `write()` and `sendEnter()`
- [ ] After approval, activity transitions back to `working`
- [ ] No duplicate "waiting permission" notifications for the same prompt
- [ ] Silent mode does NOT suppress permission notifications

---

## Scenario 2: Advisor Proactive Alert (Test Failure → Recovery)

**Goal**: Verify that repeated test failures trigger the InsightEngine notification, which flows through CommanderChat to generate a proactive advisor message, gets broadcast via WebSocket, and is forwarded by the Telegram bot.

### Components Under Test

| Component | Role |
|---|---|
| `InsightEngine.onEvent()` | Ingests test failure events, fires `onNotification` callback |
| `CommanderChat.pushProactive()` | Receives notification, generates advisor message via LLM, respects throttle/dedup |
| WS broadcast | Sends `chat.message` to all clients |
| `setupAutoNotifier()` | Forwards advisor `chat.message` to Telegram |

### Preconditions

```typescript
const mockLLM = new MockLLMProvider();
const bridge = new FakeWsBridge();
const spyBot = new SpyBot();

// Configure LLM responses
mockLLM.whenPromptContains('test failures', JSON.stringify({
  message: 'I noticed 3 consecutive test failures in the auth module. The pattern suggests a missing mock setup. Consider checking the test fixtures.',
  severity: 'warning',
}));

// Wire up InsightEngine → CommanderChat
const insightEngine = new InsightEngine(mockLLM, () => []);
const commanderChat = new CommanderChat(
  mockLLM,
  () => insightEngine.recentEvents,
  () => sessionState,
  () => insightEngine.intentHistory,
  () => [],
);

// Connect the notification callback
insightEngine.onNotification = (context, severity, triggeredBy, minVerbosity) => {
  commanderChat.pushProactive(context, severity, triggeredBy, minVerbosity);
};
```

### Script

#### Step 1: First test failure event

```typescript
const testFail1: AVPEvent = {
  id: 'evt-1',
  sessionId: 'test-session-2',
  timestamp: Date.now(),
  category: 'testing',
  type: 'test.result',
  data: { passed: false, testName: 'auth.login.test', error: 'Expected 200, got 401' },
};

insightEngine.onEvent(testFail1, sessionState);
```

**Expected**: No notification yet (threshold not reached).

#### Step 2: Second test failure event

```typescript
const testFail2: AVPEvent = {
  id: 'evt-2',
  sessionId: 'test-session-2',
  timestamp: Date.now(),
  category: 'testing',
  type: 'test.result',
  data: { passed: false, testName: 'auth.signup.test', error: 'Expected 200, got 500' },
};

insightEngine.onEvent(testFail2, sessionState);
```

**Expected**: No notification yet.

#### Step 3: Third test failure event — triggers notification

```typescript
const testFail3: AVPEvent = {
  id: 'evt-3',
  sessionId: 'test-session-2',
  timestamp: Date.now(),
  category: 'testing',
  type: 'test.result',
  data: { passed: false, testName: 'auth.token.test', error: 'Token expired' },
};

insightEngine.onEvent(testFail3, sessionState);
```

**Expected**:
- `insightEngine.onNotification` fires with:
  - `severity`: `'warning'`
  - `triggeredBy`: contains `'test'` (e.g., `'test_failures'`)
- `commanderChat.pushProactive()` is called
- LLM is invoked — `mockLLM.assertCalled('test failures')` passes
- `commanderChat.flush()` returns a `ServerMessage` of kind `chat.message`
- The `ChatMessage` has `role: 'advisor'` and `proactive: true`

#### Step 4: Advisor message broadcast reaches Telegram

```typescript
const flushed = commanderChat.flush();
for (const msg of flushed) {
  bridge.injectServerMessage(msg);
}
```

**Expected**:
- Telegram bot sends a message with the advisor alert
- Message includes severity icon (⚠️ for warning)
- `spyBot.assertMessageSent('test failures')` or similar content passes

#### Step 5: Tests recover

```typescript
const testPass: AVPEvent = {
  id: 'evt-4',
  sessionId: 'test-session-2',
  timestamp: Date.now(),
  category: 'testing',
  type: 'test.result',
  data: { passed: true, testName: 'auth.login.test' },
};

insightEngine.onEvent(testPass, sessionState);
```

**Expected**:
- Failure counter resets
- No additional warning notification fires

### Variant: Throttle Dedup

Immediately after Step 3, fire 3 more test failures with the same pattern.

```typescript
// Rapid-fire 3 more failures
for (let i = 5; i <= 7; i++) {
  insightEngine.onEvent({
    id: `evt-${i}`,
    sessionId: 'test-session-2',
    timestamp: Date.now(),
    category: 'testing',
    type: 'test.result',
    data: { passed: false, testName: `auth.extra${i}.test`, error: 'Fail' },
  }, sessionState);
}
```

**Expected**:
- `commanderChat.pushProactive()` is called but **does not** generate a second LLM call
- Throttle check: `lastProactiveAt` is within `THROTTLE_MS['normal']` (15 minutes)
- Dedup check: `lastProactiveTrigger` matches the trigger string
- `mockLLM.callLog.length` remains the same as after Step 3

### Assertions Checklist

- [ ] No notification fires for fewer than 3 consecutive test failures
- [ ] `onNotification` callback fires on the 3rd failure with correct severity
- [ ] LLM is called with context about the test failures
- [ ] `flush()` produces a `chat.message` with `role: 'advisor'` and `proactive: true`
- [ ] Telegram receives the advisor message with severity icon
- [ ] Test recovery resets the failure counter
- [ ] Duplicate trigger within throttle window does NOT produce a second LLM call
- [ ] Different trigger type within throttle window DOES fire (dedup is per-trigger)

---

## Scenario 3: Pipeline Analysis (LLM-Driven Code Understanding)

**Goal**: Verify that `PipelineAnalyzer` constructs correct prompts from a codebase graph, parses LLM responses into valid pipeline definitions, caches results, and handles incremental updates.

### Components Under Test

| Component | Role |
|---|---|
| `PipelineAnalyzer.analyze()` | Orchestrates full/incremental analysis |
| LLM prompt construction | Builds file structure prompt for the model |
| Response parsing & validation | `parseAndValidate()` checks blocks against graph |
| Cache layer | `loadCache()`, `saveCache()`, `findStaleFiles()` |
| WS broadcast | Sends `pipeline.full` to clients |

### Preconditions

```typescript
const mockLLM = new MockLLMProvider();
const analyzer = new PipelineAnalyzer(mockLLM);

// Sample CodebaseGraph
const graph: CodebaseGraph = {
  nodes: [
    { path: 'src/api/routes.ts', type: 'file', loc: 120, imports: ['src/api/handler.ts'] },
    { path: 'src/api/handler.ts', type: 'file', loc: 80, imports: ['src/db/queries.ts'] },
    { path: 'src/db/queries.ts', type: 'file', loc: 60, imports: [] },
    { path: 'src/ws/broadcaster.ts', type: 'file', loc: 45, imports: [] },
    { path: 'src/events/emitter.ts', type: 'file', loc: 30, imports: ['src/ws/broadcaster.ts'] },
  ],
  edges: [
    { from: 'src/api/routes.ts', to: 'src/api/handler.ts', type: 'import' },
    { from: 'src/api/handler.ts', to: 'src/db/queries.ts', type: 'import' },
    { from: 'src/events/emitter.ts', to: 'src/ws/broadcaster.ts', type: 'import' },
  ],
};

// Canned LLM response for full analysis
const fullAnalysisResponse = JSON.stringify([
  {
    id: 'request-handling',
    label: 'API Request Pipeline',
    category: 'request-handling',
    description: 'HTTP request processing from routes to database',
    blocks: [
      { id: 'b1', fileId: 'src/api/routes.ts', type: 'source', label: 'Routes' },
      { id: 'b2', fileId: 'src/api/handler.ts', type: 'transform', label: 'Handler' },
      { id: 'b3', fileId: 'src/db/queries.ts', type: 'sink', label: 'Database' },
    ],
    edges: [
      { from: 'b1', to: 'b2', type: 'data' },
      { from: 'b2', to: 'b3', type: 'data' },
    ],
  },
  {
    id: 'event-broadcast',
    label: 'Event Broadcasting Pipeline',
    category: 'event-driven',
    description: 'Events emitted and broadcast via WebSocket',
    blocks: [
      { id: 'b4', fileId: 'src/events/emitter.ts', type: 'source', label: 'Emitter' },
      { id: 'b5', fileId: 'src/ws/broadcaster.ts', type: 'sink', label: 'WS Broadcast' },
    ],
    edges: [
      { from: 'b4', to: 'b5', type: 'data' },
    ],
  },
]);

mockLLM.whenPromptContains('pipeline', fullAnalysisResponse);
```

### Script

#### Step 1: Full analysis (no cache)

```typescript
const rootDir = '/tmp/test-project';
// Ensure no cache exists
// await clearCache(rootDir);

const result = await analyzer.analyze(rootDir, graph);
```

**Expected**:
- LLM is called exactly once
- `mockLLM.assertCalled('pipeline')` passes
- Prompt sent to LLM includes all file paths from the graph
- Result contains 2 pipelines:
  ```typescript
  expect(result.pipelines).toHaveLength(2);
  expect(result.pipelines[0].id).toBe('request-handling');
  expect(result.pipelines[1].id).toBe('event-broadcast');
  ```
- Each pipeline has valid blocks with `fileId` values that exist in `graph.nodes`
- Each block has a valid `type` (one of: `source`, `transform`, `sink`, `branch`, `merge`)
- Each edge has a valid `type` (one of: `data`, `control`, `error`)
- Cache is written to disk at `~/.hudai/projects/<hash>/pipeline-cache.json`

#### Step 2: Cache hit (no changes)

```typescript
mockLLM.callLog.length; // Note count before
const result2 = await analyzer.analyze(rootDir, graph);
```

**Expected**:
- LLM is **NOT** called again (call log length unchanged)
- `result2` is identical to `result` (same pipeline definitions)
- Cache is read from disk, not regenerated

#### Step 3: File change triggers incremental analysis

Simulate `src/api/handler.ts` being modified (newer mtime than cache).

```typescript
// The cache layer's findStaleFiles would detect handler.ts as changed
// For testing, modify the file's mtime or mock findStaleFiles

const incrementalResponse = JSON.stringify([
  {
    id: 'request-handling',
    label: 'API Request Pipeline',
    category: 'request-handling',
    description: 'HTTP request processing — handler now validates input',
    blocks: [
      { id: 'b1', fileId: 'src/api/routes.ts', type: 'source', label: 'Routes' },
      { id: 'b2', fileId: 'src/api/handler.ts', type: 'transform', label: 'Handler + Validation' },
      { id: 'b3', fileId: 'src/db/queries.ts', type: 'sink', label: 'Database' },
    ],
    edges: [
      { from: 'b1', to: 'b2', type: 'data' },
      { from: 'b2', to: 'b3', type: 'data' },
    ],
  },
]);

mockLLM.whenPromptContains('incremental', incrementalResponse);

const result3 = await analyzer.analyze(rootDir, graph);
```

**Expected**:
- LLM is called once for incremental analysis
- Prompt mentions only the changed file (`src/api/handler.ts`) and its affected pipeline
- The `request-handling` pipeline is updated (block b2 label changed)
- The `event-broadcast` pipeline is unchanged (preserved from cache)
- Merged result has 2 pipelines total
- Updated cache is written to disk

#### Step 4: WS broadcast

```typescript
const wsMessage: ServerMessage = {
  kind: 'pipeline.full',
  layer: result3,
};

bridge.injectServerMessage(wsMessage);
```

**Expected**:
- `pipeline.full` message contains both pipelines
- Client receives the complete pipeline layer with updated data

### Variant: Incremental Threshold Exceeded

When more than 30% of files change (or > 15 files), the analyzer falls back to full analysis.

```typescript
// Mock staleness indicating 3 out of 5 files changed (60% > 30% threshold)
// This exceeds INCREMENTAL_MAX_RATIO = 0.3
```

**Expected**:
- Analyzer skips incremental path
- Performs full analysis instead
- LLM prompt includes all files, not just changed ones

### Assertions Checklist

- [ ] Full analysis sends all graph file paths in the LLM prompt
- [ ] LLM response is parsed into valid `PipelineDefinition[]`
- [ ] Block `fileId` values are validated against graph nodes (invalid ones filtered)
- [ ] Block `type` values are validated (only `source`, `transform`, `sink`, `branch`, `merge`)
- [ ] Edge `type` values are validated (only `data`, `control`, `error`)
- [ ] Cache is written after full analysis
- [ ] Cache hit skips LLM call entirely
- [ ] Incremental analysis only mentions changed files in prompt
- [ ] Unchanged pipelines are preserved from cache during merge
- [ ] Changed pipeline blocks are replaced with LLM output
- [ ] `pipeline.full` WS message contains complete merged result
- [ ] Exceeding `INCREMENTAL_MAX_RATIO` (0.3) triggers full analysis instead

---

## LLM Verifier

An optional second-pass verification that uses an LLM to semantically evaluate test results. This catches issues that deterministic assertions might miss (e.g., "the notification message is helpful and relevant to the failure").

### Activation

```bash
HUDAI_LLM_VERIFY=1 npm test -- --grep integration
```

The verifier only runs **after** all deterministic assertions pass. If deterministic assertions fail, the test fails fast without spending LLM tokens.

### Architecture

```typescript
interface VerifierResult {
  pass: boolean;
  violations: string[];
  notes: string;
}

interface VerifierInput {
  scenarioName: string;
  scenarioDescription: string;
  evaluationCriteria: string[];
  evidence: ScenarioEvidence;
}

class LlmVerifier {
  constructor(private llm: LLMClient) {}

  async verify(input: VerifierInput): Promise<VerifierResult> {
    const prompt = this.buildPrompt(input);
    const response = await this.llm.generate(prompt);
    return JSON.parse(response);
  }

  private buildPrompt(input: VerifierInput): string {
    return `You are a test verifier for the Hudai monitoring system.

## Scenario: ${input.scenarioName}
${input.scenarioDescription}

## Evaluation Criteria
${input.evaluationCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Evidence

### WebSocket Messages Broadcast
${JSON.stringify(input.evidence.wsMessages, null, 2)}

### Telegram API Calls
${JSON.stringify(input.evidence.telegramCalls, null, 2)}

### LLM Prompts & Responses
${JSON.stringify(input.evidence.llmCallLog, null, 2)}

### Data Written to Agent
${JSON.stringify(input.evidence.agentWrites)}

## Task
Evaluate whether the scenario executed correctly according to the criteria.
Return JSON: { "pass": boolean, "violations": string[], "notes": string }

- "pass" is true only if ALL criteria are satisfied
- "violations" lists each failed criterion with explanation
- "notes" provides any additional observations`;
  }
}
```

### Per-Scenario Evaluation Criteria

#### Scenario 1: Permission Prompt Lifecycle

```typescript
const criteria = [
  'The permission notification includes enough context for the user to make an informed approve/reject decision (tool name + command)',
  'The inline keyboard has exactly two action buttons: Approve and Reject',
  'After approval, the agent receives exactly "y" followed by Enter — no extra characters',
  'The session state transitions are: working → waiting_permission → working (no gaps or duplicates)',
  'No notification is sent while the agent is in "working" state (only on transition to waiting_permission)',
];
```

#### Scenario 2: Advisor Proactive Alert

```typescript
const criteria = [
  'The advisor message is relevant to the test failures and provides actionable guidance',
  'The notification severity matches the situation (warning for repeated failures, not info or critical)',
  'The Telegram message formatting distinguishes advisor messages from system notifications',
  'Throttle/dedup correctly prevents duplicate alerts for the same trigger within the cooldown window',
  'The LLM prompt includes sufficient context about the failures (test names, error messages, count)',
];
```

#### Scenario 3: Pipeline Analysis

```typescript
const criteria = [
  'The LLM prompt describes the file structure clearly enough for the model to identify data flow patterns',
  'All pipeline blocks reference files that actually exist in the codebase graph',
  'Pipeline edges form valid DAGs (no cycles, source/sink at correct ends)',
  'Incremental analysis preserves unchanged pipelines exactly and only updates affected ones',
  'The merged result is internally consistent (no dangling edge references, no duplicate block IDs)',
];
```

### Usage in Tests

```typescript
import { describe, it } from 'vitest';

describe('Integration: Permission Prompt Lifecycle', () => {
  it('completes the full approval flow', async () => {
    // ... run scenario steps 1-5 ...
    // ... deterministic assertions ...

    // Optional LLM verification
    if (process.env.HUDAI_LLM_VERIFY === '1') {
      const verifier = new LlmVerifier(realLLMClient);
      const result = await verifier.verify({
        scenarioName: 'Permission Prompt Lifecycle',
        scenarioDescription: 'Tests the flow from permission prompt detection through Telegram approval to agent resumption.',
        evaluationCriteria: criteria,
        evidence,
      });
      expect(result.pass).toBe(true);
      if (!result.pass) {
        console.error('LLM Verifier violations:', result.violations);
      }
    }
  });
});
```

### Cost Control

- Verifier uses the cheapest capable model (e.g., `claude-haiku-4-5`)
- Evidence is truncated to last 50 WS messages, 20 Telegram calls, 10 LLM logs
- Each verification costs ~2-5K tokens
- Only runs when `HUDAI_LLM_VERIFY=1` is set — CI defaults to deterministic-only

---

## File Reference

| File | Role in Tests |
|---|---|
| `packages/server/src/pty/agent-process.ts` | Mocked by `MockAgentProcess` |
| `packages/server/src/parser/pane-analyzer.ts` | Used directly — `analyzePaneContent()` is pure |
| `packages/server/src/llm/insight-engine.ts` | Used directly with `MockLLMProvider` |
| `packages/server/src/llm/commander-chat.ts` | Used directly with `MockLLMProvider` |
| `packages/server/src/llm/llm-provider.ts` | Interface implemented by `MockLLMProvider` |
| `packages/server/src/pipeline/pipeline-analyzer.ts` | Used directly with `MockLLMProvider` |
| `packages/telegram-bot/src/ws-bridge.ts` | Replaced by `FakeWsBridge` |
| `packages/telegram-bot/src/notifications/auto-notifier.ts` | Used directly with `SpyBot` + `FakeWsBridge` |
| `packages/shared/src/ws-messages.ts` | Types used throughout (ServerMessage, SessionState, AgentActivity) |
