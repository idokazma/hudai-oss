import dotenv from 'dotenv';
import { resolve, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../..', '.env') });

import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import { execSync, fork, type ChildProcess } from 'node:child_process';
// @ts-ignore — @lydell/node-pty has types but exports field doesn't resolve them
import * as nodePty from '@lydell/node-pty';
import type { AVPEvent, ClientMessage, ServerMessage, SessionState, AdvisorVerbosity, AdvisorScope, AgentActivity, SwarmSnapshot } from '@hudai/shared';
import { WS_PORT } from '@hudai/shared';
import { AgentProcess } from './pty/agent-process.js';
import { ClaudeCodeParser } from './parser/claude-code-parser.js';
import { CommandHandler } from './ws/command-handler.js';
import { EventStore, SessionStore } from './persistence/event-store.js';
import { getDb } from './persistence/db.js';
import { loadSecrets, saveSecrets, getSecret, getKeysStatus } from './persistence/secrets.js';
import { GraphBuilder } from './graph/graph-builder.js';
import { TranscriptWatcher } from './transcript/transcript-watcher.js';
import { analyzePaneContent } from './parser/pane-analyzer.js';
import { HooksHandler } from './hooks/hooks-handler.js';
import type { ActivityUpdate } from './hooks/hooks-handler.js';
import { AgentHost } from './agent/agent-host.js';
import { StreamCommandHandler } from './agent/stream-command-handler.js';
import { buildAgentConfig } from './config/config-scanner.js';
import { writePermissionToggle } from './config/settings-reader.js';
import { getBuiltinSkill, BUILTIN_SKILLS } from './config/builtin-skills.js';
import { SubagentWatcher } from './transcript/subagent-watcher.js';
import { PlanFileWatcher } from './plans/plan-file-watcher.js';
import { PreviewProxy } from './preview/preview-proxy.js';
import { PermissionStats } from './config/permission-stats.js';
import { TokenTracker } from './transcript/token-tracker.js';
import { LoopDetector } from './parser/loop-detector.js';
import { getDemoPipelines } from './pipeline/demo-pipelines.js';
import { PipelineAnalyzer } from './pipeline/pipeline-analyzer.js';
import { loadCache } from './pipeline/pipeline-cache.js';
import { createLLMProvider, detectProvider } from './llm/index.js';
import type { LLMProvider } from './llm/llm-provider.js';
import { InsightEngine } from './llm/insight-engine.js';
import { CommanderChat } from './llm/commander-chat.js';
import { SwarmRegistry } from './llm/swarm-registry.js';
import { SessionMonitor } from './swarm/session-monitor.js';
import { SwarmService } from './swarm/swarm-service.js';
import type { SessionStatus } from './swarm/session-status.js';
import { ThreadSummarizer } from './llm/thread-summarizer.js';
import { generateSkill, generateAgent } from './llm/generator.js';
import { LibraryBuilder } from './library/library-builder.js';
import { IncrementalRefreshManager } from './refresh/refresh-manager.js';
import type { PipelineLayer, LibraryManifest } from '@hudai/shared';
import type { AgentConfig } from '@hudai/shared';

const fastify = Fastify({ logger: true });
await fastify.register(websocket);

// Initialize persistence
getDb();
const eventStore = new EventStore();
const sessionStore = new SessionStore();

// Connected clients
const clients = new Set<WebSocket>();

// Graph builder
const graphBuilder = new GraphBuilder();

// Active session state
let agent: AgentProcess | null = null;
let parser: ClaudeCodeParser | null = null;
let commandHandler: CommandHandler | null = null;
let transcriptWatcher: TranscriptWatcher | null = null;
let subagentWatcher: SubagentWatcher | null = null;
let planFileWatcher: PlanFileWatcher | null = null;
let lastPaneContent: string = '';
let lastPaneChangeAt: number = Date.now();
let idleNotified: boolean = false;
let cachedConfig: AgentConfig | null = null;
const activeSubagents = new Map<string, { type: string; startedAt: number }>();
const hooksHandler = new HooksHandler();
/** When true, activity state comes from hooks — pane-analyzer is bypassed */
let hooksActive = false;
let lastHookActivityAt = 0;
let agentHost: AgentHost | null = null;
let streamCommandHandler: StreamCommandHandler | null = null;
let streamOutput: string[] = [];
const permissionStats = new PermissionStats();
const tokenTracker = new TokenTracker();
const loopDetector = new LoopDetector();
let previewProxy: PreviewProxy | null = null;
let settingsWatcher: FSWatcher | null = null;
const llmConfig = detectProvider({
  geminiApiKey: getSecret('geminiApiKey'),
  openaiApiKey: getSecret('openaiApiKey'),
  claudeApiKey: getSecret('claudeApiKey'),
});
let llmProvider: LLMProvider | null = llmConfig ? createLLMProvider(llmConfig) : null;
if (llmProvider) {
  llmProvider.onStatusChange = (status) => {
    updateSessionState({ llmStatus: status });
  };
  llmProvider.onActivityChange = (label) => {
    updateSessionState({ llmActivity: label });
  };
}
let insightEngine = llmProvider
  ? new InsightEngine(llmProvider, () => graphBuilder.getGraph().edges)
  : null;
let commanderChat = llmProvider && insightEngine
  ? new CommanderChat(
      llmProvider,
      () => insightEngine!.recentEvents,
      () => sessionState,
      () => insightEngine!.intentHistory,
      () => graphBuilder.getGraph().edges,
      () => swarmService.buildSwarmSummary(),
      () => sessionState.sessionId ? eventStore.getBySession(sessionState.sessionId) : [],
    )
  : null;
// Load advisor verbosity + scope from secrets
const savedVerbosity = loadSecrets().advisorVerbosity;
if (commanderChat && savedVerbosity) {
  commanderChat.setVerbosity(savedVerbosity);
}
const savedScope = loadSecrets().advisorScope;
if (commanderChat && savedScope) {
  commanderChat.setScope(savedScope);
}
// Load custom advisor prompts from secrets
const savedSystemPrompt = loadSecrets().advisorSystemPrompt;
if (commanderChat && savedSystemPrompt) {
  commanderChat.setSystemPrompt(savedSystemPrompt);
}
const savedProactivePrompt = loadSecrets().advisorProactivePrompt;
if (commanderChat && savedProactivePrompt) {
  commanderChat.setProactivePrompt(savedProactivePrompt);
}
if (insightEngine && commanderChat) {
  // Proactive insights disabled — chat reserved for user ↔ advisor + actionable prompts
}
let threadSummarizer = llmProvider ? new ThreadSummarizer(llmProvider) : null;
if (threadSummarizer) {
  threadSummarizer.onFlushReady = (msgs) => {
    for (const msg of msgs) broadcast(msg);
  };
}
let cachedPipelineLayer: PipelineLayer | null = null;
let cachedLibraryManifest: LibraryManifest | null = null;
const libraryCache = new Map<string, LibraryManifest>();
let refreshManager: IncrementalRefreshManager | null = null;
const swarmRegistry = new SwarmRegistry(sessionStore, eventStore, () => sessionState.sessionId, () => sessionState.tmuxTarget);
const swarmService = new SwarmService(sessionStore, eventStore, () => sessionState.sessionId);
swarmService.start();
let sessionMonitor: SessionMonitor | null = null;
const serviceEnabled = { llm: true, telegram: true, library: false };
let sessionState: SessionState = {
  sessionId: '',
  status: 'idle',
  agentCurrentFile: null,
  taskLabel: 'No active task',
  startedAt: 0,
  eventCount: 0,
  llmStatus: llmProvider ? 'connected' : 'unavailable',
};

function isMemoryFile(path: string): string | null {
  const lower = path.toLowerCase();
  const basename = lower.split('/').pop() ?? '';
  if (basename === 'claude.md' || basename === 'memory.md') return basename.toUpperCase();
  if (lower.includes('.claude/settings')) return '.claude/settings';
  if (lower.includes('.claude/agent-memory/')) return 'agent-memory';
  if (lower.includes('.claude/') && basename.endsWith('.md')) return basename;
  return null;
}

function broadcast(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }
}

function updateSessionState(patch: Partial<SessionState>) {
  sessionState = { ...sessionState, ...patch };
  broadcast({ kind: 'session.state', state: sessionState });
}

/**
 * Apply an activity update from either hooks or pane-analyzer.
 * Centralizes the activity → session state transition logic.
 */
function applyActivityUpdate(update: ActivityUpdate) {
  const activityChanged = update.activity !== sessionState.agentActivity;
  const detailChanged = update.detail !== sessionState.agentActivityDetail;

  if (!activityChanged && !detailChanged) return;

  // Reset idle flag when agent resumes working
  if (activityChanged && sessionState.agentActivity === 'waiting_input' && update.activity !== 'waiting_input') {
    idleNotified = false;
  }

  // Mark idle when agent transitions to waiting_input
  if (update.activity === 'waiting_input' && sessionState.agentActivity !== 'waiting_input') {
    idleNotified = true;
    // Finalize active thread on idle
    if (threadSummarizer) {
      threadSummarizer.onActivityIdle();
      for (const msg of threadSummarizer.flush()) broadcast(msg);
    }
  }

  // Forward activity transitions to insight engine
  if (activityChanged && insightEngine) {
    insightEngine.activityChanged(sessionState.agentActivity, update.activity);
    if (commanderChat) {
      for (const msg of commanderChat.flush()) {
        broadcast(msg);
      }
    }
  }

  // Emit permission.prompt event for the event log
  if (update.activity === 'waiting_permission' && sessionState.agentActivity !== 'waiting_permission') {
    handleEvent({
      id: crypto.randomUUID(),
      sessionId: sessionState.sessionId,
      timestamp: Date.now(),
      category: 'control',
      type: 'permission.prompt',
      source: 'hooks',
      data: {
        tool: update.detail?.split(':')[0]?.trim() || 'Unknown',
        command: update.detail || 'Permission requested',
      },
    } as AVPEvent);
  }

  updateSessionState({
    agentActivity: update.activity,
    agentActivityDetail: update.detail,
    agentActivityOptions: update.options,
  });
}

const seenPrompts = new Set<string>();

