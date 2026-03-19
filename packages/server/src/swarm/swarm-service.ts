import { SessionScanner, type DiscoveredSession } from './session-scanner.js';
import { SessionMonitor, type SessionMetrics } from './session-monitor.js';
import type { SessionStatus } from './session-status.js';
import type { SessionStore, EventStore } from '../persistence/event-store.js';
import { AgentProcess } from '../pty/agent-process.js';

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
   * Combines JSONL-discovered sessions with tmux pane info for switchability.
   */
  getSwarmStatus(): SwarmAgent[] {
    const currentId = this.getCurrentSessionId();
    const discovered = this.scanner.getSessions();
    const tmuxPanes = AgentProcess.listPanes();

    // Build a map of tmux session names to pane IDs for matching
    const tmuxMap = new Map<string, string>();
    for (const pane of tmuxPanes) {
      tmuxMap.set(pane.id, pane.id);
      // Also map by session name (before the colon)
      const sessionName = pane.id.split(':')[0];
      if (sessionName) tmuxMap.set(sessionName, pane.id);
    }

    const agents: SwarmAgent[] = [];
    const seenJsonlSessions = new Set<string>();

    // 1. JSONL-discovered sessions (primary source)
    for (const session of discovered) {
      seenJsonlSessions.add(session.sessionId);
      const isAttached = session.sessionId === currentId ||
        session.sessionId === this.attachedSessionId;

      // Try to find a matching tmux pane
      const projectName = session.projectPath.split('/').pop() || session.projectPath;
      const tmuxTarget = tmuxMap.get(projectName) || undefined;

      // Get background monitor status if available
      const bgMonitor = this.backgroundMonitors.get(session.sessionId);

      agents.push({
        sessionId: session.sessionId,
        projectPath: session.projectPath,
        projectName,
        status: bgMonitor?.getStatus() || { activity: 'working' },
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
      // Check if this pane's session is already covered by JSONL discovery
      const alreadyCovered = agents.some((a) => a.tmuxTarget === pane.id);
      if (alreadyCovered) continue;

      const sessionName = pane.id.split(':')[0] || pane.id;
      const dbSession = this.findDbSession(pane.id);
      const isAttached = pane.id === this.attachedSessionId || dbSession?.id === currentId;

      agents.push({
        sessionId: dbSession?.id || '',
        projectPath: pane.id,
        projectName: sessionName,
        status: { activity: 'working' },
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
  startBackgroundMonitor(session: DiscoveredSession): SessionMonitor {
    // Don't monitor the attached session in the background
    if (session.sessionId === this.attachedSessionId) {
      const existing = this.backgroundMonitors.get(session.sessionId);
      if (existing) {
        existing.stop();
        this.backgroundMonitors.delete(session.sessionId);
      }
      return null!;
    }

    const existing = this.backgroundMonitors.get(session.sessionId);
    if (existing) return existing;

    const monitor = new SessionMonitor(session.sessionId, session.projectPath, 'lightweight');
    this.backgroundMonitors.set(session.sessionId, monitor);
    monitor.start().catch(() => {});
    return monitor;
  }

  private findDbSession(projectPath: string) {
    const all = this.sessionStore.list();
    return all.find((s) => s.projectPath === projectPath) || null;
  }
}
