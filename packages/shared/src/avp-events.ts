export type AVPCategory =
  | 'navigation'
  | 'mutation'
  | 'execution'
  | 'reasoning'
  | 'testing'
  | 'control';

export interface AVPEventBase {
  id: string;
  sessionId: string;
  timestamp: number;
  category: AVPCategory;
  type: string;
  source?: 'tmux' | 'transcript' | 'plan-file';
  /** Agent ID if this event comes from a sub-agent */
  agentId?: string;
  /** Parent agent ID (null/undefined for root agent) */
  parentAgentId?: string;
  /** Nesting depth (0 = root) */
  agentDepth?: number;
  /** Permission status for this tool call */
  permission?: {
    status: 'allowed' | 'prompted' | 'denied';
    rule?: string;
  };
}

// Navigation events

export interface FileReadEvent extends AVPEventBase {
  category: 'navigation';
  type: 'file.read';
  data: {
    path: string;
    lineCount?: number;
  };
}

export interface SearchGrepEvent extends AVPEventBase {
  category: 'navigation';
  type: 'search.grep';
  data: {
    pattern: string;
    matchCount: number;
    files: string[];
  };
}

export interface SearchGlobEvent extends AVPEventBase {
  category: 'navigation';
  type: 'search.glob';
  data: {
    pattern: string;
    matchCount: number;
    files: string[];
  };
}

// Mutation events

export interface FileEditEvent extends AVPEventBase {
  category: 'mutation';
  type: 'file.edit';
  data: {
    path: string;
    additions: number;
    deletions: number;
    summary?: string;
  };
}

export interface FileCreateEvent extends AVPEventBase {
  category: 'mutation';
  type: 'file.create';
  data: {
    path: string;
    lineCount: number;
  };
}

export interface FileDeleteEvent extends AVPEventBase {
  category: 'mutation';
  type: 'file.delete';
  data: {
    path: string;
  };
}

// Execution events

export interface ShellRunEvent extends AVPEventBase {
  category: 'execution';
  type: 'shell.run';
  data: {
    command: string;
    cwd?: string;
  };
}

export interface ShellOutputEvent extends AVPEventBase {
  category: 'execution';
  type: 'shell.output';
  data: {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    durationMs: number;
  };
}

// Reasoning events

export interface ThinkStartEvent extends AVPEventBase {
  category: 'reasoning';
  type: 'think.start';
  data: {
    summary?: string;
    /** Full length of the thinking block in characters */
    fullLength?: number;
  };
}

export interface ThinkEndEvent extends AVPEventBase {
  category: 'reasoning';
  type: 'think.end';
  data: {
    durationMs: number;
    summary?: string;
  };
}

export interface PlanUpdateEvent extends AVPEventBase {
  category: 'reasoning';
  type: 'plan.update';
  data: {
    steps: string[];
    currentStep: number;
    /** File paths associated with each step (from plan file parsing) */
    stepFiles?: string[][];
    /** Detailed descriptions per step (from Gemini analysis) */
    stepDescriptions?: string[];
    /** Path to the plan .md file (when detected from ~/.claude/plans/) */
    planFile?: string;
  };
}

// Testing events

export interface TestRunEvent extends AVPEventBase {
  category: 'testing';
  type: 'test.run';
  data: {
    command: string;
    framework?: string;
  };
}

export interface TestResultEvent extends AVPEventBase {
  category: 'testing';
  type: 'test.result';
  data: {
    passed: number;
    failed: number;
    total: number;
    failures: Array<{ name: string; file?: string; message: string }>;
    durationMs: number;
  };
}

// Control events

export interface TaskStartEvent extends AVPEventBase {
  category: 'control';
  type: 'task.start';
  data: {
    prompt: string;
  };
}

export interface TaskCompleteEvent extends AVPEventBase {
  category: 'control';
  type: 'task.complete';
  data: {
    summary?: string;
  };
}

export interface AgentErrorEvent extends AVPEventBase {
  category: 'control';
  type: 'agent.error';
  data: {
    message: string;
    raw?: string;
  };
}

// Permission prompt — agent is waiting for user approval
export interface PermissionPromptEvent extends AVPEventBase {
  category: 'control';
  type: 'permission.prompt';
  data: {
    tool: string;
    command: string;
  };
}

// Question — agent is asking the user a question (AskUserQuestion)
export interface QuestionAskEvent extends AVPEventBase {
  category: 'control';
  type: 'question.ask';
  data: {
    question: string;
    options: string[];
    toolUseId: string;
  };
}

export interface QuestionAnsweredEvent extends AVPEventBase {
  category: 'control';
  type: 'question.answered';
  data: {
    toolUseId: string;
    answer?: string;
  };
}

// Detail level — collapsed content detected
export interface DetailCollapsedEvent extends AVPEventBase {
  category: 'control';
  type: 'detail.collapsed';
  data: {
    hint: string;
  };
}

// Sub-agent events

export interface SubagentStartEvent extends AVPEventBase {
  category: 'control';
  type: 'subagent.start';
  data: {
    agentId: string;
    agentType: string;
    prompt: string;
    parentAgentId: string | null;
    background?: boolean;
  };
}

export interface SubagentEndEvent extends AVPEventBase {
  category: 'control';
  type: 'subagent.end';
  data: {
    agentId: string;
    agentType: string;
    result?: string;
    durationMs: number;
    eventCount: number;
  };
}

// Tool completion event — generic result for any tool
export interface ToolCompleteEvent extends AVPEventBase {
  category: 'execution';
  type: 'tool.complete';
  data: {
    toolName: string;
    toolUseId: string;
    durationMs: number;
    resultSummary?: string;
  };
}

// Memory file change event
export interface MemoryChangeEvent extends AVPEventBase {
  category: 'control';
  type: 'memory.change';
  data: {
    path: string;
    changeType: 'edit' | 'create';
    memoryType: string;
  };
}

// Context compaction event
export interface CompactionEvent extends AVPEventBase {
  category: 'control';
  type: 'context.compaction';
  data: {
    preTokens: number;
    trigger: string;
    /** Distribution of event types before compaction */
    eventDistribution?: Record<string, number>;
    /** Total event count before compaction */
    eventCountBefore?: number;
  };
}

// Loop warning — detected repeated action pattern
export interface LoopWarningEvent extends AVPEventBase {
  category: 'control';
  type: 'loop.warning';
  data: {
    pattern: string;
    count: number;
    windowMs: number;
  };
}

// Raw output fallback
export interface RawOutputEvent extends AVPEventBase {
  category: 'control';
  type: 'raw.output';
  data: {
    text: string;
  };
}

export type AVPEvent =
  | FileReadEvent
  | SearchGrepEvent
  | SearchGlobEvent
  | FileEditEvent
  | FileCreateEvent
  | FileDeleteEvent
  | ShellRunEvent
  | ShellOutputEvent
  | ThinkStartEvent
  | ThinkEndEvent
  | PlanUpdateEvent
  | TestRunEvent
  | TestResultEvent
  | TaskStartEvent
  | TaskCompleteEvent
  | AgentErrorEvent
  | PermissionPromptEvent
  | QuestionAskEvent
  | QuestionAnsweredEvent
  | SubagentStartEvent
  | SubagentEndEvent
  | ToolCompleteEvent
  | MemoryChangeEvent
  | CompactionEvent
  | LoopWarningEvent
  | DetailCollapsedEvent
  | RawOutputEvent;