function handleEvent(event: AVPEvent) {
  // Deduplicate task.start events by prompt text (backfill + tmux parser overlap)
  if (event.type === 'task.start') {
    const prompt = ((event as any).data?.prompt || '').trim();
    if (prompt && seenPrompts.has(prompt)) return;
    if (prompt) seenPrompts.add(prompt);
  }

  // When hooks are active and we receive JSONL events, transition to 'working'
  // (hooks don't fire a "working" notification — we infer it from new events)
  if (hooksActive && sessionState.agentActivity !== 'working') {
    const workEvents = ['file.read', 'file.edit', 'file.create', 'exec.start', 'think.start', 'plan.update'];
    if (workEvents.includes(event.type)) {
      applyActivityUpdate({ activity: 'working' });
    }
  }

  eventStore.insert(event);

  sessionState.eventCount++;
  if (event.type === 'file.read' || event.type === 'file.edit' || event.type === 'file.create') {
    const filePath = (event as any).data.path;
    sessionState.agentCurrentFile = filePath;

    // Update graph node heat/state
    const actType = event.type.split('.')[1] as 'read' | 'edit' | 'create';
    const result = graphBuilder.applyFileActivity(filePath, actType);
    if (result.newNode) {
      // New file created — send full graph so client gets the new node
      broadcast({ kind: 'graph.full', graph: graphBuilder.getGraph() });
    } else if (result.updates.length > 0) {
      broadcast({ kind: 'graph.update', updates: result.updates });
    }
  } else if (event.type === 'file.delete') {
    const filePath = (event as any).data.path;
    const result = graphBuilder.applyFileActivity(filePath, 'delete');
    if (result.updates.length > 0) {
      broadcast({ kind: 'graph.update', updates: result.updates });
    }
  }

  // Notify refresh manager of file mutations
  if (event.type === 'file.edit' || event.type === 'file.create' || event.type === 'file.delete') {
    const filePath = (event as any).data.path;
    if (serviceEnabled.library) refreshManager?.notifyFileChange(filePath);
  }

  // Detect memory file changes
  if (event.type === 'file.edit' || event.type === 'file.create') {
    const filePath = (event as any).data.path;
    const memoryType = isMemoryFile(filePath);
    if (memoryType) {
      const memoryEvent: AVPEvent = {
        id: crypto.randomUUID(),
        sessionId: event.sessionId,
        timestamp: Date.now(),
        category: 'control',
        type: 'memory.change',
        source: event.source,
        data: {
          path: filePath,
          changeType: event.type === 'file.edit' ? 'edit' : 'create',
          memoryType,
        },
      } as AVPEvent;
      eventStore.insert(memoryEvent);
      broadcast({ kind: 'event', event: memoryEvent });
    }
  }

  // Structured question from transcript — set waiting_answer state directly
  if (event.type === 'question.ask') {
    const data = (event as any).data;
    updateSessionState({
      agentActivity: 'waiting_answer',
      agentActivityDetail: data.question,
      agentActivityOptions: data.options,
    });
  }

  // JSONL-based permission detection: when a tool_use arrives with prompted status,
  // the agent is waiting for user approval. Much more reliable than terminal scraping.
  if (event.permission?.status === 'prompted' && event.source === 'transcript') {
    const data = (event as any).data;
    const toolName = event.type === 'shell.run' ? 'Bash' :
      event.type === 'file.read' ? 'Read' :
      event.type === 'file.edit' ? 'Edit' :
      event.type === 'file.create' ? 'Write' :
      event.type === 'search.grep' ? 'Grep' :
      event.type === 'search.glob' ? 'Glob' : 'Tool';
    const detail = toolName === 'Bash'
      ? `${toolName}: ${(data.command || '').slice(0, 300)}`
      : `${toolName}: ${(data.path || data.pattern || '').slice(0, 300)}`;

    updateSessionState({
      agentActivity: 'waiting_permission',
      agentActivityDetail: detail,
    });

    // Also emit permission.prompt event for tracking/suggestions
    handleEvent({
      id: crypto.randomUUID(),
      sessionId: event.sessionId,
      timestamp: Date.now(),
      category: 'control',
      type: 'permission.prompt',
      source: 'transcript',
      data: { tool: toolName, command: detail },
    } as AVPEvent);
  }

  // Tool completion clears waiting_permission if we were waiting
  if (event.type === 'tool.complete' && sessionState.agentActivity === 'waiting_permission') {
    updateSessionState({
      agentActivity: 'working',
      agentActivityDetail: undefined,
      agentActivityOptions: undefined,
    });
  }

  // Track permission prompts for suggestions
  if (event.type === 'permission.prompt') {
    const tool = (event as any).data.tool;
    permissionStats.recordPrompt(tool);
    const suggestions = permissionStats.getNewSuggestions(3);
    for (const suggestion of suggestions) {
      broadcast({ kind: 'permission.suggestion', suggestion });
    }
  }

  // Track compaction events — enrich with event distribution
  if (event.type === 'context.compaction') {
    const data = (event as any).data;
    // Enrich compaction event with event distribution
    try {
      const allEvents = eventStore.getByRange(event.sessionId, 0, event.timestamp);
      const distribution: Record<string, number> = {};
      for (const e of allEvents) {
        distribution[e.type] = (distribution[e.type] || 0) + 1;
      }
      data.eventDistribution = distribution;
      data.eventCountBefore = allEvents.length;
    } catch {
      // Non-critical — continue without enrichment
    }
    tokenTracker.recordCompaction(data.preTokens, event.timestamp);
    broadcast({ kind: 'tokens.state', state: tokenTracker.getState() });
  }

  // Track sub-agent lifecycle
  if (event.type === 'subagent.start') {
    const data = (event as any).data;
    activeSubagents.set(data.agentId, { type: data.agentType, startedAt: event.timestamp });
    updateBreadcrumb();
  } else if (event.type === 'subagent.end') {
    const data = (event as any).data;
    activeSubagents.delete(data.agentId);
    updateBreadcrumb();
  }

  // Loop detection — check tool-use events for repeated patterns
  if (event.category === 'navigation' || event.category === 'mutation' || event.category === 'execution') {
    const toolName = event.type;
    const primaryArg = (event as any).data?.path ?? (event as any).data?.command ?? (event as any).data?.pattern ?? '';
    const warning = loopDetector.recordAction(toolName, primaryArg, event.timestamp);
    if (warning) {
      const loopEvent: AVPEvent = {
        id: crypto.randomUUID(),
        sessionId: event.sessionId,
        timestamp: Date.now(),
        category: 'control',
        type: 'loop.warning',
        data: {
          pattern: warning.pattern,
          count: warning.count,
          windowMs: warning.windowMs,
        },
      } as AVPEvent;
      eventStore.insert(loopEvent);
      broadcast({ kind: 'event', event: loopEvent });
    }
  }

  // LLM insight processing (skip if LLM service is paused)
  if (insightEngine && serviceEnabled.llm) {
    insightEngine.onEvent(event, sessionState);
    for (const msg of insightEngine.flush()) {
      broadcast(msg);
    }
  }
  // Flush any pending commander chat messages (from proactive pushes)
  if (commanderChat && serviceEnabled.llm) {
    for (const msg of commanderChat.flush()) {
      broadcast(msg);
    }
  }

  // Thread summarizer: group events into threads and generate summaries
  if (threadSummarizer) {
    threadSummarizer.onEvent(event);
    for (const msg of threadSummarizer.flush()) broadcast(msg);
  }

  broadcast({ kind: 'event', event });
}

function updateBreadcrumb() {
  const breadcrumb = ['Main', ...Array.from(activeSubagents.values()).map((a) => a.type)];
  updateSessionState({
    agentBreadcrumb: breadcrumb,
    activeSubagentCount: activeSubagents.size,
  });
}

