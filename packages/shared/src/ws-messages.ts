import type { AVPEvent } from './avp-events.js';
import type { SteeringCommand } from './commands.js';
import type { AgentConfig, PermissionSuggestion } from './config-types.js';
import type { TokenState } from './token-types.js';
import type { CodebaseGraph, FileNode } from './graph-types.js';
import type { PipelineLayer, PipelineBlock } from './pipeline-types.js';
import type { InsightSummary, InsightIntent, InsightNotification } from './insight-types.js';
import type { LibraryBuildProgress, ProjectOverview, ModuleShelf } from './library-types.js';
import type { ChatMessage } from './chat-types.js';

// Session summary for history listing
export interface SessionSummary {
  id: string;
  projectPath: string;
  startedAt: number;
  endedAt: number | null;
  status: string;
  eventCount: number;
}

// Swarm snapshot — compact per-session summary for cross-session awareness
export interface SwarmSnapshot {
  sessionId: string;
  projectPath: string;
  projectName: string;
  startedAt: number;
  status: string;
  eventCount: number;
  lastEventType?: string;
  lastEventAt?: number;
  isAttached: boolean;
  lastIntent?: string;
}

// Server -> Client

export type ServerMessage =
  | { kind: 'event'; event: AVPEvent }
  | { kind: 'graph.full'; graph: CodebaseGraph }
  | { kind: 'graph.update'; updates: Partial<FileNode>[] }
  | { kind: 'session.state'; state: SessionState }
  | { kind: 'replay.events'; events: AVPEvent[] }
  | { kind: 'sessions.list'; sessions: SessionSummary[] }
  | { kind: 'panes.list'; panes: TmuxPane[] }
  | { kind: 'pane.content'; content: string; caret?: { x: number; lineIndex: number } | null }
  | { kind: 'file.content'; path: string; content: string; error?: string }
  | { kind: 'file.write.result'; path: string; success: boolean; error?: string }
  | { kind: 'config.full'; config: AgentConfig }
  | { kind: 'permission.suggestion'; suggestion: PermissionSuggestion }
  | { kind: 'tokens.state'; state: TokenState }
  | { kind: 'pipeline.full'; layer: PipelineLayer }
  | { kind: 'pipeline.update'; updates: { blockId: string; patch: Partial<PipelineBlock> }[] }
  | { kind: 'pipeline.analyzing'; status: 'started' | 'complete' }
  | { kind: 'insight.summary'; summary: InsightSummary }
  | { kind: 'insight.intent'; intent: InsightIntent }
  | { kind: 'insight.notification'; notification: InsightNotification }
  | { kind: 'library.clear' }
  | { kind: 'library.progress'; progress: LibraryBuildProgress }
  | { kind: 'library.ready'; overview: ProjectOverview; moduleCount: number; fileCardCount: number }
  | { kind: 'library.manifest'; overview: ProjectOverview; modules: ModuleShelf[] }
  | { kind: 'chat.message'; message: ChatMessage }
  | { kind: 'chat.history'; messages: ChatMessage[] }
  | { kind: 'chat.typing'; typing: boolean }
  | { kind: 'settings.keys'; keys: { geminiApiKey: boolean; openaiApiKey: boolean; claudeApiKey: boolean; telegramBotToken: boolean } }
  | { kind: 'settings.saved'; success: boolean; error?: string; keys: { geminiApiKey: boolean; openaiApiKey: boolean; claudeApiKey: boolean; telegramBotToken: boolean } }
  | { kind: 'settings.advisor'; verbosity: AdvisorVerbosity }
  | { kind: 'settings.advisorScope'; scope: AdvisorScope }
  | { kind: 'settings.advisorPrompts'; systemPrompt: string; proactivePrompt: string; isCustom: boolean }
  | { kind: 'settings.advisorContext'; context: string }
  | { kind: 'plans.list'; plans: PlanFileSummary[] }
  | { kind: 'preview.ready'; proxyPort: number; targetUrl: string }
  | { kind: 'preview.error'; error: string }
  | { kind: 'service.status'; services: { llm: boolean; telegram: boolean; library: boolean } }
  | { kind: 'swarm.status'; sessions: SwarmSnapshot[] }
  | { kind: 'generate.result'; type: 'skill' | 'agent'; name: string; filename: string; content: string; success: boolean; error?: string }
  | { kind: 'error'; message: string };

