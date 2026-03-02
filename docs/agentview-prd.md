# AgentView — Product Requirements Document

## The Visual IDE for AI-Powered Development

**Version:** 0.1 — Foundation
**Date:** February 2026
**Status:** Draft / Philosophy & Vision

---

## 1. The Problem

Software development with AI agents is fundamentally broken — not in capability, but in **interface**.

Today, when a developer instructs an AI agent (Claude Code, Cursor, Copilot Workspace, Devin, etc.) to build or modify software, the agent's activity is communicated as a **wall of text**. The terminal scrolls. The IDE flickers. Files open and close. Diffs appear. Log lines stream past. The developer is expected to *read all of this* and maintain a mental model of what the agent is doing, why, and what has changed.

**Nobody does this.** In practice, developers either:

1. **Tune out entirely** — let the agent run, check the result at the end, and hope it worked.
2. **Interrupt constantly** — stop the agent to inspect intermediate state because they've lost track of what's happening.
3. **Re-read everything** — scroll back through hundreds of lines of output to reconstruct the narrative of what happened.

All three patterns are symptoms of the same root cause: **the medium is wrong**. We are using a 1970s text terminal to observe a 2025 autonomous reasoning system. The information is all there — it's just presented in a format that the human brain cannot efficiently process.

### What humans actually need

When an AI agent is working on code, the developer needs to answer a small number of questions at any given moment:

- **Where is it?** — Which files, which part of the codebase, what scope of change?
- **What is it doing?** — Reading? Writing? Running? Thinking? Waiting?
- **What's the plan?** — What steps remain? Has the plan changed?
- **Is it working?** — Are tests passing? Are there errors? Is it stuck?
- **What changed?** — What's different now compared to before the agent started?

These are all fundamentally **visual, spatial, and structural** questions. Yet we answer them with linear text. AgentView exists to fix this.

---

## 2. Philosophy

### 2.1 Principle: Observe, Don't Read

The primary interaction mode during agent execution should be **observation, not reading**. A developer should be able to glance at the AgentView interface for 2 seconds and understand the agent's current state — the same way a pilot glances at instruments or a trader glances at a dashboard.

This means:

- **State is communicated through color, motion, position, and shape** — not through sentences.
- **Details are available on demand** — you can always drill down — but the default view is a compressed, visual summary.
- **The log still exists** — but it's not the primary interface. It's the "View Source" of the experience.

### 2.2 Principle: The Agent Operates in Space, Not in Time

Terminal output is temporal — it's a sequence of events ordered by when they happened. But a codebase is spatial — it's a graph of files, modules, functions, and dependencies that exist simultaneously.

AgentView represents agent activity **spatially**. The codebase is a map. The agent moves through it. Modified regions glow. The developer's mental model aligns with the visual model.

This doesn't mean we abandon the timeline — temporal views (what happened in what order) are a complementary perspective. But the *primary* frame is spatial.

### 2.3 Principle: Signal Over Noise

The vast majority of agent output is noise for the human observer. A `cd` command, a `cat` of a file the agent is reading, the full text of a file being written — these are implementation details of the agent's operation, not meaningful events for the developer.

AgentView aggressively compresses and categorizes agent activity into **meaningful signals**:

| Raw Agent Output | AgentView Signal |
|---|---|
| `cat src/auth/login.ts` (200 lines) | Read `login.ts` |
| `sed -i 's/old/new/g' config.js` | Modified `config.js` — 1 line changed |
| 3 paragraphs of LLM reasoning | Thinking — "evaluating auth flow options" |
| `npm test` + 400 lines of output | Tests passed (47/47) *or* 3 tests failed |
| `git diff` output | Changed 4 files, +87 / -23 lines |

The developer sees the signal. If they want the noise, they click to expand.

### 2.4 Principle: Trust but Verify, Visually

The goal is not to blindly trust the agent. The goal is to make **verification fast**. Today, verifying what an agent did requires reading diffs, re-running tests, and mentally reconstructing intent from output. AgentView makes verification visual and instant:

