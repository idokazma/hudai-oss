import type { PermissionRule } from '@hudai/shared';

/**
 * Simple glob matching for permission rules.
 * Supports patterns like "Bash(npm *)", "Edit(src/**)", "Read"
 */
function matchesRule(toolName: string, toolArgs: Record<string, any>, rule: PermissionRule): boolean {
  const ruleStr = rule.tool;

  // Check if rule has arguments pattern: "Tool(pattern)"
  const match = ruleStr.match(/^(\w+)\((.+)\)$/);
  if (match) {
    const [, ruleTool, rulePattern] = match;
    if (ruleTool !== toolName) return false;

    // Get the primary argument to match against
    const argValue = getPrimaryArg(toolName, toolArgs);
    if (!argValue) return false;

    return simpleGlobMatch(rulePattern, argValue);
  }

  // Simple tool name match (no arguments)
  return ruleStr === toolName;
}

function getPrimaryArg(toolName: string, args: Record<string, any>): string | null {
  switch (toolName) {
    case 'Bash':
      return args.command ?? null;
    case 'Read':
    case 'Edit':
    case 'Write':
      return args.file_path ?? null;
    case 'Grep':
    case 'Glob':
      return args.pattern ?? null;
    default:
      return null;
  }
}

/**
 * Simple glob matching: supports * (any chars) and ** (any path)
 */
function simpleGlobMatch(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<DOUBLESTAR>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<DOUBLESTAR>>/g, '.*');

  try {
    return new RegExp(`^${escaped}$`).test(value);
  } catch {
    return false;
  }
}

export function matchPermission(
  toolName: string,
  toolArgs: Record<string, any>,
  rules: PermissionRule[],
): { status: 'allowed' | 'prompted' | 'denied'; rule?: string } {
  // Check deny rules first
  for (const rule of rules) {
    if (rule.type === 'deny' && matchesRule(toolName, toolArgs, rule)) {
      return { status: 'denied', rule: rule.tool };
    }
  }

  // Check allow rules
  for (const rule of rules) {
    if (rule.type === 'allow' && matchesRule(toolName, toolArgs, rule)) {
      return { status: 'allowed', rule: rule.tool };
    }
  }

  // Default: prompted
  return { status: 'prompted' };
}