async function attachToPane(tmuxTarget: string) {
  // Clean up any existing connections (stream or tmux)
  if (agentHost) {
    stopAgent();
  }
  if (agent?.running) {
    agent.detach();
  }

  const sessionId = crypto.randomUUID();
  sessionStore.create(sessionId, tmuxTarget);
  commanderChat?.setSessionId(sessionId);

  parser = new ClaudeCodeParser(sessionId);
  parser.on('event', handleEvent);
  parser.on('plan-file', (filename: string) => {
    if (planFileWatcher) {
      console.log(`[plan] Detected plan file from terminal: ${filename}`);
      planFileWatcher.analyzeFile(filename);
    }
  });
  parser.on('plan-title', async (title: string) => {
    if (planFileWatcher) {
      console.log(`[plan] Detected plan title from terminal: "${title}"`);
      const filename = await planFileWatcher.findByTitle(title);
      if (filename) {
        console.log(`[plan] Matched title to file: ${filename}`);
        planFileWatcher.analyzeFile(filename);
      }
    }
  });

  agent = new AgentProcess();
  agent.attach({ tmuxTarget });

  agent.on('data', (_data: string) => {
    // ── Tmux parser is DISABLED — do NOT re-enable ──────────────────
    //
    // Previously this fed raw tmux capture-pane output into ClaudeCodeParser
    // as a fallback when the transcript watcher (JSONL) wasn't active.
    // This caused problems:
    //   - User typing at the ❯ prompt was parsed as task.start events
    //   - Partial/reflowed terminal lines created duplicate or phantom events
    //   - When no JSONL exists (fresh session, idle prompt), the fallback
    //     would still run and pollute the build queue with noise
    //
    // All structured events now come exclusively from the transcript watcher
    // which reads Claude Code's JSONL files (~/.claude/projects/<slug>/*.jsonl).
    // Raw tmux output is only used for PanePreview (live terminal display)
    // via the 'pane-content' event below.
    // ─────────────────────────────────────────────────────────────────
  });

  agent.on('pane-died', () => {
    console.log('[agent] Tmux pane died — auto-detaching');
    detachFromPane();
  });

  agent.on('pane-content', (content: string, caret: { x: number; lineIndex: number } | null) => {
    // Track when pane content actually changes (for stale detection)
    const paneChanged = content !== lastPaneContent;
    if (paneChanged) {
      lastPaneChangeAt = Date.now();
    }
    lastPaneContent = content;
    if (paneChanged) {
      broadcast({ kind: 'pane.content', content, caret });
    }

    // ── Pane-analyzer: idle detection only ──
    // Permission and question detection come from JSONL (structured, reliable).
    // Pane-analyzer only detects idle (❯ prompt) and working states.
    const analysis = analyzePaneContent(content);

    // Reset idle flag when agent starts working again
    if (sessionState.agentActivity === 'waiting_input' && analysis.activity !== 'waiting_input' && paneChanged) {
      idleNotified = false;
    }

    if (analysis.activity === 'waiting_input' && sessionState.agentActivity !== 'waiting_input') {
      // Agent went idle — update state
      idleNotified = true;
      updateSessionState({
        agentActivity: 'waiting_input',
        agentActivityDetail: analysis.detail,
        agentActivityOptions: undefined,
      });
    } else if (analysis.activity === 'working' && sessionState.agentActivity === 'waiting_input') {
      // Agent resumed working from idle
      updateSessionState({
        agentActivity: 'working',
        agentActivityDetail: undefined,
        agentActivityOptions: undefined,
      });
    }
    // Do NOT override waiting_permission or waiting_answer — those are set by JSONL

    // Stale detection safety net
    const staleSec = (Date.now() - lastPaneChangeAt) / 1000;
    const hookStaleSec = hooksActive ? (Date.now() - lastHookActivityAt) / 1000 : Infinity;
    if (
      staleSec >= 120 &&
      hookStaleSec >= 120 &&
      !idleNotified &&
      sessionState.agentActivity === 'working'
    ) {
      idleNotified = true;
      applyActivityUpdate({
        activity: 'waiting_input',
        detail: 'Agent appears idle (no output for 2 min)',
      });
    }
  });

  agent.on('exit', () => {
    parser!.flush();
    sessionStore.complete(sessionId);
    updateSessionState({ status: 'complete' });
  });

  commandHandler = new CommandHandler(agent);

  updateSessionState({
    sessionId,
    status: 'running',
    agentCurrentFile: null,
    taskLabel: tmuxTarget.split(':')[0] || tmuxTarget,
    tmuxTarget,
    mode: 'tmux',
    startedAt: Date.now(),
    eventCount: 0,
    llmStatus: llmProvider ? llmProvider.status : 'unavailable',
  });

  // Build codebase graph from pane's working directory
  let paneCwd: string | null = null;
  try {
    paneCwd = AgentProcess.getPaneCwd(tmuxTarget);
    if (paneCwd) {
      const graph = await graphBuilder.build(paneCwd);
      broadcast({ kind: 'graph.full', graph });
    }
  } catch (err) {
    console.error('[graph] Failed to build graph:', err);
  }

  // Load pipeline from disk cache — trust it at project level.
  // Incremental updates happen via IncrementalRefreshManager during the session.
  // Don't null cachedPipelineLayer — send existing cache immediately if available,
  // then async-load from disk and update if different project.
  if (cachedPipelineLayer) {
    broadcast({ kind: 'pipeline.full', layer: cachedPipelineLayer });
  }
  if (paneCwd) {
    const pipelineRootDir = paneCwd;
    loadCache(pipelineRootDir).then((cache) => {
      if (cache && cache.pipelines.length > 0 && sessionState.sessionId === sessionId) {
        cachedPipelineLayer = { pipelines: cache.pipelines };
        broadcast({ kind: 'pipeline.full', layer: cachedPipelineLayer });
        console.log(`[pipeline] Loaded ${cache.pipelines.length} pipelines from cache`);
        return; // Cache exists — no LLM needed on attach
      }

      // No cache — run full analysis if LLM is available
      if (llmProvider) {
        broadcast({ kind: 'pipeline.analyzing', status: 'started' });
        const pipelineSessionId = sessionId;
        const analyzer = new PipelineAnalyzer(llmProvider);
        const graphSnapshot = graphBuilder.getGraph();
        console.log(`[pipeline] No cache — starting full analysis (${graphSnapshot.nodes.length} nodes)`);
        analyzer.analyze(pipelineRootDir, graphSnapshot)
          .then((layer) => {
            console.log(`[pipeline] Analysis complete: ${layer.pipelines.length} pipelines`);
            if (sessionState.sessionId !== pipelineSessionId) return;
            cachedPipelineLayer = layer;
            broadcast({ kind: 'pipeline.full', layer });
            broadcast({ kind: 'pipeline.analyzing', status: 'complete' });
          })
          .catch((err) => {
            console.error('[pipeline] Analysis failed:', err);
            if (sessionState.sessionId === pipelineSessionId) {
              broadcast({ kind: 'pipeline.analyzing', status: 'complete' });
            }
          });
      } else {
        // No LLM and no cache — fall back to demo
        cachedPipelineLayer = getDemoPipelines();
        broadcast({ kind: 'pipeline.full', layer: cachedPipelineLayer });
      }
    });
  } else {
    broadcast({ kind: 'pipeline.full', layer: { pipelines: [] } });
  }

  // Library: check per-project cache before rebuilding
  cachedLibraryManifest = null;
  broadcast({ kind: 'library.clear' });
  if (paneCwd) {
    const cached = libraryCache.get(paneCwd);
    if (cached) {
      console.log(`[library] Using cached manifest for ${paneCwd}`);
      cachedLibraryManifest = cached;
      const fileCardCount = cached.modules.reduce((sum, m) => sum + m.fileCards.length, 0);
      broadcast({
        kind: 'library.ready',
        overview: cached.overview,
        moduleCount: cached.modules.length,
        fileCardCount,
      });
      broadcast({
        kind: 'library.manifest',
        overview: cached.overview,
        modules: cached.modules,
      });
    } else if (llmProvider && serviceEnabled.library) {
      const buildSessionId = sessionId;
      const libraryBuilder = new LibraryBuilder(llmProvider);
      libraryBuilder.build(paneCwd, graphBuilder.getGraph(), (progress) => {
        // Only send progress if we're still on the same session
        if (sessionState.sessionId !== buildSessionId) return;
        broadcast({ kind: 'library.progress', progress });
      })
        .then(({ manifest }) => {
          // Always cache the result for this project
          libraryCache.set(paneCwd!, manifest);
          // Only broadcast if we're still on the same session
          if (sessionState.sessionId !== buildSessionId) {
            console.log(`[library] Build finished for ${paneCwd} but session changed, cached silently`);
            return;
          }
          cachedLibraryManifest = manifest;
          const fileCardCount = manifest.modules.reduce((sum, m) => sum + m.fileCards.length, 0);
          broadcast({
            kind: 'library.ready',
            overview: manifest.overview,
            moduleCount: manifest.modules.length,
            fileCardCount,
          });
          broadcast({
            kind: 'library.manifest',
            overview: manifest.overview,
            modules: manifest.modules,
          });
        })
        .catch((err) => {
          console.error('[library] Build failed:', err);
        });
    }
  }

  // Set up incremental refresh manager (debounced auto-refresh on file changes)
  refreshManager?.reset();
  if (paneCwd && llmProvider) {
    const refreshRootDir = paneCwd;
    const refreshLlm = llmProvider;
    const refreshSessionId = sessionId;
    refreshManager = new IncrementalRefreshManager(async (_changedFiles) => {
      // Bail if session has changed since this manager was created
      if (sessionState.sessionId !== refreshSessionId) return;

      const graph = graphBuilder.getGraph();
      if (graph.nodes.length === 0) return;

      // Incremental pipeline refresh
      try {
        const analyzer = new PipelineAnalyzer(refreshLlm);
        const layer = await analyzer.analyze(refreshRootDir, graph);
        if (sessionState.sessionId !== refreshSessionId) return;
        cachedPipelineLayer = layer;
        broadcast({ kind: 'pipeline.full', layer });
      } catch (err) {
        console.error('[refresh] Pipeline incremental update failed:', err);
      }

      // Incremental library refresh
      try {
        const libBuilder = new LibraryBuilder(refreshLlm);
        const { manifest } = await libBuilder.build(refreshRootDir, graph, (progress) => {
          if (sessionState.sessionId !== refreshSessionId) return;
          broadcast({ kind: 'library.progress', progress });
        });
        libraryCache.set(refreshRootDir, manifest);
        if (sessionState.sessionId !== refreshSessionId) return;
        cachedLibraryManifest = manifest;
        const fileCardCount = manifest.modules.reduce((sum, m) => sum + m.fileCards.length, 0);
        broadcast({
          kind: 'library.ready',
          overview: manifest.overview,
          moduleCount: manifest.modules.length,
          fileCardCount,
        });
        broadcast({
          kind: 'library.manifest',
          overview: manifest.overview,
          modules: manifest.modules,
        });
      } catch (err) {
        console.error('[refresh] Library incremental update failed:', err);
      }
    });
  }

  // Scan agent config (skills, agents, MCP, hooks, permissions)
  if (paneCwd) {
    try {
      cachedConfig = await buildAgentConfig(paneCwd);
      broadcast({ kind: 'config.full', config: cachedConfig });
      // Pass permission rules to transcript watcher for stamping
      if (transcriptWatcher) {
        transcriptWatcher.permissionRules = cachedConfig.permissions;
      }
    } catch (err) {
      console.error('[config] Failed to scan agent config:', err);
    }

    // Watch .claude/settings.local.json for external changes (e.g. "don't ask again" in Claude Code)
    try {
      const settingsLocalPath = join(paneCwd, '.claude', 'settings.local.json');
      // Ensure dir exists so watch doesn't fail
      await mkdir(join(paneCwd, '.claude'), { recursive: true });
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      settingsWatcher = watch(settingsLocalPath, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          try {
            const root = graphBuilder.rootDir;
            if (!root) return;
            cachedConfig = await buildAgentConfig(root);
            broadcast({ kind: 'config.full', config: cachedConfig });
            if (transcriptWatcher) {
              transcriptWatcher.permissionRules = cachedConfig.permissions;
            }
            console.log('[config] Settings file changed externally — config refreshed');
          } catch {
            // File may be mid-write or deleted — ignore
          }
        }, 500);
      });
      settingsWatcher.on('error', () => {
        // File doesn't exist yet — that's fine, will be created on first write
      });
    } catch {
      // Watch setup failed — non-critical
    }
  }

  // Start transcript watcher — provides structured events from JSONL
  // When active, tmux parser is bypassed (tmux only feeds PanePreview)
  if (paneCwd) {
    try {
      transcriptWatcher = new TranscriptWatcher(sessionId, paneCwd);
      if (cachedConfig) {
        transcriptWatcher.permissionRules = cachedConfig.permissions;
      }
      transcriptWatcher.on('event', handleEvent);
      transcriptWatcher.on('usage', (data: { usage: any; model: string; timestamp: number }) => {
        tokenTracker.recordUsage(data.usage, data.model, data.timestamp);
        broadcast({ kind: 'tokens.state', state: tokenTracker.getState() });
      });
      transcriptWatcher.on('active', (path: string) => {
        console.log('[transcript] Now active, tmux parser bypassed');
        updateSessionState({ transcriptPath: path });
      });
      await transcriptWatcher.start();

      // Start sub-agent watcher to track delegated agents
      if (transcriptWatcher.active) {
        subagentWatcher = new SubagentWatcher(transcriptWatcher.transcriptDirectory, sessionId);
        subagentWatcher.on('event', handleEvent);
        await subagentWatcher.start();
      }

      // Start plan file watcher to detect plans from ~/.claude/plans/*.md
      if (llmProvider) {
        planFileWatcher = new PlanFileWatcher(sessionId, llmProvider, paneCwd ?? undefined);
        planFileWatcher.on('event', handleEvent);
        await planFileWatcher.start();
      }
    } catch (err) {
      console.error('[transcript] Failed to start watcher:', err);
    }
  }

  // Start SessionMonitor (JSONL-based status detection — parallel with pane-analyzer)
  // Priority: hooks > SessionMonitor (JSONL) > pane-analyzer (tmux regex)
  if (paneCwd) {
    try {
      sessionMonitor = new SessionMonitor(sessionId, paneCwd, 'full');
      // Status changes from JSONL → apply as activity update (when hooks aren't active)
      sessionMonitor.on('status', (status: SessionStatus) => {
        if (!hooksActive) {
          applyActivityUpdate({
            activity: status.activity,
            detail: status.detail,
            options: status.options,
          });
          if (status.currentFile) {
            updateSessionState({ agentCurrentFile: status.currentFile });
          }
        }
      });
      await sessionMonitor.start();
      swarmService.setAttachedSession(sessionId);
      console.log('[session-monitor] Started JSONL-based status detection');
    } catch (err) {
      console.error('[session-monitor] Failed to start:', err);
      sessionMonitor = null;
    }
  }

  // Send recent events from previous sessions of this project so HumanShell is populated immediately
  try {
    const REPLAY_TIME_WINDOW = 12 * 60 * 60 * 1000;
    // Use the latest event timestamp as anchor — "last active 12 hours" not "last 12 clock hours"
    const latestTs = eventStore.getLatestProjectTimestamp(tmuxTarget);
    const anchor = latestTs ?? Date.now();
    const cutoff = anchor - REPLAY_TIME_WINDOW;
    const projectEvents = eventStore.getByProject(tmuxTarget, cutoff, 2000);
    console.log(`[attach] Project history: target=${tmuxTarget}, latestTs=${latestTs}, cutoff=${new Date(cutoff).toISOString()}, events=${projectEvents.length}, taskStarts=${projectEvents.filter(e => e.type === 'task.start').length}`);
    if (projectEvents.length > 0) {
      const eventsMsg: ServerMessage = { kind: 'replay.events', events: projectEvents };
      broadcast(eventsMsg);
      // Bootstrap thread summarizer from historical events
      if (threadSummarizer) {
        threadSummarizer.bootstrap(projectEvents, tmuxTarget);
        for (const msg of threadSummarizer.flush()) broadcast(msg);
      }
    }
  } catch (err) {
    console.error('[attach] Failed to send project history:', err);
  }

  return sessionId;
}