- Changes are grouped by intent, not by file.
- Before/after views are spatial and contextual.
- Test results are overlaid on the codebase map — you see which parts of the code are covered and passing.
- The agent's plan is visible, so you can verify whether it did what it said it would do.

### 2.5 Principle: Progressive Disclosure

Not every developer session is the same. Sometimes you want a high-level "let it run" mode. Sometimes you want to inspect every edit. AgentView supports a **zoom continuum**:

- **Level 0 — Ambient:** A small status indicator. "Agent is working. 73% through plan. No errors." Could be a menubar widget or a minimal floating panel.
- **Level 1 — Dashboard:** The codebase map + timeline + plan view. Understand the full picture in a glance. This is the default view.
- **Level 2 — Detailed:** Expand any action to see full context. Read the actual diff, the actual terminal output, the agent's full reasoning.
- **Level 3 — Raw:** The traditional terminal log. Everything the agent said and did, unfiltered.

The developer moves between levels fluidly. Most time is spent at Level 1.

### 2.6 Principle: The Developer Directs, the Agent Executes

AgentView is not just a display — it's an **interaction surface**. The visual representation of the codebase and agent activity provides natural points for developer intervention:

- Click a file on the map → "Focus on this file"
- Draw a boundary around a module → "Only modify within this scope"
- Click a failing test → "Fix this"
- Drag a plan step to reorder → Change the agent's execution order
- Pause on a specific action → "Show me what you're about to do before you do it"

The visual interface becomes a **control surface** for the agent, not just a monitor.

---

## 3. Architecture Comparison

We evaluated two fundamental approaches to building AgentView.

### 3.1 Option A: Visual Wrapper (Observer Pattern)

**Description:** AgentView sits alongside an existing agent (Claude Code, Cursor, etc.) and parses its output stream in real-time. The agent runs unmodified. AgentView intercepts tool calls, file operations, and reasoning output and translates them into visual components.

**Architecture:**
```
Developer <-> AgentView (visual layer) <-> Agent CLI (Claude Code, etc.)
                    |
            Parses stdout/stderr, tool calls,
            file system events, git diffs
```

**Strengths:**

- Works with any existing agent — Claude Code, Aider, Cursor background agents, Devin, etc.
- The agent doesn't need to change. No dependency on agent internals.
- Faster to build. The core problem (visualization) is isolated from the agent problem (reasoning + code generation).
- Users can adopt it incrementally — wrap their existing workflow.
- Lower risk. If visualization doesn't work for a use case, the underlying agent is unaffected.

**Weaknesses:**

- **Lossy translation.** The agent's output isn't designed for structured parsing. Extracting "what tool is being used" from raw terminal output is heuristic and fragile.
- **No bidirectional control.** Difficult to implement "click to direct the agent" interactions because the visual layer doesn't control the agent — it only observes.
- **Agent-specific parsers.** Each agent has different output formats. Supporting multiple agents requires per-agent adapters.
- **Reasoning is opaque.** Most agents don't expose structured reasoning. You can display "the agent is thinking" but not *what* it's thinking in a structured way.
- **Latency and sync issues.** The visual layer is always slightly behind the agent. File system watches and stdout parsing introduce lag.

**Best for:** A developer tool / companion app that enhances existing workflows. Ships faster. Proves the concept.

### 3.2 Option B: Visual-First Agent IDE (Integrated Pattern)

**Description:** AgentView is the IDE. The agent is built into the system with a protocol designed from the ground up to emit structured, visual-friendly events. Every tool call, every reasoning step, every file operation is a first-class event that the visual layer understands natively.

**Architecture:**
```
Developer <-> AgentView IDE
                 |
         Built-in Agent Runtime
         (structured event protocol)
                 |
         Tool calls, file ops, reasoning
         all emit typed visual events
```

**Strengths:**

