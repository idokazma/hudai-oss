import type { WebSocket } from 'ws';
import type { AVPEvent, SessionState, ServerMessage, AgentConfig, PipelineLayer, LibraryManifest } from '@hudai/shared';
import type { AgentProcess } from './pty/agent-process.js';
import type { ClaudeCodeParser } from './parser/claude-code-parser.js';
import type { CommandHandler } from './ws/command-handler.js';
import type { EventStore, SessionStore } from './persistence/event-store.js';
import type { GraphBuilder } from './graph/graph-builder.js';
import type { TranscriptWatcher } from './transcript/transcript-watcher.js';
import type { SubagentWatcher } from './transcript/subagent-watcher.js';
import type { PlanFileWatcher } from './plans/plan-file-watcher.js';
import type { HooksHandler } from './hooks/hooks-handler.js';
import type { AgentHost } from './agent/agent-host.js';
import type { StreamCommandHandler } from './agent/stream-command-handler.js';
import type { PermissionStats } from './config/permission-stats.js';
import type { TokenTracker } from './transcript/token-tracker.js';
import type { LoopDetector } from './parser/loop-detector.js';
import type { PreviewProxy } from './preview/preview-proxy.js';
import type { LLMProvider } from './llm/llm-provider.js';
import type { InsightEngine } from './llm/insight-engine.js';
import type { CommanderChat } from './llm/commander-chat.js';
import type { ThreadSummarizer } from './llm/thread-summarizer.js';
import type { SwarmService } from './swarm/swarm-service.js';
import type { SessionMonitor } from './swarm/session-monitor.js';
import type { IncrementalRefreshManager } from './refresh/refresh-manager.js';
import type { LibraryBuilder } from './library/library-builder.js';
import type { FSWatcher } from 'node:fs';

/**
 * Shared server state passed to extracted handler modules.
 * Uses getters/setters for mutable state so modules can read and update it
 * without holding stale references.
 */
export interface ServerContext {
  // Stores
  eventStore: EventStore;
  sessionStore: SessionStore;

  // Graph
  graphBuilder: GraphBuilder;

  // Session state
  sessionState: SessionState;
  updateSessionState: (patch: Partial<SessionState>) => void;

  // Broadcast to all connected clients
  broadcast: (msg: ServerMessage) => void;

  // Agent / parser
  getAgent: () => AgentProcess | null;
  setAgent: (v: AgentProcess | null) => void;
  getParser: () => ClaudeCodeParser | null;
  setParser: (v: ClaudeCodeParser | null) => void;
  getCommandHandler: () => CommandHandler | null;
  setCommandHandler: (v: CommandHandler | null) => void;

  // Watchers
  getTranscriptWatcher: () => TranscriptWatcher | null;
  setTranscriptWatcher: (v: TranscriptWatcher | null) => void;
  getSubagentWatcher: () => SubagentWatcher | null;
  setSubagentWatcher: (v: SubagentWatcher | null) => void;
  getPlanFileWatcher: () => PlanFileWatcher | null;
  setPlanFileWatcher: (v: PlanFileWatcher | null) => void;
  getSettingsWatcher: () => FSWatcher | null;
  setSettingsWatcher: (v: FSWatcher | null) => void;

  // Pane state
  getLastPaneContent: () => string;
  setLastPaneContent: (v: string) => void;
  getLastPaneChangeAt: () => number;
  setLastPaneChangeAt: (v: number) => void;
  getIdleNotified: () => boolean;
  setIdleNotified: (v: boolean) => void;

  // Config
  getCachedConfig: () => AgentConfig | null;
  setCachedConfig: (v: AgentConfig | null) => void;

  // Subagents
  activeSubagents: Map<string, { type: string; startedAt: number }>;

  // Hooks
  hooksHandler: HooksHandler;
  getHooksActive: () => boolean;
  setHooksActive: (v: boolean) => void;
  getLastHookActivityAt: () => number;
  setLastHookActivityAt: (v: number) => void;

  // Stream mode
  getAgentHost: () => AgentHost | null;
  setAgentHost: (v: AgentHost | null) => void;
  getStreamCommandHandler: () => StreamCommandHandler | null;
  setStreamCommandHandler: (v: StreamCommandHandler | null) => void;
  getStreamOutput: () => string[];
  setStreamOutput: (v: string[]) => void;

  // Tracking
  permissionStats: PermissionStats;
  tokenTracker: TokenTracker;
  loopDetector: LoopDetector;

  // Preview
  getPreviewProxy: () => PreviewProxy | null;
  setPreviewProxy: (v: PreviewProxy | null) => void;

  // LLM
  getLlmProvider: () => LLMProvider | null;
  setLlmProvider: (v: LLMProvider | null) => void;
  getInsightEngine: () => InsightEngine | null;
  setInsightEngine: (v: InsightEngine | null) => void;
  getCommanderChat: () => CommanderChat | null;
  setCommanderChat: (v: CommanderChat | null) => void;
  getThreadSummarizer: () => ThreadSummarizer | null;
  setThreadSummarizer: (v: ThreadSummarizer | null) => void;

  // Swarm
  swarmService: SwarmService;
  getSessionMonitor: () => SessionMonitor | null;
  setSessionMonitor: (v: SessionMonitor | null) => void;

  // Pipeline / Library
  getCachedPipelineLayer: () => PipelineLayer | null;
  setCachedPipelineLayer: (v: PipelineLayer | null) => void;
  getCachedLibraryManifest: () => LibraryManifest | null;
  setCachedLibraryManifest: (v: LibraryManifest | null) => void;
  libraryCache: Map<string, LibraryManifest>;
  getRefreshManager: () => IncrementalRefreshManager | null;
  setRefreshManager: (v: IncrementalRefreshManager | null) => void;

  // Service toggles
  serviceEnabled: { llm: boolean; telegram: boolean; library: boolean };

  // Key functions
  attachToPane: (tmuxTarget: string) => Promise<string>;
  detachFromPane: () => void;
  startAgent: (projectPath: string, prompt?: string) => Promise<string>;
  stopAgent: () => void;
  handleEvent: (event: AVPEvent) => void;
  applyActivityUpdate: (update: { activity: string; detail?: string; options?: string[] }) => void;
}