function detachFromPane() {
  if (sessionMonitor) {
    sessionMonitor.stop();
    sessionMonitor = null;
    swarmService.setAttachedSession(null);
  }
  if (transcriptWatcher) {
    transcriptWatcher.stop();
    transcriptWatcher = null;
  }
  if (agent?.running) {
    agent.detach();
  }
  if (subagentWatcher) {
    subagentWatcher.stop();
  }
  if (planFileWatcher) {
    planFileWatcher.stop();
  }
  if (settingsWatcher) {
    settingsWatcher.close();
    settingsWatcher = null;
  }
  agent = null;
  parser = null;
  commandHandler = null;
  transcriptWatcher = null;
  subagentWatcher = null;
  planFileWatcher = null;
  lastPaneContent = '';
  hooksActive = false;
  lastHookActivityAt = 0;
  seenPrompts.clear();
  cachedConfig = null;
  // Keep cachedPipelineLayer — pipelines are project-level, not session-level
  cachedLibraryManifest = null;
  refreshManager?.reset();
  refreshManager = null;
  activeSubagents.clear();
  permissionStats.clear();
  tokenTracker.reset();
  loopDetector.reset();
  insightEngine?.reset();
  commanderChat?.reset(); // Only clears pending messages + sessionId, preserves chat history
  threadSummarizer?.reset();
  updateSessionState({
    sessionId: '',
    status: 'idle',
    agentCurrentFile: null,
    taskLabel: 'No active task',
    tmuxTarget: undefined,
    mode: undefined,
    startedAt: 0,
    eventCount: 0,
  });
}

/**
 * Stop the stream-json agent host and clean up.
 */
function stopAgent() {
  if (agentHost) {
    agentHost.destroy();
    agentHost = null;
  }
  streamCommandHandler = null;
  streamOutput = [];
  hooksActive = false;
  lastHookActivityAt = 0;
  seenPrompts.clear();
  activeSubagents.clear();
  permissionStats.clear();
  tokenTracker.reset();
  loopDetector.reset();
  insightEngine?.reset();
  commanderChat?.reset();
  threadSummarizer?.reset();
  updateSessionState({
    sessionId: '',
    status: 'idle',
    agentCurrentFile: null,
    taskLabel: 'No active task',
    mode: undefined,
    startedAt: 0,
    eventCount: 0,
  });
}

/**
 * Start a Claude Code agent in stream-json mode.
 * Spawns `claude --print --output-format stream-json` as a child process
 * and reads structured JSON events from stdout.
 */
async function startAgent(options: { projectPath: string; prompt?: string; label: string }) {
  // Clean up any existing connections (tmux or stream)
  detachFromPane();
  stopAgent();

  const sessionId = crypto.randomUUID();
  sessionStore.create(sessionId, options.projectPath, 'stream', options.label);

  // Build codebase graph from project path
  try {
    const graph = await graphBuilder.build(options.projectPath);
    broadcast({ kind: 'graph.full', graph });
  } catch (err) {
    console.error('[agent] Failed to build graph:', err);
  }

  // Scan agent config
  try {
    cachedConfig = await buildAgentConfig(options.projectPath);
    broadcast({ kind: 'config.full', config: cachedConfig });
  } catch {
    // Non-critical
  }

  // Set up insight engine context
  if (commanderChat) {
    commanderChat.setSessionId(sessionId);
  }

  agentHost = new AgentHost();
  if (cachedConfig) {
    agentHost.permissionRules = cachedConfig.permissions;
  }

  // Wire events — same handleEvent as tmux mode
  agentHost.on('event', handleEvent);

  agentHost.on('usage', (data: { usage: any; model: string; timestamp: number }) => {
    tokenTracker.recordUsage(data.usage, data.model, data.timestamp);
    broadcast({ kind: 'tokens.state', state: tokenTracker.getState() });
  });

  agentHost.on('result', (result: any) => {
    console.log(`[agent-host] Completed: ${result.subtype} (session: ${result.sessionId})`);
    // Persist Claude's session ID for future --resume
    if (result.sessionId) {
      sessionStore.setClaudeSessionId(sessionId, result.sessionId);
    }
    broadcast({ kind: 'agent.status', running: false, claudeSessionId: result.sessionId });
    applyActivityUpdate({ activity: 'waiting_input', detail: 'Task complete' });
    updateSessionState({ status: 'complete' });
  });

  agentHost.on('output', (text: string) => {
    streamOutput.push(text);
    broadcast({ kind: 'agent.output', text, append: true });
  });

  agentHost.on('exit', (code: number | null) => {
    broadcast({ kind: 'agent.status', running: false });
    if (code !== 0 && code !== null) {
      updateSessionState({ status: 'error' });
    }
  });

  streamCommandHandler = new StreamCommandHandler(agentHost);

  // Spawn the process
  agentHost.spawn(sessionId, {
    projectPath: options.projectPath,
    prompt: options.prompt,
  });

  updateSessionState({
    sessionId,
    status: 'running',
    agentCurrentFile: null,
    taskLabel: options.label,
    startedAt: Date.now(),
    eventCount: 0,
    mode: 'stream',
    agentActivity: 'working',
  });

  broadcast({ kind: 'agent.status', running: true });

  return sessionId;
}

