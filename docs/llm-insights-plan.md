# Implementation Plan: LLM Insights (Executive Summary + Intent + Smart Notifications)

## Overview

Three LLM-powered features sharing a common server-side `GeminiService` and client-side `InsightStore`. All are non-blocking, cached, and degrade gracefully without an API key.

---

## Shared Infrastructure

### Server: `packages/server/src/llm/gemini-service.ts`

Singleton service wrapping Gemini 2.5 Flash with:
- **Rate limiting**: Max 1 call per 5 seconds (queue if burst)
- **Token budget**: Truncate prompts to ~4000 tokens input
- **Error handling**: Log and return null on failure (never crash the server)

```typescript
export class GeminiService {
  constructor(apiKey: string)
  async ask(prompt: string, systemInstruction?: string): Promise<string | null>
}
```

Instantiated once in `index.ts` if `GEMINI_API_KEY` is set. Passed to the insight engine.

### Server: `packages/server/src/llm/insight-engine.ts`

Orchestrator that decides when to call Gemini and what to ask. Holds:
- Recent event buffer (last 30 events)
- Current intent (cached, only refreshes on focus shift)
- Summary cooldown (min 20s between summaries)
- Notification queue (batches events before sending to LLM)

```typescript
export class InsightEngine {
  constructor(private gemini: GeminiService)

  // Called for every AVPEvent
  onEvent(event: AVPEvent, sessionState: SessionState): void

  // Called when user clicks "Summarize" button
  async requestSummary(events: AVPEvent[], sessionState: SessionState): Promise<string>

  // Returns pending insights to broadcast
  flush(): InsightMessage[]
}
```

### Shared types: `packages/shared/src/insight-types.ts`

```typescript
export interface InsightSummary {
  text: string;
  generatedAt: number;
  eventWindow: [number, number]; // timestamp range covered
}

export interface InsightIntent {
  text: string;           // "Migrating database queries to Prisma"
  confidence: 'high' | 'medium' | 'low';
  detectedAt: number;
}

export interface InsightNotification {
  id: string;
  text: string;           // LLM-generated contextual message
  severity: 'info' | 'warning' | 'critical';
  triggeredBy: string;    // event type that triggered it
  timestamp: number;
}
```

### WebSocket messages (add to `ws-messages.ts`)

```typescript
| { kind: 'insight.summary'; summary: InsightSummary }
| { kind: 'insight.intent'; intent: InsightIntent }
| { kind: 'insight.notification'; notification: InsightNotification }
| { kind: 'insight.analyzing'; feature: 'summary' | 'intent' | 'notification' }
```

### Client: `packages/client/src/stores/insight-store.ts`

Zustand store:
```typescript
interface InsightState {
  summary: InsightSummary | null;
  intent: InsightIntent | null;
  notifications: InsightNotification[];
  analyzing: Set<string>; // which features are currently being generated

  setSummary(s: InsightSummary): void;
  setIntent(i: InsightIntent): void;
  addNotification(n: InsightNotification): void;
  setAnalyzing(feature: string, active: boolean): void;
}
```

---

## Feature 1: Intent Detection

### Trigger
- On attach (first analysis)
- When agent switches to a different directory cluster (>3 consecutive events in a new top-level group)
- Every 15 events as a background refresh

### Prompt
```
Given these recent agent actions in a codebase, describe in ONE short sentence
(max 12 words) what the agent is currently trying to accomplish.

Recent actions:
- [event type] [file path] [timestamp]
...

Current file: [agentCurrentFile]
Project structure: [top-level dirs]

Respond with ONLY the sentence, no quotes, no punctuation at the end.
```

### UI Placement
**ResourceBar** — replace the `taskLabel` chip (currently shows "Attached to tmux: %0") with the LLM-detected intent. Falls back to taskLabel if no intent yet.

```
┌──────────────────────────────────────────────────────────┐
│ HUDAI  [● RUNNING]  [Main > Explore]  |Context|Cost|Tests|  42 events | 3:24  [Migrating auth to OAuth2]  [⏸ Pause] │
└──────────────────────────────────────────────────────────┘
                                                                                  ^^^^^^^^^^^^^^^^^^^^^^^^
                                                                                  Intent replaces taskLabel
```

The intent chip gets a subtle shimmer animation while analyzing, then snaps to the new text. Use a slightly brighter color than the current muted taskLabel — `colors.accent.blueLight` with a faint glow.

---

## Feature 2: Executive Summary

### Trigger
- **Auto**: Every 20 significant events (file edits, test runs, shell commands — not reads/globs)
- **Manual**: User clicks a "Summarize" button
- **Cooldown**: Minimum 20 seconds between summaries

