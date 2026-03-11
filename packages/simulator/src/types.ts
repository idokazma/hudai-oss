/** A hook notification to POST to the server */
export interface HookNotification {
  matcher: 'permission_prompt' | 'idle_prompt' | 'elicitation_dialog';
  tool?: string;
  command?: string;
  message?: string;
  question?: string;
  options?: string[];
}

/** A single step: append JSONL entries to the transcript after a delay */
export interface ScenarioStep {
  /** Delay in ms from the previous step */
  delay: number;
  /** JSONL entries to append (Claude Code transcript format) */
  entries: JsonlEntry[];
  /** Optional label for logging */
  label?: string;
  /** Hook notifications to POST to the server alongside JSONL entries */
  hooks?: HookNotification[];
}

/** A Claude Code JSONL transcript entry */
export interface JsonlEntry {
  type: 'assistant' | 'user' | 'progress' | 'system';
  uuid?: string;
  parentUuid?: string;
  timestamp?: string;
  sessionId?: string;
  subtype?: string;
  message?: {
    role?: string;
    content?: ContentBlock[] | string;
    model?: string;
    id?: string;
    stop_reason?: string | null;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  compactMetadata?: {
    trigger?: string;
    preTokens?: number;
  };
  data?: {
    message?: {
      type?: string;
      timestamp?: string;
      message?: {
        role?: string;
        content?: ContentBlock[];
        model?: string;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        };
      };
    };
  };
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
  | { type: 'tool_result'; tool_use_id: string; content?: string | ContentBlock[] };

/** A complete scenario */
export interface Scenario {
  name: string;
  description: string;
  /** The project path this simulates (for the TranscriptWatcher slug) */
  projectPath: string;
  /** Timed sequence of JSONL entries */
  timeline: ScenarioStep[];
}