// WebSocket route
fastify.register(async function (app) {
  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);

    // Send current session state on connect
    const stateMsg: ServerMessage = { kind: 'session.state', state: sessionState };
    socket.send(JSON.stringify(stateMsg));

    // Auto-send pane list so UI shows available tmux sessions immediately
    try {
      const panes = AgentProcess.listPanes();
      const panesMsg: ServerMessage = { kind: 'panes.list', panes };
      socket.send(JSON.stringify(panesMsg));
    } catch (err) {
      console.error('[ws] Failed to list panes on connect:', err);
    }

    // Send current graph if available
    const currentGraph = graphBuilder.getGraph();
    if (currentGraph.nodes.length > 0) {
      const graphMsg: ServerMessage = { kind: 'graph.full', graph: currentGraph };
      socket.send(JSON.stringify(graphMsg));
    }

    // Send cached token state
    if (tokenTracker.getState().totalInput > 0) {
      const tokensMsg: ServerMessage = { kind: 'tokens.state', state: tokenTracker.getState() };
      socket.send(JSON.stringify(tokensMsg));
    }

    // Send cached agent config
    if (cachedConfig) {
      const configMsg: ServerMessage = { kind: 'config.full', config: cachedConfig };
      socket.send(JSON.stringify(configMsg));
    }

    // Send cached pipeline definitions if available
    if (cachedPipelineLayer) {
      const pipelineMsg: ServerMessage = { kind: 'pipeline.full', layer: cachedPipelineLayer };
      socket.send(JSON.stringify(pipelineMsg));
    }

    // Send cached library manifest if available
    if (cachedLibraryManifest) {
      const fileCardCount = cachedLibraryManifest.modules.reduce((sum, m) => sum + m.fileCards.length, 0);
      const libraryMsg: ServerMessage = {
        kind: 'library.ready',
        overview: cachedLibraryManifest.overview,
        moduleCount: cachedLibraryManifest.modules.length,
        fileCardCount,
      };
      socket.send(JSON.stringify(libraryMsg));
    }

    // Send chat history for commander chat
    if (commanderChat) {
      const chatHistory = commanderChat.getHistory();
      if (chatHistory.length > 0) {
        const chatMsg: ServerMessage = { kind: 'chat.history', messages: chatHistory };
        socket.send(JSON.stringify(chatMsg));
      }
    }

    // Send settings keys status
    const keysMsg: ServerMessage = { kind: 'settings.keys', keys: getKeysStatus() };
    socket.send(JSON.stringify(keysMsg));

    // Send service toggle states
    const serviceMsg: ServerMessage = { kind: 'service.status', services: { ...serviceEnabled } };
    socket.send(JSON.stringify(serviceMsg));

    // Send advisor verbosity + scope settings
    if (commanderChat) {
      const advisorMsg: ServerMessage = { kind: 'settings.advisor', verbosity: commanderChat.getVerbosity() };
      socket.send(JSON.stringify(advisorMsg));
      const scopeMsg: ServerMessage = { kind: 'settings.advisorScope', scope: commanderChat.getScope() };
      socket.send(JSON.stringify(scopeMsg));
    }

    // Send last pane content so the live preview isn't blank
    if (lastPaneContent) {
      const paneMsg: ServerMessage = { kind: 'pane.content', content: lastPaneContent };
      socket.send(JSON.stringify(paneMsg));
    }

    // Send accumulated stream output for stream mode
    if (streamOutput.length > 0) {
      const fullText = streamOutput.join('');
      const outputMsg: ServerMessage = { kind: 'agent.output', text: fullText, append: false };
      socket.send(JSON.stringify(outputMsg));
    }

    // Send recent events for the current session so HumanShell and timeline are populated on reconnect
    // Cap at 2000 events and 12 hours to keep the payload reasonable
    const RECONNECT_EVENT_CAP = 2000;
    const RECONNECT_TIME_WINDOW = 12 * 60 * 60 * 1000; // 12 hours
    if (sessionState.sessionId && sessionState.status !== 'idle') {
      try {
        const tmuxTarget = sessionState.tmuxTarget;
        if (tmuxTarget) {
          // Send cross-session project history (same as attachToPane)
          const latestTs = eventStore.getLatestProjectTimestamp(tmuxTarget);
          const anchor = latestTs ?? Date.now();
          const cutoff = anchor - RECONNECT_TIME_WINDOW;
          const projectEvents = eventStore.getByProject(tmuxTarget, cutoff, RECONNECT_EVENT_CAP);
          if (projectEvents.length > 0) {
            const eventsMsg: ServerMessage = { kind: 'replay.events', events: projectEvents };
            socket.send(JSON.stringify(eventsMsg));
          }
        } else {
          const cutoff = Date.now() - RECONNECT_TIME_WINDOW;
          const allEvents = eventStore.getByRange(sessionState.sessionId, cutoff, Number.MAX_SAFE_INTEGER);
          const storedEvents = allEvents.length > RECONNECT_EVENT_CAP
            ? allEvents.slice(-RECONNECT_EVENT_CAP)
            : allEvents;
          if (storedEvents.length > 0) {
            const eventsMsg: ServerMessage = { kind: 'replay.events', events: storedEvents };
            socket.send(JSON.stringify(eventsMsg));
          }
        }
      } catch (err) {
        console.error('[ws] Failed to send stored events on connect:', err);
      }
    }

    // Send thread data if thread summarizer has state
    if (threadSummarizer) {
      const threads = threadSummarizer.getAll();
      if (threads.length > 0) {
        const threadMsg: ServerMessage = { kind: 'thread.list', threads };
        socket.send(JSON.stringify(threadMsg));
      }
    }

    socket.on('message', async (raw) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString());

        switch (msg.kind) {
          case 'panes.list': {
            const panes = AgentProcess.listPanes();
            const resp: ServerMessage = { kind: 'panes.list', panes };
            socket.send(JSON.stringify(resp));
            break;
          }

          case 'panes.status': {
            const panes = AgentProcess.listPanesWithStatus();
            const resp: ServerMessage = { kind: 'panes.list', panes };
            socket.send(JSON.stringify(resp));
            break;
          }

          case 'session.attach':
            attachToPane(msg.tmuxTarget);
            break;

          case 'session.detach':
            detachFromPane();
            break;

          case 'session.kill': {
            try {
              // If killing the currently attached session, detach first
              if (agent?.running && sessionState.tmuxTarget?.startsWith(msg.tmuxTarget.split(':')[0])) {
                detachFromPane();
              }
              AgentProcess.killSession(msg.tmuxTarget);
              console.log(`[session] Killed tmux session for target: ${msg.tmuxTarget}`);
              // Broadcast updated swarm status
              const snapshots = swarmRegistry.getSnapshots();
              broadcast({ kind: 'swarm.status', sessions: snapshots });
            } catch (err) {
              const resp: ServerMessage = { kind: 'error', message: `Failed to kill session: ${err}` };
              socket.send(JSON.stringify(resp));
            }
            break;
          }

          case 'session.create': {
            try {
              const tmuxTarget = AgentProcess.spawnAgent({
                projectPath: msg.projectPath,
                prompt: msg.prompt,
                sessionName: msg.sessionName,
              });
              // Give Claude a moment to start up before attaching
              setTimeout(async () => {
                try {
                  await attachToPane(tmuxTarget);
                } catch (err) {
                  broadcast({ kind: 'error', message: `Failed to attach to new agent: ${err}` });
                }
              }, 1500);
            } catch (err) {
              const resp: ServerMessage = { kind: 'error', message: `Failed to create agent: ${err}` };
              socket.send(JSON.stringify(resp));
            }
            break;
          }

          case 'session.clone': {
            try {
              const cwd = AgentProcess.getPaneCwd(msg.tmuxTarget);
              const tmuxTarget = AgentProcess.spawnAgent({
                projectPath: cwd,
                prompt: msg.prompt,
                sessionName: msg.sessionName,
              });
              // Give Claude a moment to start up before attaching
              setTimeout(async () => {
                try {
                  await attachToPane(tmuxTarget);
                } catch (err) {
                  broadcast({ kind: 'error', message: `Failed to attach to cloned agent: ${err}` });
                }
              }, 1500);
            } catch (err) {
              const resp: ServerMessage = { kind: 'error', message: `Failed to clone session: ${err}` };
              socket.send(JSON.stringify(resp));
            }
            break;
          }

          case 'pipeline.request': {
            // Client requesting current pipeline data (e.g., after view switch)
            if (cachedPipelineLayer) {
              const resp: ServerMessage = { kind: 'pipeline.full', layer: cachedPipelineLayer };
              socket.send(JSON.stringify(resp));
            }
            break;
          }

          case 'command':
            // Spawn agent in a NEW tmux session (not the current one)
            if (msg.command.type === 'spawn_agent') {
              const spawnCmd = msg.command;
              const currentTarget = sessionState.tmuxTarget;
              const baseName = currentTarget ? currentTarget.split(':')[0] : 'hudai';
              const agentName = spawnCmd.data.name.replace(/[^a-zA-Z0-9_-]/g, '-');
              const newSessionName = `${baseName}_${agentName}`;

              // Get the project directory from the current pane
              let projectPath = process.cwd();
              if (currentTarget) {
                try {
                  projectPath = AgentProcess.getPaneCwd(currentTarget) || projectPath;
                } catch {}
              }

              try {
                const newTarget = AgentProcess.spawnAgent({
                  projectPath,
                  prompt: spawnCmd.data.prompt,
                  sessionName: newSessionName,
                });
                console.log(`[spawn-agent] Created tmux session: ${newTarget}`);
                // Broadcast updated panes list so the UI can see the new session
                try {
                  const panes = AgentProcess.listPanes();
                  broadcast({ kind: 'panes.list', panes });
                } catch {}
              } catch (err) {
                console.error(`[spawn-agent] Failed to create tmux session:`, err);
                broadcast({ kind: 'error', message: `Failed to spawn agent: ${err}` });
              }
              break;
            }

            if (sessionState.mode === 'stream' && streamCommandHandler) {
              streamCommandHandler.handle(msg.command);
              if (msg.command.type === 'pause' || msg.command.type === 'cancel') {
                updateSessionState({ status: 'paused' });
              } else if (msg.command.type === 'resume' || msg.command.type === 'prompt') {
                updateSessionState({ status: 'running', agentActivity: 'working' });
              }
            } else if (commandHandler && agent?.running) {
              commandHandler.handle(msg.command);
              if (msg.command.type === 'pause') {
                updateSessionState({ status: 'paused' });
              } else if (msg.command.type === 'resume') {
                updateSessionState({ status: 'running' });
              }
            }
            break;

          case 'agent.start':
            try {
              await startAgent({ projectPath: msg.projectPath, prompt: msg.prompt, label: msg.label });
            } catch (err) {
              broadcast({ kind: 'error', message: `Failed to start agent: ${err}` });
            }
            break;

          case 'agent.resume':
            if (agentHost) {
              agentHost.resume(msg.prompt);
              applyActivityUpdate({ activity: 'working' });
              updateSessionState({ status: 'running' });
              broadcast({ kind: 'agent.status', running: true });
            }
            break;

          case 'agent.stop':
            stopAgent();
            break;

          case 'sessions.list': {
            const sessions = sessionStore.list();
            const resp: ServerMessage = { kind: 'sessions.list', sessions };
            socket.send(JSON.stringify(resp));
            break;
          }

          case 'replay.request': {
            const events = eventStore.getByRange(msg.sessionId, msg.from, msg.to);
            const resp: ServerMessage = { kind: 'replay.events', events };
            socket.send(JSON.stringify(resp));
            break;
          }

          case 'file.read': {
            const root = graphBuilder.rootDir;
            if (!root) {
              socket.send(JSON.stringify({ kind: 'file.content', path: msg.path, content: '', error: 'No project root' } satisfies ServerMessage));
              break;
            }
            const resolved = resolve(root, msg.path);
            const normalized = normalize(resolved);
            if (!normalized.startsWith(root) || normalized.includes('..')) {
              socket.send(JSON.stringify({ kind: 'file.content', path: msg.path, content: '', error: 'Path outside project root' } satisfies ServerMessage));
              break;
            }
            try {
              const content = await readFile(normalized, 'utf-8');
              socket.send(JSON.stringify({ kind: 'file.content', path: msg.path, content } satisfies ServerMessage));
            } catch (err) {
              socket.send(JSON.stringify({ kind: 'file.content', path: msg.path, content: '', error: String(err) } satisfies ServerMessage));
            }
            break;
          }

          case 'insight.requestSummary': {
            if (insightEngine && serviceEnabled.llm) {
              const events = eventStore.getByRange(sessionState.sessionId, 0, Number.MAX_SAFE_INTEGER);
              const contextPreview = commanderChat?.getContextPreview(events);
              // Append advisor chat history for richer summaries
              let fullContext = contextPreview || '';
              if (commanderChat) {
                const chatHistory = commanderChat.getHistory();
                const chatLines = chatHistory
                  .filter(m => m.role !== 'system')
                  .map(m => `${m.role === 'user' ? 'User' : 'Advisor'}: ${m.text}`);
                if (chatLines.length > 0) {
                  fullContext += '\n\nADVISOR CHAT HISTORY\n────────────────────\n' + chatLines.join('\n');
                }
              }
              insightEngine.requestSummary(events, sessionState, fullContext || undefined).then((summary) => {
                if (summary) broadcast({ kind: 'insight.summary', summary });
              });
            }
            break;
          }

          case 'thread.list': {
            if (threadSummarizer) {
              const threads = threadSummarizer.getAll();
              socket.send(JSON.stringify({ kind: 'thread.list', threads } satisfies ServerMessage));
            }
            break;
          }

          case 'chat.send': {
            if (commanderChat && serviceEnabled.llm && sessionState.sessionId) {
              commanderChat.onUserMessage(sessionState.sessionId, msg.text).then(() => {
                for (const chatMsg of commanderChat!.flush()) {
                  broadcast(chatMsg);
                }
              });
            } else {
              // No LLM available — inform user
              const noLlm: ServerMessage = {
                kind: 'chat.message',
                message: {
                  id: `chat-${Date.now()}`,
                  sessionId: sessionState.sessionId,
                  timestamp: Date.now(),
                  role: 'system',
                  text: 'Advisor unavailable — set GEMINI_API_KEY in .env to enable.',
                },
              };
              socket.send(JSON.stringify(noLlm));
            }
            break;
          }

          case 'chat.requestHistory': {
            if (commanderChat) {
              const history = commanderChat.getHistory();
              const resp: ServerMessage = { kind: 'chat.history', messages: history };
              socket.send(JSON.stringify(resp));
            }
            break;
          }

          case 'skill.install': {
            const root = graphBuilder.rootDir;
            if (!root) {
              socket.send(JSON.stringify({ kind: 'error', message: 'No project root' } satisfies ServerMessage));
              break;
            }
            const template = getBuiltinSkill(msg.skillId);
            if (!template) {
              socket.send(JSON.stringify({ kind: 'error', message: `Unknown skill: ${msg.skillId}` } satisfies ServerMessage));
              break;
            }
            try {
              const skillsDir = join(root, '.claude', 'skills');
              await mkdir(skillsDir, { recursive: true });
              await writeFile(join(skillsDir, template.filename), template.content, 'utf-8');
              console.log(`[config] Installed skill: ${template.name} → ${skillsDir}/${template.filename}`);
              // Re-scan config and broadcast
              cachedConfig = await buildAgentConfig(root);
              broadcast({ kind: 'config.full', config: cachedConfig });
            } catch (err) {
              socket.send(JSON.stringify({ kind: 'error', message: `Failed to install skill: ${err}` } satisfies ServerMessage));
            }
            break;
          }

          case 'skill.disable': {
            const root = graphBuilder.rootDir;
            if (!root) {
              socket.send(JSON.stringify({ kind: 'error', message: 'No project root' } satisfies ServerMessage));
              break;
            }
            const disablePath = normalize(resolve(root, msg.path));
            const disableSkillsDir = normalize(join(root, '.claude', 'skills'));
            if (!disablePath.startsWith(disableSkillsDir) || disablePath.includes('..')) {
              socket.send(JSON.stringify({ kind: 'error', message: 'Path must be under .claude/skills/' } satisfies ServerMessage));
              break;
            }
            try {
              await rename(disablePath, disablePath + '.disabled');
              console.log(`[config] Disabled skill: ${disablePath}`);
              cachedConfig = await buildAgentConfig(root);
              broadcast({ kind: 'config.full', config: cachedConfig });
            } catch (err) {
              socket.send(JSON.stringify({ kind: 'error', message: `Failed to disable skill: ${err}` } satisfies ServerMessage));
            }
            break;
          }

          case 'skill.enable': {
            const root = graphBuilder.rootDir;
            if (!root) {
              socket.send(JSON.stringify({ kind: 'error', message: 'No project root' } satisfies ServerMessage));
              break;
            }
            const enablePath = normalize(resolve(root, msg.path));
            const enableSkillsDir = normalize(join(root, '.claude', 'skills'));
            if (!enablePath.startsWith(enableSkillsDir) || enablePath.includes('..')) {
              socket.send(JSON.stringify({ kind: 'error', message: 'Path must be under .claude/skills/' } satisfies ServerMessage));
              break;
            }
            try {
              // Remove .disabled suffix to re-enable
              const activePath = enablePath.replace(/\.disabled$/, '');
              await rename(enablePath, activePath);
              console.log(`[config] Enabled skill: ${activePath}`);
              cachedConfig = await buildAgentConfig(root);
              broadcast({ kind: 'config.full', config: cachedConfig });
            } catch (err) {
              socket.send(JSON.stringify({ kind: 'error', message: `Failed to enable skill: ${err}` } satisfies ServerMessage));
            }
            break;
          }

          case 'library.request': {
            if (cachedLibraryManifest) {
              const resp: ServerMessage = {
                kind: 'library.manifest',
                overview: cachedLibraryManifest.overview,
                modules: cachedLibraryManifest.modules,
              };
              socket.send(JSON.stringify(resp));
            }
            break;
          }

          case 'library.rebuild': {
            if (!serviceEnabled.library) break;
            const root = graphBuilder.rootDir;
            if (root && llmProvider) {
              cachedLibraryManifest = null;
              const libraryBuilder = new LibraryBuilder(llmProvider);
              libraryBuilder.build(root, graphBuilder.getGraph(), (progress) => {
                broadcast({ kind: 'library.progress', progress });
              })
                .then(({ manifest }) => {
                  cachedLibraryManifest = manifest;
                  libraryCache.set(root, manifest);
                  const fileCardCount = manifest.modules.reduce((sum, m) => sum + m.fileCards.length, 0);
                  broadcast({
                    kind: 'library.ready',
                    overview: manifest.overview,
                    moduleCount: manifest.modules.length,
                    fileCardCount,
                  });
                  broadcast({
                    kind: 'library.manifest',
                    overview: manifest.overview,
                    modules: manifest.modules,
                  });
                })
                .catch((err) => {
                  console.error('[library] Rebuild failed:', err);
                });
            }
            break;
          }

          case 'settings.getKeys': {
            const resp: ServerMessage = { kind: 'settings.keys', keys: getKeysStatus() };
            socket.send(JSON.stringify(resp));
            break;
          }

          case 'settings.saveKeys': {
            try {
              const existing = loadSecrets();
              const updated = { ...existing };
              if (msg.keys.geminiApiKey !== undefined) {
                updated.geminiApiKey = msg.keys.geminiApiKey || undefined;
              }
              if (msg.keys.openaiApiKey !== undefined) {
                updated.openaiApiKey = msg.keys.openaiApiKey || undefined;
              }
              if (msg.keys.claudeApiKey !== undefined) {
                updated.claudeApiKey = msg.keys.claudeApiKey || undefined;
              }
              if (msg.keys.telegramBotToken !== undefined) {
                updated.telegramBotToken = msg.keys.telegramBotToken || undefined;
              }
              saveSecrets(updated);

              // Hot-reload LLM provider if keys changed
              const newConfig = detectProvider({
                geminiApiKey: getSecret('geminiApiKey'),
                openaiApiKey: getSecret('openaiApiKey'),
                claudeApiKey: getSecret('claudeApiKey'),
              });
              if (newConfig) {
                llmProvider = createLLMProvider(newConfig);
                llmProvider.onStatusChange = (status) => {
                  updateSessionState({ llmStatus: status });
                };
                llmProvider.onActivityChange = (label) => {
                  updateSessionState({ llmActivity: label });
                };
                insightEngine = new InsightEngine(llmProvider, () => graphBuilder.getGraph().edges);
                commanderChat = new CommanderChat(
                  llmProvider,
                  () => insightEngine!.recentEvents,
                  () => sessionState,
                  () => insightEngine!.intentHistory,
                  () => graphBuilder.getGraph().edges,
                  () => swarmService.buildSwarmSummary(),
                  () => sessionState.sessionId ? eventStore.getBySession(sessionState.sessionId) : [],
                );
                // Restore verbosity + scope + prompt settings
                const savedV = loadSecrets().advisorVerbosity;
                if (savedV) commanderChat.setVerbosity(savedV);
                const savedS = loadSecrets().advisorScope;
                if (savedS) commanderChat.setScope(savedS);
                const savedSP = loadSecrets().advisorSystemPrompt;
                if (savedSP) commanderChat.setSystemPrompt(savedSP);
                const savedPP = loadSecrets().advisorProactivePrompt;
                if (savedPP) commanderChat.setProactivePrompt(savedPP);
                threadSummarizer = new ThreadSummarizer(llmProvider);
                threadSummarizer.onFlushReady = (msgs) => {
                  for (const msg of msgs) broadcast(msg);
                };
                llmProvider.verify().then((ok) => {
                  updateSessionState({ llmStatus: ok ? 'connected' : 'error' });
                });
              } else {
                llmProvider = null;
                insightEngine = null;
                commanderChat = null;
                threadSummarizer = null;
                updateSessionState({ llmStatus: 'unavailable' });
              }

              // Hot-reload Telegram bot if token changed
              if (msg.keys.telegramBotToken !== undefined) {
                if (telegramBotProcess) {
                  telegramBotProcess.kill();
                  telegramBotProcess = null;
                }
                startTelegramBot();
              }

              const resp: ServerMessage = { kind: 'settings.saved', success: true, keys: getKeysStatus() };
              socket.send(JSON.stringify(resp));
              // Broadcast updated LLM status to all clients
              broadcast({ kind: 'session.state', state: sessionState });
            } catch (err) {
              const resp: ServerMessage = { kind: 'settings.saved', success: false, error: String(err), keys: getKeysStatus() };
              socket.send(JSON.stringify(resp));
            }
            break;
          }

          case 'settings.advisor': {
            const verbosity = msg.verbosity as AdvisorVerbosity;
            if (commanderChat) {
              commanderChat.setVerbosity(verbosity);
            }
            // Persist
            const secrets = loadSecrets();
            secrets.advisorVerbosity = verbosity;
            saveSecrets(secrets);
            // Broadcast to all clients
            broadcast({ kind: 'settings.advisor', verbosity });
            break;
          }

          case 'settings.advisorScope': {
            const scope = msg.scope as AdvisorScope;
            if (commanderChat) {
              commanderChat.setScope(scope);
            }
            // Persist
            const scopeSecrets = loadSecrets();
            scopeSecrets.advisorScope = scope;
            saveSecrets(scopeSecrets);
            // Broadcast to all clients
            broadcast({ kind: 'settings.advisorScope', scope });
            break;
          }

          case 'settings.getAdvisorPrompts': {
            const systemPrompt = commanderChat?.getSystemPrompt() || '';
            const proactivePrompt = commanderChat?.getProactivePrompt() || '';
            const isCustom = commanderChat?.isCustomPrompts() || false;
            const resp: ServerMessage = { kind: 'settings.advisorPrompts', systemPrompt, proactivePrompt, isCustom };
            socket.send(JSON.stringify(resp));
            break;
          }

          case 'settings.saveAdvisorPrompts': {
            try {
              const secrets = loadSecrets();
              if (msg.systemPrompt !== undefined) {
                secrets.advisorSystemPrompt = msg.systemPrompt || undefined;
                if (commanderChat) commanderChat.setSystemPrompt(msg.systemPrompt || undefined);
              }
              if (msg.proactivePrompt !== undefined) {
                secrets.advisorProactivePrompt = msg.proactivePrompt || undefined;
                if (commanderChat) commanderChat.setProactivePrompt(msg.proactivePrompt || undefined);
              }
              saveSecrets(secrets);
              // Respond with updated state
              const resp: ServerMessage = {
                kind: 'settings.advisorPrompts',
                systemPrompt: commanderChat?.getSystemPrompt() || '',
                proactivePrompt: commanderChat?.getProactivePrompt() || '',
                isCustom: commanderChat?.isCustomPrompts() || false,
              };
              broadcast(resp);
            } catch (err) {
              socket.send(JSON.stringify({ kind: 'error', message: `Failed to save advisor prompts: ${err}` } satisfies ServerMessage));
            }
            break;
          }

          case 'settings.resetAdvisorPrompts': {
            const secrets = loadSecrets();
            delete secrets.advisorSystemPrompt;
            delete secrets.advisorProactivePrompt;
            saveSecrets(secrets);
            if (commanderChat) {
              commanderChat.setSystemPrompt(undefined);
              commanderChat.setProactivePrompt(undefined);
            }
            const resp: ServerMessage = {
              kind: 'settings.advisorPrompts',
              systemPrompt: commanderChat?.getSystemPrompt() || commanderChat?.getDefaultSystemPrompt() || '',
              proactivePrompt: commanderChat?.getProactivePrompt() || commanderChat?.getDefaultProactivePrompt() || '',
              isCustom: false,
            };
            broadcast(resp);
            break;
          }

          case 'settings.getAdvisorContext': {
            // Load full session events from SQLite for a complete context story
            const allEvents = sessionState.sessionId
              ? eventStore.getBySession(sessionState.sessionId)
              : [];
            const context = commanderChat?.getContextPreview(allEvents) || 'Advisor not available — no Gemini API key configured.';
            const resp: ServerMessage = { kind: 'settings.advisorContext', context };
            socket.send(JSON.stringify(resp));
            break;
          }

          case 'plans.list': {
            if (planFileWatcher) {
              const plans = await planFileWatcher.listPlans();
              socket.send(JSON.stringify({ kind: 'plans.list', plans } satisfies ServerMessage));
            } else {
              socket.send(JSON.stringify({ kind: 'plans.list', plans: [] } satisfies ServerMessage));
            }
            break;
          }

          case 'plans.load': {
            if (planFileWatcher && msg.filename) {
              console.log(`[plan] Client requested plan load: ${msg.filename}`);
              planFileWatcher.analyzeFile(msg.filename);
            }
            break;
          }

          case 'preview.start': {
            try {
              if (previewProxy) {
                await previewProxy.stop();
                previewProxy = null;
              }
              previewProxy = new PreviewProxy(msg.url);
              const port = await previewProxy.start();
              broadcast({ kind: 'preview.ready', proxyPort: port, targetUrl: msg.url });
            } catch (err) {
              broadcast({ kind: 'preview.error', error: String(err) });
            }
            break;
          }

          case 'preview.stop': {
            if (previewProxy) {
              await previewProxy.stop();
              previewProxy = null;
            }
            break;
          }

          case 'swarm.status': {
            // Merge SwarmRegistry (tmux-based, DB-enriched) with SwarmService (JSONL-discovered)
            const snapshots = swarmRegistry.getSnapshots();
            const swarmAgents = swarmService.getSwarmStatus();
            const consumedAgentIds = new Set<string>();

            // Enrich snapshots with SwarmService data + sessionState for attached session
            // For sessions without live JSONL monitoring, read their JSONL to determine status
            const jsonlStatusPromises: Array<{ snap: typeof snapshots[0]; promise: Promise<any> }> = [];

            for (const snap of snapshots) {
              // For the attached session, overlay live sessionState if available
              if (snap.isAttached || snap.sessionId === sessionState.sessionId) {
                snap.isAttached = true;
                const hookStale = hooksActive && (Date.now() - lastHookActivityAt) > 30_000;
                // If hooks haven't fired recently or aren't active, also check JSONL
                if (!hooksActive || hookStale) {
                  // Queue JSONL lookup as additional signal for the attached session
                  snap.activity = sessionState.agentActivity || undefined;
                  snap.activityDetail = sessionState.agentActivityDetail;
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
                  snap.currentFile = sessionState.agentCurrentFile ?? undefined;
                }
                continue;
              }

              // Strategy: PID-based JSONL resolution first (reliable 1:1 mapping),
              // then fall back to SwarmService agents, then project-name JSONL lookup
              const tmuxTarget = snap.tmuxTarget || snap.projectPath;
              let resolved = false;

              // Try PID-based resolution for tmux panes (most reliable for multi-agent same-project)
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
                  // Don't use live monitor status — it has stale-tool false positives
                  // for active sessions. Use getStatusFromJsonl which has file-age heuristics.
                  activity: isThisAttached ? (sessionState.agentActivity || undefined) : undefined,
                  activityDetail: isThisAttached ? (sessionState.agentActivityDetail || undefined) : undefined,
                  currentFile: isThisAttached ? (sessionState.agentCurrentFile ?? undefined) : agent.status.currentFile,
                  model: agent.metrics.model,
                  tokensUsed: agent.metrics.tokensUsed,
                  turnCount: agent.metrics.turnCount,
                  toolCount: agent.metrics.toolCount,
                  source: 'jsonl',
                };
                snapshots.push(snap);

                // Always queue JSONL file lookup for status + metrics
                jsonlStatusPromises.push({
                  snap,
                  promise: swarmService.getStatusFromJsonl(agent.projectPath),
                });
              }
            }

            // Resolve ALL JSONL status lookups in parallel (tmux sessions + JSONL-only sessions)
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

              // Strategy 1: event store by sessionId (most reliable for attached/monitored sessions)
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

              // Strategy 2: event store by projectPath (fallback)
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

              // Strategy 3: PID-based JSONL lookup (for agents sharing a project — each gets its own JSONL)
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

              // Strategy 4: JSONL file by project name (fallback for sessions not resolved by PID)
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
            break;
          }

          case 'service.toggle': {
            const svc = msg.service;
            serviceEnabled[svc] = msg.enabled;
            console.log(`[service] ${svc} toggled to ${msg.enabled ? 'enabled' : 'disabled'}`);

            if (svc === 'llm') {
              updateSessionState({
                llmStatus: msg.enabled ? (llmProvider ? 'connected' : 'unavailable') : 'unavailable',
                llmActivity: msg.enabled ? null : null,
              });
            }
            if (svc === 'library' && !msg.enabled) {
              refreshManager?.reset();
            }

            broadcast({ kind: 'service.status', services: { ...serviceEnabled } });
            break;
          }

          case 'permission.toggle': {
            const root = graphBuilder.rootDir;
            if (!root) {
              socket.send(JSON.stringify({ kind: 'error', message: 'No project root' } satisfies ServerMessage));
              break;
            }
            try {
              await writePermissionToggle(root, msg.tool, msg.type, msg.enabled);
              console.log(`[config] Permission toggle: ${msg.type} ${msg.tool} → ${msg.enabled}`);
              cachedConfig = await buildAgentConfig(root);
              broadcast({ kind: 'config.full', config: cachedConfig });
            } catch (err) {
              socket.send(JSON.stringify({ kind: 'error', message: `Failed to toggle permission: ${err}` } satisfies ServerMessage));
            }
            break;
          }

          case 'generate.skill': {
            if (!llmProvider) {
              socket.send(JSON.stringify({ kind: 'generate.result', type: 'skill', name: '', filename: '', content: '', success: false, error: 'Gemini not configured' } satisfies ServerMessage));
              break;
            }
            try {
              const result = await generateSkill(llmProvider, msg.description);
              if (result) {
                socket.send(JSON.stringify({ kind: 'generate.result', type: 'skill', name: result.name, filename: result.filename, content: result.content, success: true } satisfies ServerMessage));
              } else {
                socket.send(JSON.stringify({ kind: 'generate.result', type: 'skill', name: '', filename: '', content: '', success: false, error: 'Generation failed' } satisfies ServerMessage));
              }
            } catch (err) {
              socket.send(JSON.stringify({ kind: 'generate.result', type: 'skill', name: '', filename: '', content: '', success: false, error: String(err) } satisfies ServerMessage));
            }
            break;
          }

          case 'generate.agent': {
            if (!llmProvider) {
              socket.send(JSON.stringify({ kind: 'generate.result', type: 'agent', name: '', filename: '', content: '', success: false, error: 'Gemini not configured' } satisfies ServerMessage));
              break;
            }
            try {
              const result = await generateAgent(llmProvider, msg.description);
              if (result) {
                socket.send(JSON.stringify({ kind: 'generate.result', type: 'agent', name: result.name, filename: result.filename, content: result.content, success: true } satisfies ServerMessage));
              } else {
                socket.send(JSON.stringify({ kind: 'generate.result', type: 'agent', name: '', filename: '', content: '', success: false, error: 'Generation failed' } satisfies ServerMessage));
              }
            } catch (err) {
              socket.send(JSON.stringify({ kind: 'generate.result', type: 'agent', name: '', filename: '', content: '', success: false, error: String(err) } satisfies ServerMessage));
            }
            break;
          }

          case 'generate.save': {
            const root = graphBuilder.rootDir;
            if (!root) {
              socket.send(JSON.stringify({ kind: 'error', message: 'No project root' } satisfies ServerMessage));
              break;
            }
            try {
              const subdir = msg.type === 'skill' ? 'skills' : 'agents';
              const targetDir = join(root, '.claude', subdir);
              await mkdir(targetDir, { recursive: true });
              await writeFile(join(targetDir, msg.filename), msg.content, 'utf-8');
              console.log(`[config] Saved generated ${msg.type}: ${msg.filename}`);
              cachedConfig = await buildAgentConfig(root);
              broadcast({ kind: 'config.full', config: cachedConfig });
            } catch (err) {
              socket.send(JSON.stringify({ kind: 'error', message: `Failed to save ${msg.type}: ${err}` } satisfies ServerMessage));
            }
            break;
          }

          case 'file.write': {
            const root = graphBuilder.rootDir;
            if (!root) {
              socket.send(JSON.stringify({ kind: 'file.write.result', path: msg.path, success: false, error: 'No project root' } satisfies ServerMessage));
              break;
            }
            const resolved = resolve(root, msg.path);
            const normalized = normalize(resolved);
            if (!normalized.startsWith(root) || normalized.includes('..')) {
              socket.send(JSON.stringify({ kind: 'file.write.result', path: msg.path, success: false, error: 'Path outside project root' } satisfies ServerMessage));
              break;
            }
            try {
              await writeFile(normalized, msg.content, 'utf-8');
              socket.send(JSON.stringify({ kind: 'file.write.result', path: msg.path, success: true } satisfies ServerMessage));
            } catch (err) {
              socket.send(JSON.stringify({ kind: 'file.write.result', path: msg.path, success: false, error: String(err) } satisfies ServerMessage));
            }
            break;
          }
        }
      } catch (err) {
        const resp: ServerMessage = { kind: 'error', message: String(err) };
        socket.send(JSON.stringify(resp));
      }
    });

    socket.on('close', () => {
      clients.delete(socket);
    });
  });
});

