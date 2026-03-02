import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { McpServer, HookEntry, PermissionRule } from '@hudai/shared';

interface RawSettings {
  mcpServers?: Record<string, { command: string; args?: string[] }>;
  hooks?: Record<string, Array<{ matcher?: string; command: string | string[]; timeout?: number }>>;
  permissions?: Record<string, { allow?: string[]; deny?: string[] } | string[]>;
  allowedTools?: string[];
  denyTools?: string[];
}

export interface MergedSettings {
  mcpServers: McpServer[];
  hooks: HookEntry[];
  permissions: PermissionRule[];
  settingsOrigin: { global: boolean; project: boolean; local: boolean };
}

async function readJsonSafe(path: string): Promise<RawSettings | null> {
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function extractMcpServers(raw: RawSettings): McpServer[] {
  if (!raw.mcpServers) return [];
  return Object.entries(raw.mcpServers).map(([name, config]) => ({
    name,
    command: config.command,
    args: config.args,
    status: 'configured' as const,
  }));
}

function extractHooks(raw: RawSettings): HookEntry[] {
  if (!raw.hooks) return [];
  const entries: HookEntry[] = [];
  for (const [event, hooks] of Object.entries(raw.hooks)) {
    for (const hook of hooks) {
      entries.push({
        event,
        matcher: hook.matcher,
        command: Array.isArray(hook.command) ? hook.command.join(' ') : hook.command,
        timeout: hook.timeout,
      });
    }
  }
  return entries;
}

function extractPermissions(raw: RawSettings, scope: 'global' | 'project' | 'local'): PermissionRule[] {
  const rules: PermissionRule[] = [];

  // Handle allowedTools / denyTools (flat arrays)
  if (raw.allowedTools) {
    for (const tool of raw.allowedTools) {
      rules.push({ type: 'allow', tool, scope });
    }
  }
  if (raw.denyTools) {
    for (const tool of raw.denyTools) {
      rules.push({ type: 'deny', tool, scope });
    }
  }

  // Handle permissions object — two formats:
  // Flat: { "permissions": { "allow": ["Bash(npm *)"], "deny": ["Bash(sudo *)"] } }
  // Per-tool: { "permissions": { "Bash": { "allow": ["npm *"], "deny": ["sudo *"] } } }
  if (raw.permissions) {
    // Detect flat format: top-level "allow" or "deny" keys with array values
    if (Array.isArray(raw.permissions.allow)) {
      for (const tool of raw.permissions.allow) {
        rules.push({ type: 'allow', tool, scope });
      }
    }
    if (Array.isArray(raw.permissions.deny)) {
      for (const tool of raw.permissions.deny) {
        rules.push({ type: 'deny', tool, scope });
      }
    }

    // Per-tool format
    for (const [tool, config] of Object.entries(raw.permissions)) {
      if (tool === 'allow' || tool === 'deny') continue;
      if (config && typeof config === 'object' && !Array.isArray(config)) {
        if (config.allow) {
          for (const pattern of config.allow) {
            rules.push({ type: 'allow', tool: `${tool}(${pattern})`, scope });
          }
        }
        if (config.deny) {
          for (const pattern of config.deny) {
            rules.push({ type: 'deny', tool: `${tool}(${pattern})`, scope });
          }
        }
      }
    }
  }

  return rules;
}

export async function readMergedSettings(projectPath: string): Promise<MergedSettings> {
  const globalPath = join(homedir(), '.claude', 'settings.json');
  const globalLocalPath = join(homedir(), '.claude', 'settings.local.json');
  const projectSettingsPath = join(projectPath, '.claude', 'settings.json');
  const projectLocalPath = join(projectPath, '.claude', 'settings.local.json');

  const [global, globalLocal, project, projectLocal] = await Promise.all([
    readJsonSafe(globalPath),
    readJsonSafe(globalLocalPath),
    readJsonSafe(projectSettingsPath),
    readJsonSafe(projectLocalPath),
  ]);

  // Merge global + global local into one effective global settings
  const local = globalLocal;
  // projectLocal holds session-granted permissions for this project

  // Merge MCP servers (project overrides global)
  const mcpServers = [
    ...extractMcpServers(global ?? {}),
    ...extractMcpServers(project ?? {}),
  ];
  // Deduplicate by name (project wins)
  const mcpMap = new Map(mcpServers.map((s) => [s.name, s]));

  // Merge hooks
  const hooks = [
    ...extractHooks(global ?? {}),
    ...extractHooks(project ?? {}),
  ];

  // Merge permissions
  const permissions = [
    ...extractPermissions(global ?? {}, 'global'),
    ...extractPermissions(local ?? {}, 'local'),
    ...extractPermissions(project ?? {}, 'project'),
    ...extractPermissions(projectLocal ?? {}, 'local'),
  ];

  return {
    mcpServers: [...mcpMap.values()],
    hooks,
    permissions,
    settingsOrigin: {
      global: global !== null,
      project: project !== null,
      local: local !== null || projectLocal !== null,
    },
  };
}

/**
 * Toggle a permission rule in the project's .claude/settings.local.json.
 * When enabled=true, adds the rule; when enabled=false, removes it.
 */
export async function writePermissionToggle(
  projectPath: string,
  tool: string,
  type: 'allow' | 'deny',
  enabled: boolean,
): Promise<void> {
  const dir = join(projectPath, '.claude');
  const filePath = join(dir, 'settings.local.json');

  // Read existing or start fresh
  let settings: Record<string, unknown> = {};
  try {
    const content = await readFile(filePath, 'utf-8');
    settings = JSON.parse(content);
  } catch {
    // File doesn't exist yet — that's fine
  }

  // Ensure permissions.allow / permissions.deny arrays exist
  if (!settings.permissions || typeof settings.permissions !== 'object') {
    settings.permissions = {};
  }
  const perms = settings.permissions as Record<string, unknown>;
  if (!Array.isArray(perms[type])) {
    perms[type] = [];
  }
  const arr = perms[type] as string[];

  if (enabled) {
    // Add if not already present
    if (!arr.includes(tool)) {
      arr.push(tool);
    }
  } else {
    // Remove
    const idx = arr.indexOf(tool);
    if (idx !== -1) {
      arr.splice(idx, 1);
    }
  }

  // Write back
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}
