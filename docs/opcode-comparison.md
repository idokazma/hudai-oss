# Hudai vs Opcode: Architectural Comparison

Opcode ([winfunc/opcode](https://github.com/winfunc/opcode)) is an open-source Tauri desktop app that wraps Claude Code with a GUI. Both projects solve the same core problem — giving developers visual control over Claude Code — but take fundamentally different architectural approaches.

---

## TL;DR

| Dimension | Hudai | Opcode |
|---|---|---|
| **Philosophy** | Non-invasive observer (RTS HUD) | Full wrapper (IDE-like shell) |
| **Runtime** | Web app (Fastify + React) | Desktop app (Tauri 2 / Rust + React) |
| **Process model** | Attaches to existing tmux session | Spawns new Claude Code subprocess |
| **Output capture** | `tmux capture-pane` polling + anchor diff | `stdout/stderr` pipes via `tokio::process` |
| **Output format** | Parses rendered terminal output (⏺ symbols) | Consumes `--output-format stream-json` (JSONL) |
| **Steering** | `tmux send-keys` (approve/reject/prompt) | Queued prompts + process kill |
| **Session model** | One active session, replay via SQLite | Multi-tab, resume/continue via CLI flags |
| **Visualization** | Spatial codebase map (Pixi.js), movement trail | Chat transcript (virtual scrolling) |
| **Event system** | Rich AVP protocol (30+ event types) | Raw JSONL passthrough from Claude |
| **Persistence** | SQLite (events + sessions) | SQLite (agents, runs, usage, checkpoints) |
| **Unique features** | Spatial map, anchor-diff, plan inference | Custom agents, checkpoints/timeline, usage dashboard, MCP manager |

---

## 1. Core Philosophy

**Hudai** is a **non-invasive monitor**. It attaches to an already-running Claude Code session via tmux and observes it — like a commander's HUD overlaid on an RTS game. Claude Code keeps running in its terminal; Hudai never owns the process. The design goal is "glance-to-understanding in < 3 seconds" through spatial, visual information density.

**Opcode** is a **full replacement shell**. It spawns Claude Code as a child process, owns its lifecycle, and renders the conversation as a chat UI. The user never sees the raw terminal. The design goal is a polished IDE-like experience with tabs, settings panels, and agent management.

---

## 2. Session Monitoring

### How they read Claude Code output

**Hudai — tmux capture-pane polling:**
- Polls `tmux capture-pane -t <target> -p -e -S -500` every 300ms
- Uses **anchor-based diffing**: finds the last non-empty line from previous capture, extracts only new lines since that anchor
- Feeds raw terminal text into `ClaudeCodeParser`, which regex-matches Claude Code's rendered symbols (`⏺ Read(...)`, `❯ prompt`, spinners, permission blocks)
- Produces structured AVP events (30+ types: `file.read`, `file.edit`, `shell.run`, `think.start`, `plan.update`, `permission.prompt`, etc.)

**Opcode — stream-json pipes:**
- Spawns Claude Code with `--output-format stream-json` flag
- Captures `stdout`/`stderr` via `tokio::process::Command` pipes and `BufReader`
- Reads JSONL lines directly — no parsing of terminal rendering needed
- Extracts session ID from the init message, then routes output to session-specific Tauri event channels (`claude-output:{sessionId}`)

**Key difference**: Hudai reverse-engineers the terminal UI; Opcode uses Claude Code's structured JSON output. Opcode's approach is simpler and more reliable (no regex fragility), but requires owning the process. Hudai's approach works with any already-running session without modification.

### How they detect session state

**Hudai**: Infers state from parsed events — idle detection from prompt symbols, running from tool activity, paused from interrupt response. Tracks `contextPercent`, `tokensPercent`, `testHealth` as derived metrics.

**Opcode**: Reads process status directly (running/exited) via `try_wait()`. Tracks token counts, costs, and model from JSONL metadata. Completion events (`claude-complete:{sessionId}`) fire when the process exits.

---

## 3. Session Navigation

**Hudai — Single session + replay:**
- One active live session at a time (attached to a tmux pane)
- `PaneSelector` lists available tmux panes for attachment
- **Replay mode**: past sessions are stored in SQLite; user can scrub through the event timeline with decision-level granularity
- Events are replayed from the database, not re-captured

**Opcode — Multi-tab with resume/continue/fork:**
- Full tab manager supporting multiple concurrent sessions
- Each tab can be a chat session, agent run, settings panel, MCP config, or usage dashboard
- Sessions support three modes: **new** (`-p` flag), **continue** (`-c` flag), **resume** (`--resume` flag)
- **Checkpoint timeline**: create snapshots at any point, fork from any checkpoint to create branching timelines
- Sessions are paginated in a grid (12 per page) with search

**Key difference**: Opcode's multi-tab model is more familiar (browser/IDE pattern). Hudai's single-session model is intentional — it's a HUD, not an IDE. Hudai compensates with rich replay. Opcode's checkpoint/fork system is a standout feature with no Hudai equivalent.

---

## 4. Steering & Control

### Sending input to Claude Code

**Hudai — tmux send-keys:**
- All commands are translated to tmux keystrokes by `CommandHandler`
- `prompt` → `send-keys -l 'text'` + `send-keys Enter`
- `approve` → `send-keys -l 'y'` + `send-keys Enter`
- `reject` → `send-keys -l 'n'` + `send-keys Enter`
- `pause` → `send-keys Escape`
- `focus_file` → sends a natural language directive ("Please focus on file...")
- `scope_boundary` → sends a text boundary constraint
- Supports raw `send_keys` for arbitrary key combinations
- Works because Claude Code is a real terminal session — Hudai types into it

**Opcode — prompt queue + process signals:**
- User types prompts in a `FloatingPromptInput`; if Claude is busy, prompts queue and execute sequentially
- Cancel = `kill_process()` with SIGTERM → SIGKILL fallback
- No equivalent of approve/reject buttons (the user doesn't see raw permission prompts — Claude runs with `--output-format stream-json` which may handle permissions differently)
- No spatial steering (no `focus_file`, `scope_boundary`)

**Key difference**: Hudai's steering is richer — spatial commands, approve/reject for permissions, raw key input. Opcode's model is simpler: type a prompt, or kill the process. Hudai can interrupt and steer mid-execution; Opcode's primary mid-execution control is cancellation.

---

## 5. Visualization & UI

**Hudai — Spatial RTS HUD:**
- CSS Grid layout: left panel (build queue/plan), center (codebase map via Pixi.js), right panel (command bar + live terminal), bottom (xterm.js terminal)
- **Codebase map**: Pixi.js canvas showing the project file tree as a spatial graph with agent movement trail
- **Build queue**: inferred or explicit task list (from TodoWrite/plan events)
- **Resource bar**: session health metrics (context%, tokens%, test health)
- **Live terminal**: xterm.js rendering of raw tmux output
- Dark theme only (#0a0e17). Design principle: "observe, don't read"

**Opcode — Chat-based IDE shell:**
- Tab manager with multiple concurrent panels
- **Session view**: virtual-scrolled chat transcript (messages, tool calls, results) with markdown rendering
- **Split pane**: optional preview window alongside chat
- **Sidebar navigation**: projects, agents, MCP, settings, usage
- **Floating input**: bottom prompt bar with model selector and queue indicator
- **Timeline sidebar**: checkpoint history with fork/restore
- Standard light/dark themes via Tailwind/shadcn

**Key difference**: Hudai prioritizes information density and spatial awareness — you see where the agent is in the codebase, what it's doing, and its health at a glance. Opcode prioritizes conversational clarity — you read the full message stream like a chat. Neither approach is wrong; they serve different operator styles.

---

## 6. Custom Agents

**Hudai**: No custom agent system. Hudai observes whatever Claude Code session is running — it's agent-agnostic.

**Opcode**: Full agent creation and management:
- Create agents with custom system prompts, model selection, icon, name
- Per-agent permissions: file read/write, network access toggles
- Hooks integration (writes `.claude/settings.json` before execution)
- Import/export agents as `.opcode.json` files
- Import from GitHub repositories
- Execution history with token/cost metrics per run
- Agent library displayed as a 3x3 card grid

This is Opcode's most distinctive feature — it turns Claude Code into a configurable agent platform.

---

## 7. Checkpoints & Timeline

**Hudai**: Has **replay mode** — events are persisted in SQLite and can be scrubbed through with decision-level granularity. But this is read-only playback, not versioning.

**Opcode**: Full **checkpoint system** with file-level snapshots:
- Content-addressable storage (SHA-256 hashed file deduplication)
- `FileTracker` monitors file modifications between checkpoints
- Auto-checkpoint strategies: `Manual`, `PerPrompt`, `PerToolUse`, `Smart` (after destructive ops)
- Fork from any checkpoint → creates a new timeline branch
- Diff viewer between checkpoints
- Restore to any previous state

This is a significant capability — essentially version control for agent sessions, independent of git.

---

## 8. Usage Analytics

**Hudai**: Tracks `contextPercent`, `tokensPercent`, `testHealth` as live metrics in the resource bar. No historical cost tracking.

**Opcode**: Full analytics dashboard:
- Total cost, sessions, tokens, average cost/session
- Breakdowns by model, project, session, and timeline (daily bar charts)
- Token type segmentation (input, output, cache write, cache read)
- 10-minute data caching, lazy-loaded tabs, pagination

---

## 9. MCP Server Management

**Hudai**: No MCP integration.

**Opcode**: Built-in MCP (Model Context Protocol) manager:
- Server registry with UI-based configuration
- Connection testing
- Import from Claude Desktop configs
- Add/remove servers through GUI

---

## 10. Tech Stack Comparison

| Layer | Hudai | Opcode |
|---|---|---|
| Frontend framework | React 19 + Vite 6 | React 18 + Vite 6 |
| State management | Zustand 5 | Zustand + React Context |
| Visualization | Pixi.js 8, xterm.js | @tanstack/react-virtual, Framer Motion |
| Backend runtime | Node.js (Fastify 5) | Rust (Tauri 2) |
| Process integration | tmux (capture-pane + send-keys) | tokio::process (spawn + pipes) |
| Real-time transport | WebSocket (@fastify/websocket) | Tauri event system (IPC) |
| Database | better-sqlite3 | rusqlite |
| Deployment | Web app (any browser) | Desktop app (macOS/Windows/Linux) |
| Package management | npm workspaces + turborepo | Bun |
| Monorepo | 3 packages (shared/server/client) | 2 directories (src + src-tauri) |

---

## 11. Architecture Diagrams

### Hudai Data Flow
```
tmux capture-pane (300ms poll)
    → anchor-based diff (new lines only)
    → ClaudeCodeParser (regex → AVP events)
    → SQLite persist + WebSocket broadcast
    → Zustand stores → React components
```

### Opcode Data Flow
```
tokio::process::Command (spawn claude --output-format stream-json)
    → BufReader on stdout pipe
    → JSONL parse → Tauri event emit
    → React event listener → state update → virtual scroll render
```

---

## 12. What Hudai Could Learn From Opcode

1. **Checkpoint/timeline system** — session-level version control with fork/restore is compelling for long-running agent tasks
2. **Custom agent presets** — reusable agent configurations with system prompts and permission profiles
3. **Usage analytics** — historical cost tracking by model/project/session
4. **Multi-session tabs** — ability to monitor multiple sessions simultaneously
5. **MCP management UI** — visual configuration of Model Context Protocol servers
6. **Structured output** — using `--output-format stream-json` where possible would reduce parser fragility

## What Opcode Lacks That Hudai Has

1. **Spatial visualization** — no codebase map, no movement trail, no spatial awareness of agent activity
2. **Non-invasive monitoring** — can't attach to an existing session; must own the process
3. **Rich event protocol** — no structured event taxonomy; raw JSONL passthrough without semantic categorization
4. **Spatial steering** — no `focus_file`, `scope_boundary`, or other spatial commands
5. **Permission handling** — no approve/reject flow for tool permissions
6. **Plan inference** — no automatic detection of inline plans, numbered lists, or TodoWrite output
7. **Information density** — chat UI requires reading; Hudai's HUD communicates through color, motion, and position
8. **Sub-agent tracking** — no hierarchical agent/sub-agent event tracking with depth awareness