// Raw terminal WebSocket — pipes xterm.js ↔ tmux via @lydell/node-pty
fastify.register(async function (app) {
  app.get('/ws/terminal', { websocket: true }, (socket, req) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const target = url.searchParams.get('target');
    if (!target) {
      socket.close(4000, 'Missing ?target= parameter');
      return;
    }

    console.log(`[terminal] PTY session opening for tmux target: ${target}`);

    // Find tmux binary
    let tmuxBin: string;
    try {
      tmuxBin = execSync('zsh -lc "which tmux"', { encoding: 'utf-8' }).trim();
    } catch {
      tmuxBin = 'tmux';
    }

    // Allow tmux to resize to the latest client
    const sessionName = target.split(':')[0];
    try { execSync(`${tmuxBin} set-option -t "${sessionName}" window-size latest`, { stdio: 'ignore' }); } catch {}

    // Disable alternate screen so all output stays in the normal buffer with scrollback.
    // Without this, Claude Code's TUI enters alternate screen and scrollback is lost.
    // PTY output batching (16ms) handles flicker reduction instead.
    try { execSync(`${tmuxBin} set-option -t "${sessionName}" -w alternate-screen off`, { stdio: 'ignore' }); } catch {}

    // Ensure tmux keeps enough scrollback for history injection
    try { execSync(`${tmuxBin} set-option -t "${sessionName}" history-limit 5000`, { stdio: 'ignore' }); } catch {}

    // Hide tmux status bar — Hudai provides its own chrome
    try { execSync(`${tmuxBin} set-option -t "${sessionName}" status off`, { stdio: 'ignore' }); } catch {}

    // Inject scrollback history from tmux BEFORE starting the PTY stream.
    // We capture history, send it, then spawn the PTY — sequential, no overlap.
    try {
      const history = execSync(
        `${tmuxBin} capture-pane -t "${target}" -e -p -S -2000`,
        { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
      );
      if (history.trim() && socket.readyState === 1) {
        socket.send(history.replace(/\n/g, '\r\n'));
      }
    } catch {
      // capture-pane failed — continue without history
    }

    // Spawn tmux attach inside a real PTY (after history has been sent)
    const ptyProcess = nodePty.spawn(tmuxBin, ['attach-session', '-t', target], {
      cols: 80,
      rows: 24,
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    // Strip alternate screen + mouse tracking escapes so xterm stays in the
    // normal buffer (preserving scrollback) and wheel events scroll the buffer.
    const STRIP_RE = /\x1b\[\?(9|47|1000|1002|1003|1004|1005|1006|1015|1047|1049)[hl]/g;

    // Batch PTY output to reduce flicker (~16ms per frame).
    let ptyBuffer = '';
    let ptyFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushPty = () => {
      ptyFlushTimer = null;
      if (ptyBuffer && socket.readyState === 1) {
        socket.send(ptyBuffer);
      }
      ptyBuffer = '';
    };

    ptyProcess.onData((data: string) => {
      ptyBuffer += data.replace(STRIP_RE, '');
      if (!ptyFlushTimer) {
        ptyFlushTimer = setTimeout(flushPty, 16);
      }
    });

    ptyProcess.onExit(() => {
      console.log(`[terminal] PTY exited for target: ${target}`);
      if (socket.readyState === 1) socket.close(1000, 'PTY exited');
    });

    socket.on('message', (msg: Buffer | string) => {
      const data = typeof msg === 'string' ? msg : msg.toString();
      // Handle resize messages
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
          ptyProcess.resize(parsed.cols, parsed.rows);
          return;
        }
      } catch {
        // Not JSON — raw terminal input
      }
      ptyProcess.write(data);
    });

    socket.on('close', () => {
      console.log(`[terminal] WebSocket closed for target: ${target}`);
      if (ptyFlushTimer) clearTimeout(ptyFlushTimer);
      ptyProcess.kill();
    });
  });
});

// Health check
fastify.get('/api/health', async () => ({ status: 'ok' }));


// ── Filesystem path completion ──────────────────────────────────────
import { completePath, scanRecentProjects } from './fs/path-completer.js';

// Autocomplete: GET /api/fs/complete?path=/home/user/Des → matching directories
fastify.get('/api/fs/complete', async (request) => {
  const { path: partial } = request.query as { path?: string };
  const suggestions = await completePath(partial || '');
  return { suggestions };
});

// Recent projects: GET /api/fs/projects → past sessions + scanned git repos
fastify.get('/api/fs/projects', async () => {
  const sessions = sessionStore.list();
  // Extract unique project paths from past sessions (stream mode has real paths, tmux has targets)
  const pastPaths = sessions
    .filter((s) => s.mode === 'stream' || s.projectPath.startsWith('/'))
    .map((s) => s.projectPath)
    .filter((p, i, arr) => arr.indexOf(p) === i); // deduplicate
  const projects = await scanRecentProjects(pastPaths);
  return { projects };
});

// ── Claude Code Hooks endpoint ─────────────────────────────────────
// Claude Code posts Notification hook events here when configured with:
//   { "hooks": { "Notification": [{ "matcher": "...", "hooks": [{ "type": "http", "url": "http://localhost:4200/api/hooks/notification" }] }] } }
//
// This replaces tmux pane-analyzer for activity state detection.
fastify.post('/api/hooks/notification', async (request, reply) => {
  const body = request.body as Record<string, any> | undefined;
  if (!body || typeof body !== 'object') {
    return reply.status(400).send({ error: 'Invalid request body' });
  }

  // Mark hooks as active on first notification received
  if (!hooksActive) {
    hooksActive = true;
    console.log('[hooks] First notification received — hooks are now the primary activity source');
  }
  lastHookActivityAt = Date.now();

  const update = hooksHandler.handleNotification({
    matcher: body.matcher || body.type || '',
    message: body.message,
    tool: body.tool,
    command: body.command,
    question: body.question,
    options: body.options,
  });

  if (update) {
    applyActivityUpdate(update);
    // Feed hook update into SessionMonitor for status tracking
    if (sessionMonitor) {
      sessionMonitor.applyHookUpdate(update);
    }
  }

  return { ok: true };
});

// Explicit "working" transition — called when Claude Code starts processing
// (hooks don't fire a "working" notification, so we infer it from JSONL activity or this endpoint)
fastify.post('/api/hooks/working', async (request, reply) => {
  if (!hooksActive) {
    hooksActive = true;
  }
  lastHookActivityAt = Date.now();
  applyActivityUpdate({ activity: 'working', detail: undefined });
  if (sessionMonitor) {
    sessionMonitor.applyHookUpdate({ activity: 'working' });
  }
  return { ok: true };
});

// ── Hooks auto-install endpoints ────────────────────────────────────
import { homedir } from 'node:os';

const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
const HUDAI_HOOK_URL = `http://localhost:${WS_PORT}/api/hooks/notification`;

/** Check if Hudai notification hooks are installed in Claude Code settings */
async function checkHooksInstalled(): Promise<{ installed: boolean; hooksActive: boolean }> {
  try {
    const content = await readFile(CLAUDE_SETTINGS_PATH, 'utf-8');
    const settings = JSON.parse(content);
    const hooks = settings?.hooks?.Notification;
    if (!Array.isArray(hooks)) return { installed: false, hooksActive };
    const hasHudai = hooks.some((h: any) => {
      const cmd = h.command || '';
      const url = h.url || '';
      return cmd.includes('localhost') && cmd.includes('/api/hooks/') ||
             url.includes('localhost') && url.includes('/api/hooks/');
    });
    return { installed: hasHudai, hooksActive };
  } catch {
    return { installed: false, hooksActive };
  }
}

fastify.get('/api/hooks/status', async () => {
  return checkHooksInstalled();
});

fastify.post('/api/hooks/install', async () => {
  let settings: Record<string, any> = {};
  try {
    const content = await readFile(CLAUDE_SETTINGS_PATH, 'utf-8');
    settings = JSON.parse(content);
  } catch {
    // File doesn't exist or isn't valid JSON — start fresh
  }

  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks.Notification)) settings.hooks.Notification = [];

  // Check if already installed
  const existing = settings.hooks.Notification.some((h: any) => {
    const cmd = h.command || '';
    return cmd.includes('/api/hooks/notification');
  });

  if (!existing) {
    settings.hooks.Notification.push({
      matcher: '',
      command: `curl -s -X POST ${HUDAI_HOOK_URL} -H 'Content-Type: application/json' -d '$CLAUDE_NOTIFICATION'`,
    });
  }

  await writeFile(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
  return { ok: true, installed: true };
});

