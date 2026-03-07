import dotenv from 'dotenv';
import { resolve, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../..', '.env') });

import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { execSync, fork, type ChildProcess } from 'node:child_process';
// @ts-ignore — @lydell/node-pty has types but exports field doesn't resolve them
import * as nodePty from '@lydell/node-pty';
import type { AVPEvent, ClientMessage, ServerMessage, SessionState, AdvisorVerbosity, AdvisorScope } from '@hudai/shared';
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
import { createLLMProvider, detectProvider } from './llm/index.js';
import type { LLMProvider } from './llm/llm-provider.js';
import { InsightEngine } from './llm/insight-engine.js';
import { CommanderChat } from './llm/commander-chat.js';
import { SwarmRegistry } from './llm/swarm-registry.js';
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
      () => swarmRegistry.buildSwarmSummary(),
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
let cachedPipelineLayer: PipelineLayer | null = null;
let cachedLibraryManifest: LibraryManifest | null = null;
const libraryCache = new Map<string, LibraryManifest>();
let refreshManager: IncrementalRefreshManager | null = null;
const swarmRegistry = new SwarmRegistry(sessionStore, eventStore, () => sessionState.sessionId, () => sessionState.tmuxTarget);
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

const seenPrompts = new Set<string>();

function handleEvent(event: AVPEvent) {
  // Deduplicate task.start events by prompt text (backfill + tmux parser overlap)
  if (event.type === 'task.start') {
    const prompt = ((event as any).data?.prompt || '').trim();
    if (prompt && seenPrompts.has(prompt)) return;
    if (prompt) seenPrompts.add(prompt);
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
  // Detach from any existing session
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

  agent.on('data', (data: string) => {
    // Only feed tmux parser when transcript watcher is NOT active
    // When transcript is active, JSONL provides structured events directly
    if (!transcriptWatcher?.active) {
      parser!.feed(data);
    }
  });

  agent.on('pane-content', (content: string, caret: { x: number; lineIndex: number } | null) => {
    // Track when pane content actually changes (for stale detection)
    const paneChanged = content !== lastPaneContent;
    if (paneChanged) {
      lastPaneChangeAt = Date.now();
    }
    lastPaneContent = content;
    broadcast({ kind: 'pane.content', content, caret });

    // Stale detection: if pane hasn't changed for 120s and agent is "working",
    // it's actually idle (Claude Code finished but prompt pattern wasn't detected)
    const staleSec = (Date.now() - lastPaneChangeAt) / 1000;
    const analysis = analyzePaneContent(content);
    if (
      staleSec >= 120 &&
      !idleNotified &&
      analysis.activity === 'working' // not already detected as waiting_input/permission/answer
    ) {
      idleNotified = true;
      broadcast({
        kind: 'insight.notification',
        notification: {
          id: `idle-${Date.now()}`,
          text: 'Agent finished — waiting for next command',
          severity: 'info',
          triggeredBy: 'activity.idle',
          timestamp: Date.now(),
        },
      });
      // Also update session state to waiting_input
      updateSessionState({
        agentActivity: 'waiting_input',
        agentActivityDetail: 'Agent appears idle (no output for 2 min)',
      });
      return;
    }

    // Analyze pane content to detect agent activity state
    // Also broadcast when detail changes (e.g. new question in interview-style flow)
    const activityChanged = analysis.activity !== sessionState.agentActivity;
    const detailChanged = analysis.detail !== sessionState.agentActivityDetail;

    // Reset idle flag only when pane content genuinely changed (agent started working again).
    // Without the contentChanged guard, the analyzer can flap between 'working' and
    // 'waiting_input' on the same stale pane, causing repeated idle notifications.
    if (activityChanged && sessionState.agentActivity === 'waiting_input' && analysis.activity !== 'waiting_input' && paneChanged) {
      idleNotified = false;
    }

    // Forward activity transitions to insight engine for proactive triggers
    if (activityChanged && insightEngine) {
      insightEngine.activityChanged(sessionState.agentActivity, analysis.activity);
      // Flush any resulting chat messages
      if (commanderChat) {
        for (const msg of commanderChat.flush()) {
          broadcast(msg);
        }
      }
    }

    if (activityChanged || (detailChanged && (analysis.activity === 'waiting_answer' || analysis.activity === 'waiting_permission'))) {
      // Mark idle when agent transitions to waiting_input
      // The session.state broadcast below already carries this — no separate notification needed
      if (analysis.activity === 'waiting_input' && sessionState.agentActivity !== 'waiting_input') {
        idleNotified = true;
      }

      // Emit permission.prompt event when pane analysis detects waiting_permission
      // This handles the case where transcript watcher is active and tmux parser is bypassed
      if (analysis.activity === 'waiting_permission' && sessionState.agentActivity !== 'waiting_permission') {
        handleEvent({
          id: crypto.randomUUID(),
          sessionId: sessionState.sessionId,
          timestamp: Date.now(),
          category: 'control',
          type: 'permission.prompt',
          source: 'tmux',
          data: {
            tool: analysis.detail?.split(':')[0]?.trim() || 'Unknown',
            command: analysis.detail || 'Permission requested',
          },
        } as AVPEvent);
      }
      updateSessionState({
        agentActivity: analysis.activity,
        agentActivityDetail: analysis.detail,
        agentActivityOptions: analysis.options,
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

  // Clear stale pipeline immediately so clients don't see old project's pipeline
  cachedPipelineLayer = null;
  broadcast({ kind: 'pipeline.full', layer: { pipelines: [] } });

  // Pipeline analysis — LLM-based or fallback to demo
  if (paneCwd) {
    if (llmProvider) {
      broadcast({ kind: 'pipeline.analyzing', status: 'started' });
      const pipelineSessionId = sessionId;
      const analyzer = new PipelineAnalyzer(llmProvider);
      const graphSnapshot = graphBuilder.getGraph();
      console.log(`[pipeline] Starting analysis (${graphSnapshot.nodes.length} nodes, ${graphSnapshot.edges.length} edges)`);
      analyzer.analyze(paneCwd, graphSnapshot)
        .then((layer) => {
          console.log(`[pipeline] Analysis complete: ${layer.pipelines.length} pipelines`);
          if (sessionState.sessionId !== pipelineSessionId) {
            console.log(`[pipeline] Session changed, discarding result`);
            return;
          }
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
      cachedPipelineLayer = getDemoPipelines();
      broadcast({ kind: 'pipeline.full', layer: cachedPipelineLayer });
    }
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
    } else if (llmProvider) {
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

  return sessionId;
}

function detachFromPane() {
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
  seenPrompts.clear();
  cachedConfig = null;
  cachedPipelineLayer = null;
  cachedLibraryManifest = null;
  refreshManager?.reset();
  refreshManager = null;
  activeSubagents.clear();
  permissionStats.clear();
  tokenTracker.reset();
  loopDetector.reset();
  insightEngine?.reset();
  commanderChat?.reset(); // Only clears pending messages + sessionId, preserves chat history
  updateSessionState({
    sessionId: '',
    status: 'idle',
    agentCurrentFile: null,
    taskLabel: 'No active task',
    tmuxTarget: undefined,
    startedAt: 0,
    eventCount: 0,
  });
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

    // Send stored events for the current session so timeline isn't empty on reconnect
    if (sessionState.sessionId && sessionState.status !== 'idle') {
      try {
        const storedEvents = eventStore.getByRange(sessionState.sessionId, 0, Number.MAX_SAFE_INTEGER);
        if (storedEvents.length > 0) {
          const eventsMsg: ServerMessage = { kind: 'replay.events', events: storedEvents };
          socket.send(JSON.stringify(eventsMsg));
        }
      } catch (err) {
        console.error('[ws] Failed to send stored events on connect:', err);
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

          case 'command':
            if (commandHandler && agent?.running) {
              commandHandler.handle(msg.command);
              if (msg.command.type === 'pause') {
                updateSessionState({ status: 'paused' });
              } else if (msg.command.type === 'resume') {
                updateSessionState({ status: 'running' });
              }
            }
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

          case 'chat.send': {
            if (commanderChat && serviceEnabled.llm && sessionState.sessionId) {
              commanderChat.onUserMessage(sessionState.sessionId, msg.text, msg.context).then(() => {
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
                  () => swarmRegistry.buildSwarmSummary(),
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
                llmProvider.verify().then((ok) => {
                  updateSessionState({ llmStatus: ok ? 'connected' : 'error' });
                });
              } else {
                llmProvider = null;
                insightEngine = null;
                commanderChat = null;
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
            const snapshots = swarmRegistry.getSnapshots();
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

    // Disable alternate screen so future apps stay in normal buffer with scrollback
    try { execSync(`${tmuxBin} set-option -t "${sessionName}" -w alternate-screen off`, { stdio: 'ignore' }); } catch {}

    // Spawn tmux attach inside a real PTY
    const ptyProcess = nodePty.spawn(tmuxBin, ['attach-session', '-t', target], {
      cols: 80,
      rows: 24,
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    // Strip escape sequences that enable alternate screen or mouse tracking.
    // This keeps xterm.js in normal buffer mode (with scrollback) and prevents
    // mouse wheel events from being consumed by mouse reporting.
    const STRIP_RE = /\x1b\[\?(9|47|1000|1002|1003|1004|1005|1006|1015|1047|1049)[hl]/g;

    ptyProcess.onData((data: string) => {
      if (socket.readyState === 1) {
        socket.send(data.replace(STRIP_RE, ''));
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
      ptyProcess.kill();
    });
  });
});

// Health check
fastify.get('/api/health', async () => ({ status: 'ok' }));

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

// Start server
const port = WS_PORT;
try {
  await fastify.listen({ port, host: '0.0.0.0' });
  console.log(`Hudai server running on http://localhost:${port}`);
} catch (err) {
  fastify.log.error(err);
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
  telegramBotProcess?.kill();
  process.exit(0);
});
process.on('SIGTERM', () => {
  telegramBotProcess?.kill();
  process.exit(0);
});