- **Lossless.** Every agent action is a structured event. No parsing, no heuristics.
- **Bidirectional.** The developer can interact with the visual layer to direct the agent. Click a file, draw a scope boundary, reorder plan steps — these become first-class agent directives.
- **Richer visualizations.** Because the agent protocol includes semantic metadata (intent, confidence, plan state), the visual layer can show things that no wrapper could infer.
- **Consistent experience.** No per-agent adapters. The event protocol is the contract.
- **New interaction paradigms.** Spatial scoping ("only modify this module"), visual breakpoints ("pause before editing this file"), plan editing — these require tight integration.

**Weaknesses:**

- **Massive scope.** Building an IDE + an agent runtime + a visual layer is a multi-year project.
- **Agent lock-in.** Users must use the built-in agent. They can't bring their own.
- **Cold start problem.** The built-in agent needs to be competitive with Claude Code, Cursor, etc. on day one — otherwise the visual layer doesn't matter because no one will use the product.
- **Protocol design risk.** Designing the right event protocol upfront is hard. Get it wrong and the visual layer is limited by the protocol's assumptions.

**Best for:** A transformative new product category. The "what if we built the IDE from scratch for the agent era" bet.

### 3.3 Recommended Approach: Hybrid (Start A, Evolve to B)

We recommend starting with **Option A** (visual wrapper) with a critical addition: **define the structured event protocol from day one**, even though the initial implementation parses unstructured output into that protocol.

**Phase 1 — Observer (Months 1-4):**
Build the visual layer as a wrapper around Claude Code. Write a parser that translates Claude Code's output into structured AgentView events. Validate the visual concepts with real users. The event protocol stabilizes based on real usage.

**Phase 2 — Hybrid (Months 5-8):**
Introduce a lightweight "AgentView protocol" that agents can optionally emit. Work with Claude Code's MCP / tool-use layer to get structured events directly. The parser remains as a fallback for non-compliant agents. Begin adding bidirectional control (pause, redirect, scope).

**Phase 3 — Integrated (Months 9+):**
If the visual paradigm proves transformative, build or integrate a native agent runtime that speaks the AgentView protocol natively. The visual layer reaches its full potential with lossless, bidirectional, semantic-aware visualization.

This approach lets us **ship fast, learn fast, and build toward the vision** without betting the entire product on getting the protocol right upfront.

---

## 4. User Experience — The Coding Session

This section walks through what it *feels like* to use AgentView. This is the heart of the product.

### 4.1 Starting a Task

The developer opens AgentView. They see their project's **codebase map** — a spatial, zoomable visualization of the project structure. Files are nodes, directories are clusters, imports and dependencies are faint lines connecting nodes. The map is not a file tree — it's a topology. Related files are near each other. Heavily-imported files are larger. Recently modified files are subtly highlighted.

At the bottom, there's a **prompt bar** — similar to what exists today in Claude Code or Cursor. The developer types:

> "Add rate limiting to the API endpoints. Use Redis for the token bucket. Include tests."

They press Enter.

### 4.2 The Plan Appears

Before the agent starts executing, a **Plan Panel** slides in from the right. It shows:

```
+--------------------------------------+
|  PLAN                          * Live|
|                                      |
|  1. [ ] Analyze existing API routes  |
|  2. [ ] Install rate-limit deps      |
|  3. [ ] Create rate limiter middleware|
|  4. [ ] Apply middleware to routes    |
|  5. [ ] Add Redis connection config   |
|  6. [ ] Write integration tests       |
|  7. [ ] Run tests and verify          |
|                                      |
|  Est. ~3 min                         |
+--------------------------------------+
```

This plan is a living artifact. Steps will be checked off. New steps may be inserted. If the agent backtracks, the developer will see it visually.

### 4.3 The Agent Works — Dashboard View

The agent begins executing. Here's what the developer sees at **Level 1 (Dashboard)**:

