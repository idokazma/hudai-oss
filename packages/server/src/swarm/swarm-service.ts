import { readFile, stat } from 'node:fs/promises';
import { SessionScanner, type DiscoveredSession } from './session-scanner.js';
import { SessionMonitor, type SessionMetrics } from './session-monitor.js';
import { StatusDetector, type SessionStatus } from './session-status.js';
import type { SessionStore, EventStore } from '../persistence/event-store.js';
import { AgentProcess } from '../pty/agent-process.js';
import type { JsonlEntry } from '../transcript/jsonl-to-avp.js';

export interface SwarmAgent {
  sessionId: string;
  projectPath: string;
  projectName: string;
  status: SessionStatus;
  metrics: SessionMetrics;
  tmuxTarget?: string;
  isCurrentSession: boolean;
  source: 'tmux' | 'jsonl';
}

/**
 * SwarmService — Orchestrates session discovery and monitoring.
 *
 * Replaces SwarmRegistry with richer data:
 * - Discovers ALL sessions (tmux + non-tmux) via SessionScanner
 * - Provides lightweight status monitoring for background sessions
 * - Manages the attached session's full SessionMonitor
 */
export class SwarmService {
  private scanner: SessionScanner;
  private backgroundMonitors = new Map<string, SessionMonitor>();
  private attachedSessionId: string | null = null;

  constructor(
    private sessionStore: SessionStore,
    private eventStore: EventStore,
    private getCurrentSessionId: () => string,
  ) {
    this.scanner = new SessionScanner();
  }

  start(): void {
    this.scanner.start();
  }

  stop(): void {
    this.scanner.stop();
    for (const monitor of this.backgroundMonitors.values()) {
      monitor.stop();
    }
    this.backgroundMonitors.clear();
  }

  /**
   * Mark a session as the currently attached one (so it's excluded from background monitoring).
   */
  setAttachedSession(sessionId: string | null): void {
    // Stop old background monitor if we're attaching to a new session
    if (sessionId && this.backgroundMonitors.has(sessionId)) {
      this.backgroundMonitors.get(sessionId)!.stop();
      this.backgroundMonitors.delete(sessionId);
    }
    this.attachedSessionId = sessionId;
  }

  /**
   * Get swarm status for all discovered sessions.
   * Auto-starts background monitors for discovered sessions that don't have one yet.
   */
  getSwarmStatus(): SwarmAgent[] {
    const currentId = this.getCurrentSessionId();
    const discovered = this.scanner.getSessions();
    const tmuxPanes = AgentProcess.listPanes();

    // Build maps for tmux matching: by name, by id, and by cwd (project path)
    const tmuxMap = new Map<string, string>();
    const tmuxCwdMap = new Map<string, string>(); // cwd → pane id
    for (const pane of tmuxPanes) {
      tmuxMap.set(pane.id, pane.id);
      const sessionName = pane.id.split(':')[0];
      if (sessionName) tmuxMap.set(sessionName, pane.id);
      if (pane.cwd) tmuxCwdMap.set(pane.cwd, pane.id);
    }

    const agents: SwarmAgent[] = [];
    const seenJsonlSessions = new Set<string>();
    // Deduplicate JSONL sessions by project path — keep only the most recent per project
    const bestByProject = new Map<string, DiscoveredSession>();
    for (const session of discovered) {
      const existing = bestByProject.get(session.projectPath);
      if (!existing || session.lastModified > existing.lastModified) {
        bestByProject.set(session.projectPath, session);
      }
    }
    const dedupedSessions = Array.from(bestByProject.values());

    // 1. JSONL-discovered sessions (primary source, deduplicated by project)
    for (const session of dedupedSessions) {
      seenJsonlSessions.add(session.sessionId);
      const isAttached = session.sessionId === currentId ||
        session.sessionId === this.attachedSessionId;

      // Try to find a matching tmux pane (by name or by cwd)
      const projectName = session.projectPath.split('/').pop() || session.projectPath;
      const tmuxTarget = tmuxMap.get(projectName) || tmuxCwdMap.get(session.projectPath) || undefined;

      // Auto-start background monitor for non-attached sessions
      if (!isAttached && !this.backgroundMonitors.has(session.sessionId)) {
        this.startBackgroundMonitor(session);
      }

      // Get background monitor status if available
      const bgMonitor = this.backgroundMonitors.get(session.sessionId);

      agents.push({
        sessionId: session.sessionId,
        projectPath: session.projectPath,
        projectName,
        status: bgMonitor?.getStatus() || { activity: 'unknown' as any },
        metrics: bgMonitor?.getMetrics() || {
          tokensUsed: 0,
          turnCount: 0,
          toolCount: 0,
          lastActivity: session.lastModified,
        },
        tmuxTarget,
        isCurrentSession: isAttached,
        source: 'jsonl',
      });
    }

    // 2. tmux-only sessions (not discovered via JSONL — e.g. new sessions without history)
    for (const pane of tmuxPanes) {
      // Check if this pane is already covered by JSONL discovery (by tmuxTarget or by matching cwd)
      const alreadyCovered = agents.some((a) =>
        a.tmuxTarget === pane.id ||
        (pane.cwd && a.projectPath === pane.cwd)
      );
      if (alreadyCovered) continue;

      const sessionName = pane.id.split(':')[0] || pane.id;
      const dbSession = this.findDbSession(pane.id);
      const isAttached = pane.id === this.attachedSessionId || dbSession?.id === currentId;

      agents.push({
        sessionId: dbSession?.id || '',
        projectPath: pane.id,
        projectName: sessionName,
        status: { activity: 'unknown' as any },
        metrics: {
          tokensUsed: 0,
          turnCount: 0,
          toolCount: 0,
          lastActivity: dbSession?.startedAt || 0,
        },
        tmuxTarget: pane.id,
        isCurrentSession: isAttached,
        source: 'tmux',
      });
    }

    return agents;
  }

