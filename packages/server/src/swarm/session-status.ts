import type { AgentActivity } from '@hudai/shared';
import type { JsonlEntry, JsonlContentBlock } from '../transcript/jsonl-to-avp.js';
import type { ActivityUpdate } from '../hooks/hooks-handler.js';

/**
 * Session status derived from JSONL entries.
 */
export interface SessionStatus {
  activity: AgentActivity;
  detail?: string;
  options?: string[];
  currentFile?: string;
}

interface PendingTool {
  name: string;
  timestamp: number;
  input: Record<string, any>;
}

/**
 * Tools that typically require user permission approval.
 * When these are pending and JSONL goes stale, we infer waiting_permission.
 * Read/Grep/Glob are typically auto-approved.
 */
const PERMISSION_LIKELY_TOOLS = new Set([
  'Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'NotebookEdit',
]);

/** Stale timeout: if a tool is pending and JSONL hasn't grown in this long, assume permission/stall */
const STALE_TOOL_TIMEOUT_MS = 15_000;
/** Idle timeout: if last entry was text-only assistant and no new entry in this long, assume idle */
const IDLE_TIMEOUT_MS = 5_000;

/**
 * StatusDetector — Infers agent activity from raw JSONL entries.
 *
 * State machine:
 *   user entry              → working (processing input)
 *   assistant + tool_use    → working (tool executing)
 *   assistant + AskUser     → waiting_answer
 *   assistant text-only     → potentially idle (timer)
 *   stale pending tool      → waiting_permission (heuristic)
 *   idle timer expired      → waiting_input
 *   hook override           → immediate status set
 */
export class StatusDetector {
  private pendingTools = new Map<string, PendingTool>();
  private status: SessionStatus = { activity: 'working' };
  private lastEntryAt = 0;
  private potentiallyIdle = false;
  private hookOverride: SessionStatus | null = null;
  private staleTimer: ReturnType<typeof setInterval> | null = null;

  /** Callback when status changes */
  onChange?: (status: SessionStatus) => void;

  start(): void {
    // Check for stale tools / idle every 2 seconds
    this.staleTimer = setInterval(() => this.checkStale(), 2_000);
  }

  stop(): void {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
  }

  getStatus(): SessionStatus {
    return this.hookOverride ?? this.status;
  }

  /**
   * Apply an immediate status override from the hooks system.
   * Takes priority over JSONL-derived state until the next JSONL entry.
   */
  applyHookUpdate(update: ActivityUpdate): void {
    this.hookOverride = {
      activity: update.activity,
      detail: update.detail,
      options: update.options,
      currentFile: this.status.currentFile,
    };
    this.emitChange();
  }

  /**
   * Process a raw JSONL entry and update status accordingly.
   */
  processEntry(entry: JsonlEntry): void {
    const now = Date.now();
    this.lastEntryAt = now;
    // Clear hook override on new JSONL activity (JSONL is authoritative)
    this.hookOverride = null;
    this.potentiallyIdle = false;

    if (entry.type === 'user') {
      // Skip system injections (task-notification, system-reminder)
      const content = entry.message?.content;
      if (typeof content === 'string' && (content.trimStart().startsWith('<task-notification') || content.trimStart().startsWith('<system-reminder'))) {
        return;
      }
      this.processUserEntry(entry);
    } else if (entry.type === 'assistant') {
      this.processAssistantEntry(entry);
    } else if (entry.type === 'progress') {
      this.processProgressEntry(entry);
    }
    // system, file-history-snapshot, etc. don't affect status
  }

  private processUserEntry(entry: JsonlEntry): void {
    const content = entry.message?.content;

    // Check for tool_result blocks (user entries carry tool results)
    if (Array.isArray(content)) {
      let hasToolResult = false;
      for (const block of content) {
        if (block.type === 'tool_result' && 'tool_use_id' in block) {
          this.pendingTools.delete(block.tool_use_id);
          hasToolResult = true;
        }
      }
      // If this is a plain user message (no tool_results), the conversation
      // has moved on — any pending tools from earlier are abandoned
      if (!hasToolResult) {
        this.pendingTools.clear();
      }
    } else {
      // Plain text user entry — clear any stale pending tools
      this.pendingTools.clear();
    }

    // User entry means agent is processing
    this.setStatus({ activity: 'working', currentFile: this.status.currentFile });
  }

