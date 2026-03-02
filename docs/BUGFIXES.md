# Hudai Bug Fixes Plan

## Bug 1: Build Queue Duplicates

**Symptom:** The build queue (left panel) shows the same user prompts repeated dozens of times — "review the admin panels...", "I care about speed...", etc.

**Root Cause (two issues):**

1. **Parser re-emits `task.start` for every `❯` line captured from tmux.** The terminal is polled every 500ms via `capture-pane`. The anchor-based diffing should prevent re-detection, but when the terminal scrolls or reflows, old `❯` prompt lines reappear in the capture buffer and get re-parsed as new `task.start` events.
   - File: `packages/server/src/parser/claude-code-parser.ts:213-221`

2. **Plan store dedup is weak.** It only checks if the *last* task has the same name (`plan-store.ts:97`). If a different phase gets auto-inferred between two identical prompts, the dedup fails and the prompt is added again.
   - File: `packages/client/src/stores/plan-store.ts:96-97`

**Fix:**

- **Server-side:** Track emitted `task.start` prompts in a `Set<string>` inside `ClaudeCodeParser`. Skip re-emitting if the same prompt text was already emitted within the current session. Clear the set on session reset.
  - File: `packages/server/src/parser/claude-code-parser.ts`

- **Client-side:** Strengthen dedup in `plan-store.ts` — check ALL existing tasks for matching names (not just the last one). Use a `Set<string>` of seen task names.
  - File: `packages/client/src/stores/plan-store.ts`

---

## Bug 2: Permission Alerts Don't Disappear After Approve/Reject

**Symptom:** When a permission prompt appears and the user clicks Approve or Reject (in either the AlertsPanel or CommandBar), the alert stays visible with its Approve/Reject buttons still active.

**Root Cause:** Neither `AlertsPanel.tsx` nor `CommandBar.tsx` calls `removeAlert()` after sending the approve/reject command. The `removeAlert` function exists in `alert-store.ts:40-42` but is never invoked.

**Fix:**

- **AlertsPanel.tsx:** After clicking Approve/Reject, call `removeAlert(alert.id)` to remove the specific alert. Also mark `actionable: false` so the buttons disappear even if the alert isn't immediately removed.
  - File: `packages/client/src/components/RightPanel/AlertsPanel.tsx:89,103`

- **CommandBar.tsx:** After clicking Approve/Reject, find and remove all actionable alerts from the store.
  - File: `packages/client/src/components/RightPanel/CommandBar.tsx:32-38`

- **Auto-dismiss on permission resolution:** When a `permission.response` or next non-permission event arrives, automatically clear any remaining actionable alerts.
  - File: `packages/client/src/stores/alert-store.ts` — add a `clearActionable()` method, called from `useWebSocket.ts` when a non-permission event follows a permission prompt.

---

## Bug 3: Activity Feed Too Noisy

**Symptom:** Every single `file.read` event gets its own row in the activity feed. When the agent reads 20 files in rapid succession, the feed becomes a wall of READ entries that obscures meaningful actions like EDIT, BASH, TEST.

**Fix — Compact consecutive same-type events:**

- **Batching logic in `CurrentActionWidget.tsx`:** Instead of showing every event as a separate row, group consecutive events of the same type into a single collapsed row.
  - `READ x12` (expandable to see the file list) instead of 12 separate READ rows
  - `GREP x3` instead of 3 separate GREP rows
  - Non-batchable events (BASH, EDIT, TEST, THINK, ERROR, APPROVE) always get their own row

- **Implementation:**
  1. After building the `ActionInfo[]` array, post-process it to merge consecutive same-tool entries
  2. Add a `batchCount: number` and `batchItems: string[]` field to `ActionInfo`
  3. In the feed UI, batched rows show `READ ×12` with an expand button listing the files
  4. Only batch `READ`, `GREP`, `GLOB` — these are the high-frequency low-signal events
  5. Non-consecutive events of the same type are NOT batched (e.g., READ → EDIT → READ stays as 3 rows)

- **File:** `packages/client/src/components/RightPanel/CurrentActionWidget.tsx`

---

## Build Order

1. Fix Bug 1 (server parser dedup + client plan store dedup)
2. Fix Bug 2 (alert removal on approve/reject + auto-dismiss)
3. Fix Bug 3 (activity feed batching)

## Files to Modify

| File | Bug |
|------|-----|
| `packages/server/src/parser/claude-code-parser.ts` | 1 |
| `packages/client/src/stores/plan-store.ts` | 1 |
| `packages/client/src/components/RightPanel/AlertsPanel.tsx` | 2 |
| `packages/client/src/components/RightPanel/CommandBar.tsx` | 2 |
| `packages/client/src/stores/alert-store.ts` | 2 |
| `packages/client/src/hooks/useWebSocket.ts` | 2 |
| `packages/client/src/components/RightPanel/CurrentActionWidget.tsx` | 3 |