  /**
   * Build a text summary for CommanderChat context (replaces SwarmRegistry.buildSwarmSummary).
   */
  buildSwarmSummary(): string {
    const agents = this.getSwarmStatus();
    if (agents.length === 0) return '';

    const lines: string[] = [`SWARM (${agents.length} agent${agents.length > 1 ? 's' : ''}):`];

    for (const a of agents) {
      const tag = a.isCurrentSession ? '[ATTACHED] ' : '';
      const status = a.status.activity;
      const detail = a.status.detail ? ` — ${a.status.detail}` : '';
      const tmux = a.tmuxTarget ? '' : ' [no terminal]';
      lines.push(`* ${tag}${a.projectName} (${status}${detail})${tmux}`);
    }

    return lines.join('\n');
  }

  /**
   * Start a lightweight background monitor for a discovered session.
   */
  private startBackgroundMonitor(session: DiscoveredSession): SessionMonitor | null {
    // Don't monitor the attached session in the background
    if (session.sessionId === this.attachedSessionId) {
      const existing = this.backgroundMonitors.get(session.sessionId);
      if (existing) {
        existing.stop();
        this.backgroundMonitors.delete(session.sessionId);
      }
      return null;
    }

    const existing = this.backgroundMonitors.get(session.sessionId);
    if (existing) return existing;

    const monitor = new SessionMonitor(session.sessionId, session.projectPath, 'lightweight');
    this.backgroundMonitors.set(session.sessionId, monitor);
    monitor.start().catch((err) => {
      console.error(`[swarm] Failed to start background monitor for ${session.sessionId}:`, err);
      this.backgroundMonitors.delete(session.sessionId);
    });
    return monitor;
  }

  /**
   * Read the last few JSONL entries for a tmux session to determine its status + last message.
   * Used for sessions whose JSONL is too old for the scanner but the tmux pane is still alive.
   */
  async getStatusFromJsonl(projectName: string): Promise<{
    status: SessionStatus;
    lastMessage?: string;
    model?: string;
    tokensUsed?: number;
    turnCount?: number;
    toolCount?: number;
  } | null> {
    const match = await this.scanner.findLatestJsonlForProject(projectName);
    if (!match) return null;

    try {
      const fileStat = await stat(match.jsonlPath);
      const fileAge = Date.now() - fileStat.mtimeMs;
      const content = await readFile(match.jsonlPath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);

      // Scan full file for metrics
      let turnCount = 0;
      let toolCount = 0;
      let tokensUsed = 0;
      let model: string | undefined;

      for (const line of lines) {
        try {
          const entry: JsonlEntry = JSON.parse(line);
          if (entry.type === 'user') turnCount++;
          if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
            for (const block of entry.message!.content!) {
              if ((block as any).type === 'tool_use') toolCount++;
            }
            // Extract model from assistant entries
            if ((entry as any).model) model = (entry as any).model;
          }
          // Token usage from result entries
          if ((entry as any).usage) {
            const u = (entry as any).usage;
            tokensUsed += (u.input_tokens || 0) + (u.output_tokens || 0);
          }
          if ((entry.type as string) === 'result' && (entry as any).result?.usage) {
            const u = (entry as any).result.usage;
            tokensUsed += (u.input_tokens || 0) + (u.output_tokens || 0);
          }
        } catch { /* skip malformed */ }
      }

      // Read last 20 entries for status + last prose
      const lastLines = lines.slice(-20);
      const detector = new StatusDetector();
      let lastMessage: string | undefined;

      for (const line of lastLines) {
        try {
          const entry: JsonlEntry = JSON.parse(line);
          detector.processEntry(entry);

          if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
            for (const block of entry.message!.content!) {
              if ((block as any).type === 'text') {
                const text = ((block as any).text || '').trim();
                if (text.length >= 20 && !text.startsWith('<system-reminder') && !text.startsWith('<task-notification')) {
                  lastMessage = text;
                }
              }
            }
          }
        } catch { /* skip malformed */ }
      }