  private processAssistantEntry(entry: JsonlEntry): void {
    const content = entry.message?.content;
    if (!Array.isArray(content)) return;

    let hasToolUse = false;
    let askUserTool: JsonlContentBlock | null = null;

    for (const block of content) {
      if (block.type === 'tool_use') {
        hasToolUse = true;
        const toolBlock = block as { type: 'tool_use'; id: string; name: string; input: Record<string, any> };

        // Track pending tool
        this.pendingTools.set(toolBlock.id, {
          name: toolBlock.name,
          timestamp: Date.now(),
          input: toolBlock.input || {},
        });

        // Track current file from file-related tools
        const filePath = toolBlock.input?.file_path || toolBlock.input?.path;
        if (filePath && typeof filePath === 'string') {
          this.status.currentFile = filePath;
        }

        // Detect AskUserQuestion
        if (toolBlock.name === 'AskUserQuestion') {
          askUserTool = block;
        }
      }
    }

    if (askUserTool) {
      const input = (askUserTool as any).input || {};
      this.setStatus({
        activity: 'waiting_answer',
        detail: input.question || 'Agent is asking a question',
        options: Array.isArray(input.options) ? input.options : undefined,
        currentFile: this.status.currentFile,
      });
      return;
    }

    if (hasToolUse) {
      // Tool is executing
      const lastTool = Array.from(this.pendingTools.values()).pop();
      this.setStatus({
        activity: 'working',
        detail: lastTool ? `Running ${lastTool.name}` : undefined,
        currentFile: this.status.currentFile,
      });
      return;
    }

    // Text-only assistant message — agent may be done or about to send more
    this.potentiallyIdle = true;
    this.setStatus({
      activity: 'working',
      currentFile: this.status.currentFile,
    });
  }

  private processProgressEntry(entry: JsonlEntry): void {
    // Progress entries wrap assistant/user messages during tool execution
    const inner = entry.data?.message?.message;
    if (!inner) return;

    const content = inner.content;
    if (!Array.isArray(content)) return;

    for (const block of content) {
      if (block.type === 'tool_result' && 'tool_use_id' in block) {
        this.pendingTools.delete(block.tool_use_id);
      }
      if (block.type === 'tool_use') {
        const toolBlock = block as { type: 'tool_use'; id: string; name: string; input: Record<string, any> };
        this.pendingTools.set(toolBlock.id, {
          name: toolBlock.name,
          timestamp: Date.now(),
          input: toolBlock.input || {},
        });
      }
    }

    // Progress means agent is actively working
    if (this.status.activity !== 'waiting_answer') {
      this.setStatus({ activity: 'working', currentFile: this.status.currentFile });
    }
  }

  /**
   * Periodic check for stale state.
   * - Pending tool with no result for stale timeout → likely waiting_permission
   * - Text-only assistant with no follow-up for idle timeout → waiting_input
   */
  private checkStale(): void {
    if (this.hookOverride) return; // hooks are authoritative
    const now = Date.now();
    const sinceLast = now - this.lastEntryAt;

    // Check for stale pending tools → permission heuristic
    if (this.pendingTools.size > 0 && sinceLast >= STALE_TOOL_TIMEOUT_MS) {
      // Find the oldest pending permission-likely tool
      for (const [, tool] of this.pendingTools) {
        if (PERMISSION_LIKELY_TOOLS.has(tool.name) && now - tool.timestamp >= STALE_TOOL_TIMEOUT_MS) {
          const command = tool.input?.command || tool.input?.file_path || tool.input?.description || '';
          const detail = command
            ? `${tool.name}: ${String(command).slice(0, 300)}`
            : `Approval needed: ${tool.name}`;
          this.setStatus({
            activity: 'waiting_permission',
            detail,
            currentFile: this.status.currentFile,
          });
          return;
        }
      }
    }

    // Check for idle → waiting_input
    if (this.potentiallyIdle && sinceLast >= IDLE_TIMEOUT_MS && this.pendingTools.size === 0) {
      this.setStatus({
        activity: 'waiting_input',
        detail: 'Agent is idle — waiting for instructions',
        currentFile: this.status.currentFile,
      });
    }
  }

  private setStatus(newStatus: SessionStatus): void {
    const changed = newStatus.activity !== this.status.activity ||
      newStatus.detail !== this.status.detail;
    this.status = newStatus;
    if (changed) {
      this.emitChange();
    }
  }

  private emitChange(): void {
    if (this.onChange) {
      this.onChange(this.getStatus());
    }
  }

  reset(): void {
    this.pendingTools.clear();
    this.status = { activity: 'working' };
    this.lastEntryAt = 0;
    this.potentiallyIdle = false;
    this.hookOverride = null;
  }
}
