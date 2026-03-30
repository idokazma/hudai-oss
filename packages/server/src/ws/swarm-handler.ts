import type { WebSocket } from 'ws';
import type { ServerMessage, SessionState, SwarmSnapshot } from '@hudai/shared';
import type { EventStore } from '../persistence/event-store.js';
import type { SwarmService, SwarmAgent } from '../swarm/swarm-service.js';
import { AgentProcess } from '../pty/agent-process.js';

export interface SwarmHandlerContext {
  sessionState: SessionState;
  eventStore: EventStore;
  swarmService: SwarmService;
  hooksActive: boolean;
  lastHookActivityAt: number;
}

/**
 * Handle 'swarm.status' messages — builds enriched SwarmSnapshot[] from multiple data sources.
 */
export async function handleSwarmStatus(
  socket: WebSocket,
  ctx: SwarmHandlerContext,
): Promise<void> {
  const { sessionState, eventStore, swarmService } = ctx;
  const snapshots = swarmService.getSnapshots();
  const swarmAgents = swarmService.getSwarmStatus();
  const consumedAgentIds = new Set<string>();

  const jsonlStatusPromises: Array<{ snap: SwarmSnapshot; promise: Promise<any> }> = [];

  for (const snap of snapshots) {
    // For the attached session, overlay live sessionState if available
    if (snap.isAttached || snap.sessionId === sessionState.sessionId) {
      snap.isAttached = true;
      const hookStale = ctx.hooksActive && (Date.now() - ctx.lastHookActivityAt) > 30_000;
      if (!ctx.hooksActive || hookStale) {
        snap.activity = sessionState.agentActivity || undefined;
        snap.activityDetail = sessionState.agentActivityDetail;
        snap.activityOptions = sessionState.agentActivityOptions;
        snap.currentFile = sessionState.agentCurrentFile ?? undefined;
        let lookupName = snap.projectName;
        const tmuxTarget = snap.tmuxTarget || snap.projectPath;
        if (tmuxTarget.includes(':')) {
          try {
            const cwd = AgentProcess.getPaneCwd(tmuxTarget);
            if (cwd) lookupName = cwd;
          } catch { /* tmux lookup failed */ }
        }
        jsonlStatusPromises.push({
          snap,
          promise: swarmService.getStatusFromJsonl(lookupName),
        });
      } else {
        snap.activity = sessionState.agentActivity || 'working';
        snap.activityDetail = sessionState.agentActivityDetail;
        snap.activityOptions = sessionState.agentActivityOptions;
        snap.currentFile = sessionState.agentCurrentFile ?? undefined;
      }
      continue;
    }

    // Strategy: PID-based JSONL resolution first, then SwarmService agents, then project-name JSONL lookup
    const tmuxTarget = snap.tmuxTarget || snap.projectPath;
    let resolved = false;

    // Try PID-based resolution for tmux panes
    if (tmuxTarget.includes(':')) {
      const sessionInfo = AgentProcess.getClaudeSessionForPane(tmuxTarget);
      if (sessionInfo) {
        const scanner = swarmService.getScanner();
        jsonlStatusPromises.push({
          snap,
          promise: scanner.getSessionForPid(sessionInfo.pid).then(result => {
            if (result) {
              return swarmService.getStatusFromJsonlPath(result.jsonlPath);
            }
            return swarmService.getStatusFromJsonl(snap.projectName);
          }),
        });
        resolved = true;
      }
    }

    // Fallback: try SwarmService agents (live JSONL monitor)
    if (!resolved) {
      let agent = swarmAgents.find((a) =>
        !consumedAgentIds.has(a.sessionId) &&
        (a.sessionId === snap.sessionId || a.tmuxTarget === snap.projectPath)
      );

      if (!agent) {
        let paneCwd: string | undefined;
        if (tmuxTarget.includes(':')) {
          try { paneCwd = AgentProcess.getPaneCwd(tmuxTarget); } catch { /* ignore */ }
        }
        if (paneCwd) {
          agent = swarmAgents.find((a) =>
            !consumedAgentIds.has(a.sessionId) && a.projectPath === paneCwd
          );
        }
      }

      if (agent && (agent.status.activity as string) !== 'unknown') {
        consumedAgentIds.add(agent.sessionId);
        snap.activity = snap.activity || agent.status.activity;
        snap.activityDetail = snap.activityDetail || agent.status.detail;
        snap.activityOptions = snap.activityOptions || agent.status.options;
        snap.currentFile = snap.currentFile || agent.status.currentFile;
        snap.model = agent.metrics.model;
        snap.tokensUsed = agent.metrics.tokensUsed;
        snap.turnCount = agent.metrics.turnCount;
        snap.toolCount = agent.metrics.toolCount;
        snap.tmuxTarget = snap.tmuxTarget || agent.tmuxTarget;
        snap.lastMessage = snap.lastMessage || agent.lastMessage;
        snap.source = agent.source;
      } else {
        // Last resort: project-name JSONL lookup
        let lookupName = snap.projectName;
        if (tmuxTarget.includes(':')) {
          try {
            const cwd = AgentProcess.getPaneCwd(tmuxTarget);
            if (cwd) lookupName = cwd;
          } catch { /* tmux lookup failed */ }
        }
        jsonlStatusPromises.push({
          snap,
          promise: swarmService.getStatusFromJsonl(lookupName),
        });
      }
    }
  }

  // Add JSONL-only sessions (non-tmux) not already in snapshots
  for (const agent of swarmAgents) {
    if (!agent.tmuxTarget && !snapshots.some((s) => s.sessionId === agent.sessionId)) {
      const attachedTmux = sessionState.tmuxTarget;
      const attachedProjectName = attachedTmux ? attachedTmux.split(':')[0] : '';
      const isThisAttached = agent.isCurrentSession ||
        agent.sessionId === sessionState.sessionId ||
        (!!attachedProjectName && agent.projectPath.endsWith('/' + attachedProjectName)) ||
        (!!attachedProjectName && agent.projectName === attachedProjectName);

      const snap: SwarmSnapshot = {
        sessionId: agent.sessionId,
        projectPath: agent.projectPath,
        projectName: agent.projectName,
        startedAt: isThisAttached ? sessionState.startedAt : 0,
        status: 'working',
        eventCount: isThisAttached ? sessionState.eventCount : 0,
        lastEventAt: agent.metrics.lastActivity || undefined,
        isAttached: isThisAttached,
        activity: isThisAttached ? (sessionState.agentActivity || undefined) : undefined,
        activityDetail: isThisAttached ? (sessionState.agentActivityDetail || undefined) : undefined,
        activityOptions: isThisAttached ? (sessionState.agentActivityOptions || undefined) : agent.status.options,
        currentFile: isThisAttached ? (sessionState.agentCurrentFile ?? undefined) : agent.status.currentFile,
        model: agent.metrics.model,
        tokensUsed: agent.metrics.tokensUsed,
        turnCount: agent.metrics.turnCount,
        toolCount: agent.metrics.toolCount,
        source: 'jsonl',
      };
      snapshots.push(snap);

      const discoveredSession = swarmService.getScanner().getSessions().find(s => s.sessionId === agent.sessionId);
      jsonlStatusPromises.push({
        snap,
        promise: discoveredSession
          ? swarmService.getStatusFromJsonlPath(discoveredSession.jsonlPath)
          : swarmService.getStatusFromJsonl(agent.projectPath),
      });
    }
  }

  // Resolve ALL JSONL status lookups in parallel
  if (jsonlStatusPromises.length > 0) {
    const results = await Promise.allSettled(
      jsonlStatusPromises.map((p) => p.promise)
    );
    for (let i = 0; i < jsonlStatusPromises.length; i++) {
      const result = results[i];
      const snap = jsonlStatusPromises[i].snap;
      if (result.status === 'fulfilled' && result.value) {
        const r = result.value;
        snap.activity = snap.activity || r.status.activity;
        snap.activityDetail = snap.activityDetail || r.status.detail;
        snap.activityOptions = snap.activityOptions || r.status.options;
        if (r.lastMessage) snap.lastMessage = snap.lastMessage || r.lastMessage;
        if (r.model) snap.model = snap.model || r.model;
        if (r.tokensUsed) snap.tokensUsed = snap.tokensUsed || r.tokensUsed;
        if (r.turnCount) snap.turnCount = snap.turnCount || r.turnCount;
        if (r.toolCount) snap.toolCount = snap.toolCount || r.toolCount;
      }
    }
  }

  // Populate lastMessage for all sessions
  for (const snap of snapshots) {
    if (snap.lastMessage) continue;

    // Strategy 1: event store by sessionId
    if (snap.sessionId) {
      try {
        const recentEvents = eventStore.getLatest(snap.sessionId, 50);
        for (const ev of recentEvents) {
          if (ev.type === 'raw.output') {
            const text = ((ev as any).data?.text || '').trim();
            if (text.length >= 20 && !text.startsWith('<system-reminder') && !text.startsWith('<task-notification')) {
              const firstLine = text.split('\n').find((l: string) => l.trim().length > 10)?.trim();
              snap.lastMessage = (firstLine || text).slice(0, 200);
              break;
            }
          }
        }
      } catch { /* skip */ }
    }

    // Strategy 2: event store by projectPath
    if (!snap.lastMessage) {
      try {
        const recentEvents = eventStore.getByProject(snap.projectPath, 0, 50);
        for (let i = recentEvents.length - 1; i >= 0; i--) {
          const ev = recentEvents[i];
          if (ev.type === 'raw.output') {
            const text = ((ev as any).data?.text || '').trim();
            if (text.length >= 20 && !text.startsWith('<system-reminder') && !text.startsWith('<task-notification')) {
              const firstLine = text.split('\n').find((l: string) => l.trim().length > 10)?.trim();
              snap.lastMessage = (firstLine || text).slice(0, 200);
              break;
            }
          }
        }
      } catch { /* skip */ }
    }

    // Strategy 3: PID-based JSONL lookup
    if (!snap.lastMessage) {
      const paneTarget = snap.tmuxTarget || snap.projectPath;
      if (paneTarget.includes(':')) {
        try {
          const sessionInfo = AgentProcess.getClaudeSessionForPane(paneTarget);
          if (sessionInfo) {
            const scanner = swarmService.getScanner();
            const result = await scanner.getSessionForPid(sessionInfo.pid);
            if (result) {
              const jsonlResult = await swarmService.getStatusFromJsonlPath(result.jsonlPath);
              if (jsonlResult?.lastMessage) {
                snap.lastMessage = jsonlResult.lastMessage;
              }
            }
          }
        } catch { /* PID resolution failed */ }
      }
    }

    // Strategy 4: JSONL file by project name
    if (!snap.lastMessage && snap.source === 'jsonl') {
      try {
        const jsonlResult = await swarmService.getStatusFromJsonl(snap.projectPath);
        if (jsonlResult?.lastMessage) {
          snap.lastMessage = jsonlResult.lastMessage;
        }
      } catch { /* skip */ }
    }
  }

  const resp: ServerMessage = { kind: 'swarm.status', sessions: snapshots };
  socket.send(JSON.stringify(resp));
}