      if (lastMessage) {
        const firstLine = lastMessage.split('\n').find(l => l.trim().length > 10)?.trim();
        lastMessage = (firstLine || lastMessage).slice(0, 200);
      }

      const status = detector.getStatus();

      // Walk backwards from the last entry to find the most recent meaningful entry
      // (skip system entries that don't indicate idle, like file-history-snapshot)
      const PERMISSION_TOOLS = new Set(['Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'NotebookEdit']);

      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
        try {
          const parsed: JsonlEntry = JSON.parse(lines[i]);

          // system + turn_duration = turn completed → agent is idle
          if (parsed.type === 'system' && (parsed as any).subtype === 'turn_duration') {
            return { status: { activity: 'waiting_input', detail: 'Session idle' }, lastMessage, model, tokensUsed, turnCount, toolCount };
          }

          // system + result = turn completed → agent is idle
          if ((parsed.type as string) === 'result') {
            return { status: { activity: 'waiting_input', detail: 'Session idle' }, lastMessage, model, tokensUsed, turnCount, toolCount };
          }

          // Skip other system entries (file-history-snapshot, etc.) — look further back
          if (parsed.type === 'system') continue;

          // Last meaningful entry is text-only assistant → agent finished speaking, waiting for user
          if (parsed.type === 'assistant') {
            const innerContent = parsed.message?.content;
            if (Array.isArray(innerContent) && innerContent.every((b: any) => b.type === 'text' || b.type === 'thinking')) {
              return { status: { activity: 'waiting_input', detail: 'Session idle' }, lastMessage, model, tokensUsed, turnCount, toolCount };
            }
            // Assistant with tool_use → check file age to decide working vs waiting_permission
            if (Array.isArray(innerContent) && innerContent.some((b: any) => b.type === 'tool_use')) {
              const toolBlock = innerContent.find((b: any) => b.type === 'tool_use') as any;
              const toolName = toolBlock?.name || '';
              if (fileAge < 10_000) {
                // File is fresh — tool is likely still executing
                return { status: { activity: 'working', detail: toolName ? `Running ${toolName}` : undefined, currentFile: status.currentFile }, lastMessage, model, tokensUsed, turnCount, toolCount };
              }
              // File is stale with pending tool — check if it's a permission-likely tool
              if (PERMISSION_TOOLS.has(toolName)) {
                const command = toolBlock?.input?.command || toolBlock?.input?.file_path || toolBlock?.input?.description || '';
                const detail = command
                  ? `${toolName}: ${String(command).slice(0, 300)}`
                  : `Approval needed: ${toolName}`;
                return { status: { activity: 'waiting_permission', detail, currentFile: status.currentFile }, lastMessage, model, tokensUsed, turnCount, toolCount };
              }
              // Non-permission tool that's stale — probably stuck or slow
              return { status: { activity: 'working', detail: toolName ? `Running ${toolName}` : undefined, currentFile: status.currentFile }, lastMessage, model, tokensUsed, turnCount, toolCount };
            }
          }

          // Last meaningful entry is user → agent is processing the input
          if (parsed.type === 'user') {
            return { status: { activity: 'working', detail: undefined, currentFile: status.currentFile }, lastMessage, model, tokensUsed, turnCount, toolCount };
          }

          // Unknown entry type — keep looking back
        } catch { /* skip malformed */ }
      }

      return { status, lastMessage, model, tokensUsed, turnCount, toolCount };
    } catch {
      return null;
    }
  }

  private findDbSession(projectPath: string) {
    const all = this.sessionStore.list();
    return all.find((s) => s.projectPath === projectPath) || null;
  }
}