fastify.post('/api/hooks/uninstall', async () => {
  try {
    const content = await readFile(CLAUDE_SETTINGS_PATH, 'utf-8');
    const settings = JSON.parse(content);
    if (Array.isArray(settings?.hooks?.Notification)) {
      settings.hooks.Notification = settings.hooks.Notification.filter((h: any) => {
        const cmd = h.command || '';
        return !cmd.includes('/api/hooks/notification');
      });
      if (settings.hooks.Notification.length === 0) {
        delete settings.hooks.Notification;
      }
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }
    }
    await writeFile(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch {
    // Settings file doesn't exist — nothing to uninstall
  }
  return { ok: true, installed: false };
});

// Serve pre-built client files (production mode)
const clientDir = resolve(__dirname, '../public');
if (existsSync(clientDir)) {
  await fastify.register(fastifyStatic, { root: clientDir, wildcard: false });
  // SPA fallback — serve index.html for non-API/non-WS routes
  fastify.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/ws')) {
      reply.code(404).send({ error: 'Not found' });
    } else {
      reply.sendFile('index.html');
    }
  });
}

// Verify LLM connection at startup
if (llmProvider) {
  llmProvider.verify().then((ok) => {
    if (!ok) {
      console.warn('[gemini] LLM unavailable — pipeline analysis and intel will use fallbacks');
    }
  });
}