export interface TmuxPane {
  id: string;
  title: string;
  command: string;
}

// Client -> Server

export type ClientMessage =
  | { kind: 'command'; command: SteeringCommand }
  | { kind: 'replay.request'; sessionId: string; from: number; to: number }
  | { kind: 'sessions.list' }
  | { kind: 'session.attach'; tmuxTarget: string }
  | { kind: 'session.detach' }
  | { kind: 'session.create'; projectPath: string; prompt?: string; sessionName?: string }
  | { kind: 'session.clone'; tmuxTarget: string; sessionName?: string; prompt?: string }
  | { kind: 'panes.list' }
  | { kind: 'file.read'; path: string }
  | { kind: 'file.write'; path: string; content: string }
  | { kind: 'insight.requestSummary' }
  | { kind: 'library.rebuild' }
  | { kind: 'library.request' }
  | { kind: 'skill.install'; skillId: string }
  | { kind: 'skill.disable'; path: string }
  | { kind: 'skill.enable'; path: string }
  | { kind: 'chat.send'; text: string }
  | { kind: 'chat.requestHistory' }
  | { kind: 'settings.saveKeys'; keys: { geminiApiKey?: string; openaiApiKey?: string; claudeApiKey?: string; telegramBotToken?: string } }
  | { kind: 'settings.getKeys' }
  | { kind: 'settings.advisor'; verbosity: AdvisorVerbosity }
  | { kind: 'settings.advisorScope'; scope: AdvisorScope }
  | { kind: 'settings.getAdvisorPrompts' }
  | { kind: 'settings.saveAdvisorPrompts'; systemPrompt?: string; proactivePrompt?: string }
  | { kind: 'settings.resetAdvisorPrompts' }
  | { kind: 'settings.getAdvisorContext' }
  | { kind: 'plans.list' }
  | { kind: 'plans.load'; filename: string }
  | { kind: 'preview.start'; url: string }
  | { kind: 'preview.stop' }
  | { kind: 'service.toggle'; service: 'llm' | 'telegram' | 'library'; enabled: boolean }
  | { kind: 'swarm.status' }
  | { kind: 'session.kill'; tmuxTarget: string }
  | { kind: 'permission.toggle'; tool: string; type: 'allow' | 'deny'; enabled: boolean }
  | { kind: 'generate.skill'; description: string }
  | { kind: 'generate.agent'; description: string }
  | { kind: 'generate.save'; type: 'skill' | 'agent'; filename: string; content: string };

export type AgentActivity =
  | 'working'           // Actively processing (thinking, tool use, etc.)
  | 'waiting_permission' // Permission prompt — needs approve/reject
  | 'waiting_input'     // Idle ❯ prompt — done, waiting for next instruction
  | 'waiting_answer';   // Asking a question with numbered options

export interface PlanFileSummary {
  filename: string;   // "stateful-wishing-waffle.md"
  title: string;      // "ABC Fun! — 5 New Features Plan"
  modifiedAt: number; // mtime ms
  source: 'project' | 'global'; // project = .claude/plans/, global = ~/.claude/plans/
}

export type AdvisorVerbosity = 'quiet' | 'normal' | 'verbose';

export type AdvisorScope = 'session' | 'global';

export type LlmStatus = 'unavailable' | 'connected' | 'thinking' | 'error';

export interface SessionState {
  sessionId: string;
  status: 'idle' | 'running' | 'paused' | 'complete' | 'error';
  agentCurrentFile: string | null;
  taskLabel: string;
  startedAt: number;
  eventCount: number;
  transcriptPath?: string;
  agentActivity?: AgentActivity;
  /** Context for the current activity (e.g., question text, permission tool) */
  agentActivityDetail?: string;
  /** Options for the current activity (e.g., question choices) */
  agentActivityOptions?: string[];
  /** Active sub-agent breadcrumb trail: ['Main', 'Explore', 'Glob'] */
  agentBreadcrumb?: string[];
  /** Count of currently active sub-agents */
  activeSubagentCount?: number;
  /** Current tmux target pane ID (e.g. "lettersAgent:0.0") */
  tmuxTarget?: string;
  /** LLM (Gemini) connection status */
  llmStatus?: LlmStatus;
  /** Current LLM activity label (e.g. "Analyzing plan", "Generating insight") */
  llmActivity?: string | null;
}
