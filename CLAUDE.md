# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Hudai** (also referred to as AgentView / Commander's View) is a visual web app for monitoring and steering AI-powered code agents. It wraps Claude Code's terminal output and translates it into a spatial, real-time visual interface inspired by RTS game HUDs.

## Commands

```bash
npm install                # Install all workspace dependencies
npm run build:shared       # Build shared types (must run before server/client)
npm run dev:server         # Start backend on localhost:4200
npm run dev:client         # Start frontend on localhost:4201 (proxies /ws to server)
npm run build              # Build all packages via turborepo
```

## Monorepo Structure

```
packages/
├── shared/    # @hudai/shared — TypeScript types only (AVP events, commands, graph types)
├── server/    # @hudai/server — Node.js backend (Fastify + WebSocket + node-pty)
└── client/    # @hudai/client — React frontend (Vite + Pixi.js + Zustand)
```

- **npm workspaces** + **turborepo** for monorepo management
- Shared types are imported as `@hudai/shared` — build shared first after type changes

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite 6, Zustand 5 (state), Pixi.js 8 (planned for codebase map)
- **Backend:** Fastify 5, WebSocket (@fastify/websocket), tmux integration (capture-pane + send-keys), better-sqlite3 (event persistence)
- **Shared:** Pure TypeScript types, zero runtime deps

## Architecture

### tmux Integration (not node-pty)
Hudai connects to an **already-running** Claude Code instance via tmux — it does NOT spawn a new process.
- **Reading:** Polls `tmux capture-pane` every 500ms, uses anchor-based diffing to detect new lines
- **Writing:** `tmux send-keys` to type text + Enter into the pane
- **PATH note:** `findBinary('tmux')` resolves via `zsh -lc "which tmux"` because `/bin/sh` lacks homebrew PATH

### Data Flow
```
tmux capture-pane (polling) → anchor-based diff → ClaudeCodeParser → AVP Events → SQLite + WebSocket → Zustand stores → React
```

### Steering Flow
```
Frontend interaction → WebSocket → CommandHandler → tmux send-keys
```

Commands: `focus_file`, `scope_boundary`, `prompt` (text input), `pause` (Ctrl+C), `resume`, `cancel`, `approve` (y+Enter), `reject` (n+Enter)

### Data Directory (`~/.hudai/`)
All Hudai-generated data lives in `~/.hudai/`, never inside target projects:
```
~/.hudai/
  hudai.db                          ← single global SQLite DB (sessions + events)
  projects/
    <12-char-sha256>/               ← hash of project root path
      pipeline-cache.json
      project.json                  ← { rootPath, createdAt } breadcrumb
```
Paths are resolved by `src/persistence/data-dir.ts` (`hudaiHome()`, `projectDir()`, `dbPath()`).

### Key Server Modules
- `src/pty/agent-process.ts` — tmux attach/detach, capture-pane polling, send-keys, anchor-based diff
- `src/parser/claude-code-parser.ts` — Parses Claude Code rendered format (⏺ ToolName, ❯ prompts, spinners)
- `src/ws/command-handler.ts` — Translates steering commands to tmux send-keys
- `src/persistence/data-dir.ts` — Central resolver for all Hudai data paths (`~/.hudai/`)
- `src/persistence/event-store.ts` — SQLite persistence for events + sessions (replay support)

### Key Client Modules
- `src/stores/` — Zustand stores: event-store, session-store, panes-store, pane-content-store
- `src/ws/ws-client.ts` — WebSocket singleton with auto-reconnect
- `src/components/HudLayout.tsx` — CSS Grid: left (map+timeline) + right sidebar (live terminal) + footer (controls)
- `src/components/PanePreview.tsx` — Live terminal view with integrated text input

## AVP Event Protocol

Defined in `packages/shared/src/avp-events.ts`. Categories: navigation, mutation, execution, reasoning, testing, control. All events extend `AVPEventBase { id, sessionId, timestamp, category, type }`.

## Design Documents

- `docs/agentview-prd.md` — Full PRD with architecture, components, event protocol, success metrics
- `docs/commanders-view-session-export.md` — Design philosophy, RTS paradigm, case studies
- `docs/commanders-view-concept.html` — Interactive 1920×1080 HUD mockup (reference for visual language)

## Design Principles

- Dark theme only (#0a0e17 base). Color tokens in `packages/client/src/theme/tokens.ts`
- Observe, don't read — state through color, motion, position, not sentences
- Steering is spatial (pointing, bounding on map), text is the fallback
- North star: glance-to-understanding time < 3 seconds