// Proactive swarm check — alert about idle or errored non-attached sessions
const SWARM_CHECK_INTERVAL = 60_000;
const IDLE_THRESHOLD_MS = 5 * 60_000;
// Track which sessions we've already alerted about (sessionId → alert type)
// so we don't spam the same message every interval tick
const swarmAlerted = new Map<string, string>();
setInterval(() => {
  if (!commanderChat || !serviceEnabled.llm) return;
  const snapshots = swarmRegistry.getSnapshots();
  for (const s of snapshots) {
    if (s.isAttached) continue;
    const alertKey = s.sessionId || s.projectPath;
    if (s.status === 'error') {
      if (swarmAlerted.get(alertKey) === 'error') continue;
      swarmAlerted.set(alertKey, 'error');
      commanderChat.pushProactive(
        `Agent "${s.projectName}" (session ${s.sessionId.slice(0, 8)}) has errored.`,
        'warning',
        'swarm.error',
      ).then(() => {
        for (const msg of commanderChat!.flush()) broadcast(msg);
      });
    } else if (s.lastEventAt && Date.now() - s.lastEventAt > IDLE_THRESHOLD_MS && s.status === 'running') {
      if (swarmAlerted.get(alertKey) === 'idle') continue;
      swarmAlerted.set(alertKey, 'idle');
      const idleMin = Math.floor((Date.now() - s.lastEventAt) / 60_000);
      commanderChat.pushProactive(
        `Agent "${s.projectName}" appears idle — no events for ${idleMin} minutes.`,
        'info',
        'swarm.idle',
      ).then(() => {
        for (const msg of commanderChat!.flush()) broadcast(msg);
      });
    } else {
      // Session recovered (new activity or status change) — clear so we can alert again if it re-idles
      swarmAlerted.delete(alertKey);
    }
  }
}, SWARM_CHECK_INTERVAL);

// Periodic "catch me up" summary — interval depends on verbosity
const SUMMARY_INTERVALS: Record<string, number> = {
  quiet: 0,        // never
  normal: 10 * 60_000, // 10 min
  verbose: 5 * 60_000, // 5 min
};
let lastAutoSummaryAt = 0;
let lastAutoSummaryEventCount = 0;
setInterval(() => {
  if (!insightEngine || !commanderChat || !serviceEnabled.llm) return;
  if (sessionState.status !== 'running' && sessionState.status !== 'idle') return;
  if (!sessionState.sessionId) return;

  const verbosity = commanderChat.getVerbosity();
  const interval = SUMMARY_INTERVALS[verbosity] || 0;
  if (interval === 0) return;

  const now = Date.now();
  if (now - lastAutoSummaryAt < interval) return;

  const events = eventStore.getByRange(sessionState.sessionId, 0, Number.MAX_SAFE_INTEGER);
  if (events.length < 5) return; // not enough activity yet

  // Skip if no new events since last summary — save LLM calls
  if (events.length <= lastAutoSummaryEventCount) return;

  lastAutoSummaryAt = now;
  lastAutoSummaryEventCount = events.length;

  const contextPreview = commanderChat.getContextPreview(events);
  let fullContext = contextPreview || '';
  const chatHistory = commanderChat.getHistory();
  const chatLines = chatHistory
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'User' : 'Advisor'}: ${m.text}`);
  if (chatLines.length > 0) {
    fullContext += '\n\nADVISOR CHAT HISTORY\n────────────────────\n' + chatLines.join('\n');
  }

  insightEngine.requestSummary(events, sessionState, fullContext || undefined).then((summary) => {
    if (summary) broadcast({ kind: 'insight.summary', summary });
  });
}, 60_000); // check every minute

// Cleanup on shutdown
fastify.addHook('onClose', async () => {
  if (previewProxy) {
    await previewProxy.stop();
    previewProxy = null;
  }
});

// Start server — try a range of ports if the default is in use
const PORT_CANDIDATES = [WS_PORT, WS_PORT + 1, WS_PORT + 2, WS_PORT + 3];

let started = false;
for (const port of PORT_CANDIDATES) {
  try {
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Hudai server running on http://localhost:${port}`);
    started = true;

    // Load project-level data at startup
    const serverCwd = process.cwd();
    (async () => {
      try {
        const graph = await graphBuilder.build(serverCwd);
        broadcast({ kind: 'graph.full', graph });
        console.log(`[startup] Built codebase graph: ${graph.nodes.length} nodes`);
      } catch (err) {
        console.error('[startup] Graph build failed:', err);
      }
      try {
        const cache = await loadCache(serverCwd);
        if (cache && cache.pipelines.length > 0 && !cachedPipelineLayer) {
          cachedPipelineLayer = { pipelines: cache.pipelines };
          broadcast({ kind: 'pipeline.full', layer: cachedPipelineLayer });
          console.log(`[startup] Loaded ${cache.pipelines.length} pipelines from cache`);
        }
      } catch { /* no cache — that's fine */ }
    })();
    break;
  } catch (err: any) {
    if (err?.code === 'EADDRINUSE') {
      console.warn(`Port ${port} is in use, trying next...`);
      continue;
    }
    fastify.log.error(err);
    process.exit(1);
  }
}

if (!started) {
  console.error(
    `\nFailed to start: ports ${PORT_CANDIDATES.join(', ')} are all in use.\n` +
    `Kill the process using one of these ports and try again:\n` +
    `  lsof -ti:${WS_PORT} | xargs kill\n`
  );
  process.exit(1);
}

// Start Telegram bot as child process if token is configured
let telegramBotProcess: ChildProcess | null = null;

function startTelegramBot() {
  const token = loadSecrets().telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const botEntry = resolve(__dirname, '../../telegram-bot/src/index.ts');
  telegramBotProcess = fork(botEntry, [], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, TELEGRAM_BOT_TOKEN: token },
  });

  telegramBotProcess.stdout?.on('data', (data: Buffer) => {
    process.stdout.write(data);
  });
  telegramBotProcess.stderr?.on('data', (data: Buffer) => {
    process.stderr.write(data);
  });

  telegramBotProcess.on('exit', (code) => {
    console.log(`[telegram-bot] Process exited (code ${code})`);
    telegramBotProcess = null;
  });

  console.log('[telegram-bot] Started as child process');
}

startTelegramBot();

// Clean up bot on server shutdown
process.on('SIGINT', () => {
  swarmService.stop();
  telegramBotProcess?.kill();
  process.exit(0);
});
process.on('SIGTERM', () => {
  swarmService.stop();
  telegramBotProcess?.kill();
  process.exit(0);
});
