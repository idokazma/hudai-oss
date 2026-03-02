import type { PermissionSuggestion } from '@hudai/shared';

/**
 * Tracks how often each tool is prompted for permission,
 * and generates suggestions for tools that are frequently prompted.
 */
export class PermissionStats {
  private promptCounts = new Map<string, number>();
  private suggestedTools = new Set<string>();

  recordPrompt(tool: string): void {
    const count = (this.promptCounts.get(tool) ?? 0) + 1;
    this.promptCounts.set(tool, count);
  }

  /**
   * Returns suggestions for tools that have been prompted
   * more than `threshold` times and haven't been suggested yet.
   */
  getNewSuggestions(threshold = 3): PermissionSuggestion[] {
    const suggestions: PermissionSuggestion[] = [];
    for (const [tool, count] of this.promptCounts) {
      if (count >= threshold && !this.suggestedTools.has(tool)) {
        this.suggestedTools.add(tool);
        suggestions.push({
          tool,
          promptCount: count,
          suggestedRule: tool,
        });
      }
    }
    return suggestions;
  }

  clear(): void {
    this.promptCounts.clear();
    this.suggestedTools.clear();
  }
}
