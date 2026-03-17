# Hudai

A command center for AI code agents. See what your agent is doing, why, and steer it — without reading a wall of terminal text.

**[hudai-landing-production.up.railway.app](https://hudai-landing-production.up.railway.app)**

## The Problem

When an AI agent works on your codebase, you're staring at a scrolling terminal. You can't tell at a glance whether it's stuck, burning tokens on the wrong approach, or about to delete something it shouldn't. Step away for five minutes and you've lost the thread entirely.

Hudai gives you the kind of situational awareness that strategy games give commanders — a minimap, unit status, resource counters, a build queue — applied to your AI coding session.

## Quick Start

**Prerequisites:** Node.js 20+, tmux (Claude Code must be running inside a tmux session)

```bash
npm install && npm run build:shared && npm run dev:server
```

Opens on **http://localhost:4200**. Select your tmux session from the dropdown.

For separate frontend dev server (hot reload on :4201):

```bash
npm run dev:client
```

## Design Philosophy

"Observe, don't read." You should understand the state of your agent through color, motion, and position — not by parsing sentences. Hudai borrows from real-time strategy games: the minimap shows where action is happening, the resource bar tells you if you're winning or bleeding out, and the build queue shows what's coming next. Glance-to-understanding time should be under three seconds.

## What You See

### Density Layout (default)

Two viewing modes — switch with a single click:

**Glance mode** — full-screen status overview. A radial task ring, metric pills (tokens, cost, files touched), service health dots, and an advisor chat — everything you need in one screen without any panels to manage.

**Work mode** — a configurable grid layout with toggleable panels:

- **Codebase map** — force-directed graph of your project files. Nodes glow as the agent reads or edits them.
- **Pipeline view** — the agent's current plan rendered as sequential stages. Watch steps complete in real time.
- **Plan panel** — detected plans (from `ExitPlanMode`, numbered steps, or `.claude/plans/` files) shown as a checklist with live progress.
- **Thread cards** — each user request becomes a visual card showing prompt, phase (investigating/implementing/testing/done), LLM-generated summary and bullet points, files touched, and outcome. Double-click to open the full detail view with code map and action timeline.
- **Live terminal** — full pass-through of the agent's session. Type directly into the input bar to talk to the agent.
- **Advisor chat** — a second AI watches the agent's work and answers your questions with markdown-rendered responses, without interrupting the agent.
- **Browser preview** — click a URL in the terminal to open an embedded preview with an optional DOM inspector.
- **Service indicators** — live status dots for LLM, Telegram, and Library services. Click to toggle.

Keyboard shortcuts: **P** (plan panel), **S** (sidebar), **T** (terminal), **W** (browser preview). All panels are resizable and collapsible.

### Mobile Layout

A touch-native interface with four bottom tabs (Pulse, View, Terminal, Controls), swipe navigation, and PWA support. Access via `?layout=mobile` or automatically on small screens.

### Legacy Layout

The original classic layout is available at `?layout=legacy`.

## How You Steer

**Approve / reject** permission prompts inline — shown in the advisor chat when the sidebar is open, or in the terminal footer when it isn't. Resolved prompts collapse to a compact log entry.

**Pause** the agent, **redirect** its focus, **send** text — all without leaving the HUD.

**Config inspector** — slide-over panel to inspect skills, agents, and permission rules. Toggle items on or off, see file contents, manage presets.

## How It Works

Hudai supports two backend modes:

### tmux mode (attach to existing session)

Connects to an already-running Claude Code instance via tmux — it doesn't spawn a new process.

```
tmux capture-pane (500ms polling)
  → anchor-based diff
  → parser (recognizes Claude Code's rendered format)
  → AVP events
  → SQLite + WebSocket
  → Zustand stores
  → React UI
```

Steering flows the other direction: UI interactions become `tmux send-keys` commands.

Activity detection uses Claude Code **hooks** when available (permission prompts, idle prompts, elicitation dialogs), falling back to pane content analysis.

### Stream mode (spawn subprocess)

Launches Claude Code as a subprocess with `--print --output-format stream-json`. Reads structured JSON events directly from stdout — no tmux required. Supports the same steering commands through process control.

### Architecture

```
packages/
├── shared/         # @hudai/shared — TypeScript types (AVP events, commands, config)
├── server/         # @hudai/server — Fastify + WebSocket + tmux/stream + SQLite
├── client/         # @hudai/client — React + Vite + Zustand
└── telegram-bot/   # @hudai/telegram-bot — Optional Telegram remote control
```

Monorepo managed with npm workspaces + turborepo.

### Key Server Modules

- **Agent process** — tmux attach/detach, capture-pane polling, send-keys, anchor-based diff
- **Agent host** — stream-mode subprocess management, JSON event parsing
- **Parser** — translates Claude Code's rendered terminal format into AVP events
- **JSONL parser** — extracts events from Claude Code transcript files (plan detection, tool use)
- **Hooks handler** — maps Claude Code hook notifications to activity states
- **Insight engine** — LLM-powered intent tracking, proactive notifications on loops/failures
- **Thread summarizer** — groups agent work into threads, generates LLM summaries, caches in SQLite
- **Library builder** — analyzes codebase structure, generates file cards and module shelves
- **Swarm registry** — tracks multiple concurrent agent sessions
- **Pipeline analyzer** — builds dependency graphs and pipeline visualizations

## Telegram Bot

Optional remote control via Telegram. Monitor status, approve prompts, spawn agents, and steer from your phone.

```bash
export TELEGRAM_BOT_TOKEN=<your-bot-token>
npm run dev:telegram
```

Send `/start` to register, `/help` for commands.

## Advisor

An LLM-powered assistant that watches your agent's work in real time. It provides:

- **Intent tracking** — summarizes what the agent is trying to do and why
- **Proactive alerts** — flags loops, repeated failures, and significant events
- **Q&A** — ask questions about the session without interrupting the agent

Configure verbosity (quiet / normal / verbose) and scope (session / global) from the settings panel. Custom system prompts are supported.

Requires an API key (Gemini, OpenAI, or Claude) — configure in the settings slide-over.

## License

MIT