**Codebase Map (center):** Several files in the `src/api/` cluster start to glow with a soft blue pulse — the agent is reading them. The developer can see *which part* of the codebase is being analyzed without reading any output. After a moment, the blue fades and `src/middleware/` begins to glow orange — the agent is creating new files there.

**Activity Timeline (bottom):** A horizontal strip shows discrete action blocks flowing left to right:

```
[Read routes.ts] [Read auth.ts] [Planning middleware] [Install redis] [Create rateLimiter.ts] ...
```

Each block is colored by type (blue for reads, orange for writes, purple for thinking, green for shell commands). The current action is larger and animated. Completed actions shrink into a compact trail.

**Plan Panel (right):** Step 1 is checked. Step 2 is in progress (highlighted). The developer can see progress at a glance.

**Status Bar (top):** A single line: `Working — Step 2/7 — Installing dependencies — No errors`

The developer glances at this for 2 seconds and knows everything they need to know. They go back to their coffee. Or their Slack. Or they watch with curiosity as the codebase map lights up.

### 4.4 Something Goes Wrong

The agent runs `npm test` and 2 tests fail. Here's what happens visually:

- The **Status Bar** flashes amber: `2 tests failed — Step 7/7`
- On the **Codebase Map**, the test file and the two files containing the failing code pulse red.
- On the **Timeline**, the test action block turns red and expands slightly to show: `2/15 failed: "rate limit should reset after window" and "rate limit should return 429"`
- The **Plan Panel** updates — a new step 8 appears: `8. [ ] Fix failing tests` — the agent is self-correcting.

The developer can:
- **Do nothing** — let the agent self-correct (the default).
- **Click the red test block** to see the full test output.
- **Click the red file on the map** to see the exact code the agent wrote that's failing.
- **Type a correction** — "The rate limit window should be configurable, not hardcoded."

### 4.5 Reviewing Changes — The Changeset View

The agent finishes. The plan is complete (all green checks). The developer switches to the **Changeset View**.

Instead of `git diff`, they see a **visual changeset** organized by intent:

```
+--------------------------------------------------+
|  CHANGESET — "Add rate limiting to API endpoints" |
|                                                   |
|  New Dependencies                                 |
|  -- redis@4.6.0, express-rate-limit@7.1.0        |
|                                                   |
|  New Files (2)                                    |
|  -- src/middleware/rateLimiter.ts    [+67 lines]   |
|  -- src/config/redis.ts             [+23 lines]   |
|                                                   |
|  Modified Files (3)                               |
|  -- src/api/routes.ts        [+4 lines, -1 line]  |
|  -- src/config/index.ts      [+8 lines]           |
|  -- package.json             [+2 deps]            |
|                                                   |
|  Tests                                            |
|  -- tests/rateLimit.test.ts         [+89 lines]   |
|     15/15 passing                                 |
|                                                   |
|  [Accept All]  [Review Each]  [Revert]            |
+--------------------------------------------------+
```

Click any file to see a contextual diff — not raw `+/-` lines, but a side-by-side view highlighting the meaningful change within the context of surrounding code.

### 4.6 The "Ambient" Mode

For long-running tasks, the developer minimizes AgentView to a **floating widget**:

```
+-----------------------------+
|  AgentView — Rate Limit     |
|  Step 5/7 - 2 files changed |
|  ========-- 71%  - No errors|
+-----------------------------+
```

This widget is always visible — on top of VS Code, in the menubar, or as a mobile notification if the agent is running remotely. The developer can expand back to full dashboard at any time.

---

## 5. Core Components

### 5.1 Codebase Map

A spatial, zoomable, interactive representation of the project.

- **Layout engine:** Force-directed graph with directory-based clustering. Files that import each other are pulled closer. Directories form visual groups.
- **Visual encoding:** File size maps to node size. File type maps to node shape/color. Modification recency maps to glow intensity. Agent activity maps to animated pulse.
- **Zoom levels:** Project overview (clusters of directories) → Directory view (individual files) → File view (functions/classes within a file).
- **Interaction:** Click to inspect, right-click to scope ("only modify within this boundary"), hover for metadata.

