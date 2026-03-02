import type { SwarmSnapshot } from '@hudai/shared';
import type { SessionStore, EventStore } from '../persistence/event-store.js';
import { AgentProcess } from '../pty/agent-process.js';

const MAX_SESSIONS = 10;

export class SwarmRegistry {
  constructor(
    private sessionStore: SessionStore,
    private eventStore: EventStore,
    private getCurrentSessionId: () => string,
    private getAttachedTmuxTarget: () => string | undefined,
  ) {}

  getSnapshots(): SwarmSnapshot[] {
    const currentId = this.getCurrentSessionId();
    const attachedTarget = this.getAttachedTmuxTarget();

    // Live tmux panes are the source of truth for what's attachable
    const livePanes = AgentProcess.listPanes();

    // Build a lookup: tmux pane id → most recent DB session for that pane
    const all = this.sessionStore.list(); // sorted by startedAt DESC
    const dbByPane = new Map<string, (typeof all)[0]>();
    for (const s of all) {
      if (!dbByPane.has(s.projectPath)) {
        dbByPane.set(s.projectPath, s);
      }
      // Prefer the currently attached session's row
      if (s.id === currentId) {
        dbByPane.set(s.projectPath, s);
      }
    }

    return livePanes.slice(0, MAX_SESSIONS).map(pane => {
      const dbSession = dbByPane.get(pane.id);
      const isAttached = pane.id === attachedTarget;

      // Derive friendly name from tmux session name (before the colon)
      const tmuxSessionName = pane.id.split(':')[0] || pane.id;

      if (dbSession) {
        const latest = this.eventStore.getLatest(dbSession.id, 1);
        const lastEvent = latest[0];

        return {
          sessionId: dbSession.id,
          projectPath: pane.id,
          projectName: tmuxSessionName,
          startedAt: dbSession.startedAt,
          status: dbSession.status,
          eventCount: dbSession.eventCount,
          lastEventType: lastEvent?.type,
          lastEventAt: lastEvent?.timestamp,
          isAttached,
        };
      }

      // No DB history — still show the live pane
      return {
        sessionId: '',
        projectPath: pane.id,
        projectName: tmuxSessionName,
        startedAt: 0,
        status: 'idle',
        eventCount: 0,
        isAttached,
      };
    });
  }

  buildSwarmSummary(): string {
    const snapshots = this.getSnapshots();
    if (snapshots.length === 0) return '';

    const lines: string[] = [`SWARM (${snapshots.length} agent${snapshots.length > 1 ? 's' : ''}):`];

    for (const s of snapshots) {
      const tag = s.isAttached ? '[ATTACHED] ' : '';
      const age = s.lastEventAt ? this.formatAge(Date.now() - s.lastEventAt) : 'no events';
      const lastInfo = s.lastEventType
        ? `last: ${s.lastEventType} ${age} ago`
        : age;
      lines.push(`* ${tag}${s.projectName} (${s.eventCount} events, ${lastInfo})`);
    }

    return lines.join('\n');
  }

  private formatAge(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}min`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h`;
  }
}
