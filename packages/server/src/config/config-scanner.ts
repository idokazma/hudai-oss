import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { SkillFile, AgentDefinition, AgentConfig } from '@hudai/shared';
import { readMergedSettings } from './settings-reader.js';

/**
 * Parse simple YAML frontmatter from a markdown file.
 * Returns key-value pairs from the --- delimited block.
 */
function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return result;

  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && value) result[key] = value;
  }
  return result;
}

async function scanMarkdownDir(
  dirPath: string,
  scope: 'project' | 'global'
): Promise<Array<{ name: string; path: string; scope: 'project' | 'global'; description?: string; disabled?: boolean }>> {
  const items: Array<{ name: string; path: string; scope: 'project' | 'global'; description?: string; disabled?: boolean }> = [];

  try {
    const files = await readdir(dirPath);
    for (const file of files) {
      const isDisabled = file.endsWith('.md.disabled');
      if (!file.endsWith('.md') && !isDisabled) continue;
      const filePath = join(dirPath, file);
      const nameBase = isDisabled ? basename(file, '.md.disabled') : basename(file, '.md');
      try {
        const content = await readFile(filePath, 'utf-8');
        const fm = parseFrontmatter(content);
        items.push({
          name: fm.name || nameBase,
          path: filePath,
          scope,
          description: fm.description,
          ...(isDisabled ? { disabled: true } : {}),
        });
      } catch {
        // Skip unreadable files
        items.push({
          name: nameBase,
          path: filePath,
          scope,
          ...(isDisabled ? { disabled: true } : {}),
        });
      }
    }
  } catch {
    // Directory doesn't exist — that's fine
  }

  return items;
}

export async function scanSkills(projectPath: string): Promise<SkillFile[]> {
  const projectSkills = await scanMarkdownDir(join(projectPath, '.claude', 'skills'), 'project');
  const globalSkills = await scanMarkdownDir(join(homedir(), '.claude', 'skills'), 'global');
  return [...projectSkills, ...globalSkills];
}

export async function scanAgents(projectPath: string): Promise<AgentDefinition[]> {
  const projectAgents = await scanMarkdownDir(join(projectPath, '.claude', 'agents'), 'project');
  const globalAgents = await scanMarkdownDir(join(homedir(), '.claude', 'agents'), 'global');

  // Also add built-in agent types
  const builtins: AgentDefinition[] = [
    { name: 'Explore', path: '(built-in)', scope: 'global', description: 'Fast codebase exploration' },
    { name: 'Plan', path: '(built-in)', scope: 'global', description: 'Implementation planning' },
    { name: 'Bash', path: '(built-in)', scope: 'global', description: 'Command execution' },
    { name: 'general-purpose', path: '(built-in)', scope: 'global', description: 'Multi-step tasks' },
  ];

  return [...builtins, ...projectAgents, ...globalAgents];
}

export async function buildAgentConfig(projectPath: string): Promise<AgentConfig> {
  const [skills, agents, settings] = await Promise.all([
    scanSkills(projectPath),
    scanAgents(projectPath),
    readMergedSettings(projectPath),
  ]);

  return {
    skills,
    agents,
    mcpServers: settings.mcpServers,
    hooks: settings.hooks,
    permissions: settings.permissions,
    settingsOrigin: settings.settingsOrigin,
  };
}