### 5.2 Activity Timeline

A horizontal, scrollable timeline of agent actions.

- **Action types:** Read, Write, Create, Delete, Shell Command, Think, Plan, Test, Error.
- **Visual encoding:** Type maps to color. Duration maps to block width. Status maps to icon overlay. Importance maps to block height.
- **Interaction:** Click to expand details. Drag to scrub through history. Filter by type.
- **Grouping:** Related actions auto-group (e.g., "read 5 files" becomes a single expandable block).

### 5.3 Plan Panel

A structured, live-updating view of the agent's execution plan.

- **Live updates:** Steps check off as completed. New steps appear if the agent adapts. Removed steps are struck through.
- **Interaction:** Reorder steps (drag). Skip steps (right-click). Add steps (type). Pause before a step (toggle breakpoint).
- **History:** Plan diffs — what the plan was originally vs. what it became.

### 5.4 Changeset View

An intent-organized view of all changes made by the agent.

- **Organization:** By semantic group (new feature, config changes, tests, dependencies), not by file.
- **Diff rendering:** Side-by-side, syntax-highlighted, with only the meaningful change area shown (not the entire file).
- **Actions:** Accept, reject, or edit individual changes. Accept all. Revert all.
- **Integration:** Direct "commit" button with auto-generated commit message based on the changeset narrative.

### 5.5 Status and Ambient Display

Compressed views for passive monitoring.

- **Status bar:** One-line summary (current step, error count, progress).
- **Floating widget:** Minimal overlay with progress, step count, error indicator.
- **Notifications:** Desktop/mobile alerts on completion, errors, or agent questions.

---

## 6. Event Protocol (AgentView Protocol — AVP)

The bridge between agent activity and visual representation. Even in Phase 1 (wrapper), we parse agent output into these events internally.

### 6.1 Event Categories

| Category | Events | Visual Target |
|---|---|---|
| **Navigation** | `file.read`, `file.open`, `search.grep`, `search.semantic` | Codebase Map (blue glow) |
| **Mutation** | `file.create`, `file.edit`, `file.delete`, `dependency.add` | Codebase Map (orange glow), Changeset |
| **Execution** | `shell.run`, `shell.output`, `shell.exit` | Timeline (green block) |
| **Reasoning** | `think.start`, `think.summary`, `plan.create`, `plan.update` | Plan Panel, Timeline (purple block) |
| **Testing** | `test.run`, `test.pass`, `test.fail`, `test.summary` | Codebase Map (red/green), Timeline |
| **Control** | `task.start`, `task.complete`, `task.error`, `agent.pause`, `agent.resume` | Status Bar, Ambient |

### 6.2 Event Structure

```json
{
  "id": "evt_abc123",
  "timestamp": "2026-02-16T14:23:07Z",
  "category": "mutation",
  "type": "file.edit",
  "data": {
    "path": "src/middleware/rateLimiter.ts",
    "summary": "Added sliding window rate limit logic",
    "diff": { "additions": 12, "deletions": 3 },
    "plan_step": 3
  },
  "metadata": {
    "confidence": 0.92,
    "reasoning_snippet": "Using sliding window instead of fixed window for smoother rate limiting"
  }
}
```

---

## 7. Technical Approach (Phase 1)

### 7.1 Platform

**Desktop app (Tauri 2.0):** Native performance, small binary, Rust backend for file system watching and process management. Web frontend (React) for the visual layer.

**Why Tauri over Electron:** Smaller footprint (~10MB vs ~150MB). Better performance for real-time visualization. Rust backend handles file system events and process management without Node.js overhead.

**Why not web-only:** Needs deep OS integration — process spawning, file system watching, floating windows, system tray, global hotkeys.

**Why not terminal TUI:** The core thesis is that text is the wrong medium. A TUI is a better text interface, but still text.

### 7.2 Frontend Stack