### Prompt
```
You are monitoring an AI coding agent. Summarize its current session status
in 2-3 concise sentences. Be specific about what files/modules it's working on
and whether it seems to be making progress or stuck.

Session duration: [elapsed]
Total events: [count]
Files read: [list of up to 10]
Files edited: [list]
Test results: [pass/fail if available]
Current activity: [working/waiting_permission/waiting_input]
Recent events (last 30):
[event list with timestamps]

Loop warnings: [if any]
Context usage: [percent]
```

### UI Placement
**BuildQueue left panel** — new tab called "Intel" alongside Queue/Docs/Config. This is the primary home for LLM insights.

```
┌─────────────────────────────────┐
│ [Queue] [Docs] [Config] [Intel] │  ← new tab
├─────────────────────────────────┤
│                                 │
│  EXECUTIVE SUMMARY              │
│  ─────────────────              │
│  Claude has been refactoring    │
│  the auth module for 12 min.    │
│  It edited oauth.ts and         │
│  middleware.ts. Currently        │
│  waiting for test results.      │
│                                 │
│  Updated 45s ago  [↻ Refresh]   │
│                                 │
│  ─────────────────              │
│  SMART ALERTS                   │
│  ─────────────────              │
│  ⚠ 3 test failures on same     │
│    assertion — possible          │
│    misunderstanding              │
│                                 │
│  ⚠ user-service.ts deleted     │
│    but 6 files still import it  │
│                                 │
└─────────────────────────────────┘
```

The summary card:
- Dark card with subtle blue-left border (like notifications)
- Monospace text, 11px, `colors.text.secondary`
- "Updated Xs ago" footer with a manual refresh button
- Shimmer/pulse animation while generating (replace text with 3 animated dots)

---

## Feature 3: Smart Notifications

### Trigger patterns
Each pattern is detected in `InsightEngine.onEvent()`:

| Pattern | Detection | LLM enrichment |
|---------|-----------|----------------|
| File deleted with dependents | `file.delete` + check graph edges for in-degree > 0 | "Deleted X but Y files still import it" |
| Repeated test failures | 3+ `test.fail` events within 60s | "N failures on same test — likely misunderstanding X" |
| Loop warning | `loop.warning` event from LoopDetector | "Agent is cycling through N files — may need guidance" |
| Permission denied repeatedly | 3+ `permission.prompt` for same tool | "Agent keeps requesting X permission — consider allowing" |
| Large file edit | `file.edit` on file with high in-degree | "Edited critical file X — affects N downstream modules" |

### Prompt (per notification type)
```
An AI coding agent just [description of pattern]. Given this context:
- [relevant details: file paths, test names, error messages]
- [graph info: dependents, import chains]

Write a single concise alert message (max 20 words) that helps a human
supervisor understand the situation and whether action is needed.
Respond with ONLY the alert text.
```

### UI Placement
Smart notifications go into the existing **NotificationBar** in the right panel, but with a distinct "AI insight" styling — a small sparkle icon and a purple-ish left border to distinguish from system notifications.

They also appear in the **Intel tab** in the left panel for persistence (system notifications are ephemeral, but AI insights should stick around for the session).

---

## File Changes Summary

### New files (5)
1. `packages/server/src/llm/gemini-service.ts` — Gemini API wrapper with rate limiting
2. `packages/server/src/llm/insight-engine.ts` — Event processing, trigger logic, prompt construction
3. `packages/shared/src/insight-types.ts` — Shared types for insights
4. `packages/client/src/stores/insight-store.ts` — Zustand store for insights
5. `packages/client/src/components/BuildQueue/IntelTab.tsx` — Intel tab UI (summary + alerts)

### Modified files (5)
1. `packages/shared/src/ws-messages.ts` — Add insight message types
2. `packages/shared/src/index.ts` — Export insight types
3. `packages/server/src/index.ts` — Instantiate GeminiService + InsightEngine, wire to event flow and broadcast
4. `packages/client/src/hooks/useWebSocket.ts` — Handle insight messages → insight store
5. `packages/client/src/components/BuildQueue/BuildQueue.tsx` — Add "Intel" tab
6. `packages/client/src/components/ResourceBar.tsx` — Replace taskLabel with intent
7. `packages/client/src/components/RightPanel/NotificationBar.tsx` — Render AI insight notifications with distinct styling

---

## Implementation Order

1. Shared types + WS messages (foundation)
2. GeminiService (server, can test standalone)
3. InsightEngine (server, event wiring)
4. Client store + WebSocket handler
5. Intent → ResourceBar (smallest UI change, immediate visual impact)
6. Intel tab + Executive Summary (new UI surface)
7. Smart Notifications (builds on existing NotificationBar)
