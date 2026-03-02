# LLM Enrichment Backlog

Hudai has access to Gemini 2.5 Flash for codebase analysis. This document catalogs all planned LLM-powered features that enrich the monitoring and steering experience.

---

## Priority 1 — Next Up

### 1. Executive Summary
**What:** Periodic or on-demand natural language digest of the current session state.
**Example output:** "Claude has been refactoring the auth module for 12 minutes. It read 8 files, edited 3, and is currently stuck in a loop re-reading `oauth.ts`. The agent seems uncertain about the token refresh strategy."
**Trigger:** Every N significant events (e.g., 10 tool uses), on status change (idle→working→stuck), or on user click.
**Input to LLM:** Recent ~30 events, session duration, file touch counts, loop detector state, current pane content snippet.

### 2. Intent Detection — "What is the agent trying to do?"
**What:** One-liner describing the agent's current goal, updated when focus shifts.
**Example output:** "Migrating database queries from raw SQL to Prisma ORM"
**Trigger:** When the agent switches to a new file cluster (different directory) or after every ~10 events.
**Input to LLM:** Last ~15 events with file paths and types, pipeline context, previous intent (for continuity).
**Display:** Replaces the generic "Attached to tmux: %0" in the status bar.

### 3. Smart Notifications
**What:** LLM-summarized alerts replacing raw event toasts. Contextual, actionable.
**Examples:**
- "The agent deleted `user-service.ts` but 6 files still import from it"
- "3 consecutive test failures on the same assertion — likely a misunderstanding"
- "Reading the same 3 files in a cycle — may need guidance"
**Trigger:** On specific event patterns: deletions, repeated failures, loop warnings, permission denials.
**Input to LLM:** The triggering event + surrounding context (graph edges for deletion impact, test output for failures).

---

## Priority 2 — High Value

### 4. Pipeline Impact Overlay
**What:** When the agent edits a file, highlight which pipeline stages are affected and predict downstream consequences.
**Example:** "Editing the parser will affect Event Ingestion blocks 2-4. WebSocket broadcast format may change."
**Trigger:** On file edit events, cross-reference with pipeline block `files` arrays.
**Display:** Glow/pulse on affected pipeline blocks, tooltip with impact description.

### 5. Risk/Impact Assessment
**What:** Per-edit blast radius analysis based on the dependency graph.
**Example:** "High — these files are on the critical request path, touched by 14 other modules."
**Trigger:** On file edit/delete events for files with high in-degree in the dependency graph.
**Display:** Colored badge (green/yellow/red) on timeline events, expandable detail panel.

### 6. Suggested Next Actions
**What:** Proactive suggestions based on what the agent has done vs. what's likely still needed.
**Examples:**
- "Schema updated but types not regenerated — suggest running `prisma generate`"
- "Tests passing but README not updated to reflect new CLI flag"
**Trigger:** After a burst of edits settles (no new events for 30s), or on session pause.
**Input to LLM:** All mutations in session, common post-edit workflows for the detected tech stack.

---

## Priority 3 — Polish & Delight

### 7. Code Review Summary
**What:** End-of-session (or on-demand) summary of all code changes.
**Example:** "This session changed 7 files. Key changes: added retry logic to API client, fixed race condition in queue consumer, updated 3 test fixtures. No breaking changes to public interfaces."
**Trigger:** On session complete, or manual "Summarize" button.
**Input to LLM:** All file.edit/file.create/file.delete events with diffs if available.

### 8. Session Replay Narration
**What:** For completed sessions, generate a narrative timeline.
**Example:** "The agent started by exploring the codebase (2 min), focused on payments (8 min), hit a permissions issue (paused 30s), got approved, refactored 4 files, ran tests twice — first failed, second passed."
**Trigger:** When viewing a past session in replay mode.
**Input to LLM:** Full event stream with timestamps, grouped into phases by time gaps and focus shifts.

### 9. Architecture Drift Detection
**What:** Compare codebase graph before/after a session and flag architectural violations.
**Examples:**
- "New circular dependency introduced between `auth` and `billing` modules"
- "Direct database access added in a controller file — breaks layered architecture"
**Trigger:** On session complete, diff the graph edges.
**Input to LLM:** New edges not present before session, architecture container boundaries.

### 10. Natural Language Steering
**What:** Type high-level instructions that get translated into steering commands.
**Examples:**
- "Focus on the backend only" → scope boundary around server packages
- "Skip tests for now" → prompt with instruction
- "Undo the last change" → appropriate steering sequence
**Trigger:** User types in a dedicated "commander" input.
**Input to LLM:** User text + current session state + available steering commands schema.

---

## Priority 4 — Experimental / Delight

### 11. Session Illustration (Nano Banana)
**What:** AI-generated artwork alongside the executive summary that visually captures the session's story — what was built, the journey, the mood.
**Examples:**
- Agent refactoring auth → abstract illustration of locks, keys, flowing data streams
- Agent fixing bugs in a test suite → visual of gears being repaired, red→green transitions
- Agent exploring a new codebase → map/cartography aesthetic, uncharted territory being revealed
**Trigger:** Generated alongside each executive summary (or on manual refresh). Re-generates when the summary changes significantly.
**Input to image model:** The executive summary text + session metadata (dominant file types, categories of work, success/failure ratio) → Gemini generates an image prompt → Nano Banana generates the illustration.
**Display:** Small card (200×140px) in the Intel tab, above or beside the executive summary. Dark-themed, abstract, low-saturation to fit the HUD aesthetic. Clicking expands to full size.
**API:** Nano Banana image generation endpoint with style parameters tuned for dark, minimal, technical illustration.

---

## Shared Infrastructure

All features share:
- **GeminiService** — server-side singleton managing API calls, rate limiting, prompt construction
- **WebSocket message types** — `insight.summary`, `insight.intent`, `insight.notification`, etc.
- **Client InsightStore** — Zustand store for all LLM-generated insights
- **Caching** — avoid redundant calls when context hasn't changed meaningfully
- **Graceful degradation** — all features are no-ops without `GEMINI_API_KEY`