- **React + TypeScript** — Component architecture for the visual panels.
- **Canvas / WebGL (via Pixi.js or Three.js)** — For the codebase map. DOM-based rendering won't scale for large projects.
- **Framer Motion** — For timeline animations and transitions.
- **Zustand** — State management for real-time event streams.

### 7.3 Backend Stack (Tauri/Rust)

- **Process manager** — Spawns and manages the agent CLI process (e.g., Claude Code). Captures stdout/stderr.
- **Parser engine** — Translates raw agent output into AVP events. Initially Claude Code-specific, designed for pluggable adapters.
- **File system watcher** — Monitors the project directory for changes (via `notify` crate). Correlates file changes with agent actions.
- **Git integration** — Tracks diffs, generates changesets, manages staging.

### 7.4 Rendering Pipeline

```
Agent stdout -> Parser -> AVP Events -> Event Store -> React State -> Visual Components
File system  -> Watcher -> -----------/
Git          -> Diff engine -> -------/
```

All events flow into a single **Event Store** (append-only log). Visual components subscribe to the store and render based on current state. This allows rewinding, replaying, and filtering without re-parsing.

---

## 8. Success Metrics

### 8.1 North Star Metric

**Glance-to-understanding time:** How many seconds does it take a developer to understand what the agent is doing and whether it's on track?

Target: **Under 3 seconds** (down from 30-60 seconds of reading terminal output).

### 8.2 Supporting Metrics

| Metric | Current (Terminal) | Target (AgentView) |
|---|---|---|
| Time to detect agent error | 30-120s (if noticed at all) | Under 5s (visual alert) |
| Time to review changeset | 5-15 min (reading diffs) | 1-3 min (visual changeset) |
| Agent task completion rate | ~60% (developer abandons) | ~80% (better monitoring = better intervention) |
| Developer intervention precision | Low (interrupts based on anxiety) | High (interrupts based on information) |
| Developer focus time preserved | Low (constant context-switching to terminal) | High (ambient monitoring) |

### 8.3 Qualitative Goals

- Developers describe the experience as "watching" the agent work, not "reading" what it did.
- Developers feel confident letting the agent run longer without interrupting.
- Reviewing agent changes feels like reviewing a pull request from a colleague, not deciphering a machine log.

---

## 9. What This Is Not

- **Not a code editor.** AgentView does not replace VS Code or Neovim. It sits alongside your editor (or wraps it in later phases). You write the prompt. The agent writes the code. AgentView shows you what the agent is doing.
- **Not an AI agent.** AgentView does not generate code. It visualizes and controls agents that do. In Phase 1, the agent is Claude Code. In later phases, it could be any agent that speaks AVP.
- **Not a terminal replacement for humans.** When *you* are typing commands, a terminal is fine. AgentView is specifically for when an *autonomous agent* is doing the work and you need to observe.
- **Not a dashboard for non-developers.** The audience is developers who are actively coding with AI agents. The visualizations assume familiarity with code, diffs, tests, and project structure.

---

## 10. Open Questions

1. **Multi-agent coordination.** If multiple agents are working on different parts of the codebase simultaneously, how does the visualization handle this? Multiple colors? Split views? This is a Phase 3 concern but the protocol should support it from day one.

2. **Remote agents.** If the agent is running on a remote server (Devin, Codespaces), how does file system watching work? We likely need a thin daemon on the remote machine that streams events.

3. **Codebase map scalability.** For monorepos with 10,000+ files, the map needs aggressive clustering and level-of-detail rendering. This is a known hard problem in graph visualization.

4. **Agent protocol adoption.** For Phase 2+, we need agents to emit structured events. This requires either vendor partnerships or community protocol adoption. MCP (Model Context Protocol) may be a foundation.

5. **Collaborative use.** Can two developers watch the same agent session? Can one developer's annotations (scope boundaries, breakpoints) be shared? This maps to multiplayer infrastructure.

---

*AgentView: Stop reading what the agent did. Start seeing what the agent is doing.*
