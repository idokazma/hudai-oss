# Hudai

A command center for AI code agents. See what your agent is doing, why, and steer it — without reading a wall of terminal text.

## The Problem

When an AI agent works on your codebase, you're staring at a scrolling terminal. You can't tell at a glance whether it's stuck, burning tokens on the wrong approach, or about to delete something it shouldn't. Step away for five minutes and you've lost the thread entirely.

Hudai gives you the kind of situational awareness that strategy games give commanders — a minimap, unit status, resource counters, a build queue — applied to your AI coding session.

## Design Philosophy

"Observe, don't read." You should understand the state of your agent through color, motion, and position — not by parsing sentences. Hudai borrows from real-time strategy games: the minimap shows where action is happening, the resource bar tells you if you're winning or bleeding out, and the build queue shows what's coming next. Glance-to-understanding time should be under three seconds.

## What You See

**Resource bar** — context window usage, cost, test pass rate, always visible at the top. Session health without asking.

**Activity timeline** — every agent action as a colored block. File reads are blue, writes are amber, tool calls green, thinking purple. Scroll back to see the full history.

**Codebase map** — force-directed graph of your project files. Nodes glow as the agent reads or edits them. See which parts of the codebase are getting attention and which are untouched.

**Pipeline view** — the agent's current plan rendered as sequential stages. Watch steps complete in real time.

**Live terminal** — full pass-through of the agent's tmux session. Type directly into the input bar to talk to the agent.

**Advisor chat** — a second AI watches the agent's work and answers your questions without interrupting the agent.

## How You Steer

**Approve / reject** permission prompts inline. **Pause** the agent, **redirect** its focus, **send** text — all without leaving the HUD.

**Config inspector** — click any skill, agent, or permission rule to inspect it. See file contents, toggle items on or off, right-click for quick actions.

## How It Works

Hudai connects to an already-running Claude Code session via **tmux** — it doesn't spawn a new process.

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

### Architecture

```
packages/
├── shared/    # TypeScript types (AVP events, commands, config)
├── server/    # Fastify + WebSocket + tmux integration + SQLite
└── client/    # React + Vite + Zustand + Pixi.js
```

Monorepo managed with npm workspaces + turborepo.

## Quick Start

**Prerequisites:** Node.js 20+, tmux (Claude Code must be running inside a tmux session)

```bash
npm install
npm run build:shared       # Build shared types first
npm run dev:server         # Backend — localhost:4200
npm run dev:client         # Frontend — localhost:4201
```

## Telegram Bot

Optional remote control via Telegram. Monitor status, approve prompts, and steer the agent from your phone.

```bash
export TELEGRAM_BOT_TOKEN=<your-bot-token>
npm run dev:telegram
```

Send `/start` to register, `/help` for commands.

## License

Private.
