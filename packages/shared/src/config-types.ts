export interface SkillFile {
  name: string;
  path: string;
  scope: 'project' | 'global';
  description?: string;
  /** Skill file exists but is disabled (.md.disabled) */
  disabled?: boolean;
}

export interface AgentDefinition {
  name: string;
  path: string;
  scope: 'project' | 'global';
  description?: string;
}

export interface McpServer {
  name: string;
  command: string;
  args?: string[];
  status: 'configured' | 'unknown';
}

export interface HookEntry {
  event: string;
  matcher?: string;
  command: string;
  timeout?: number;
}

export interface PermissionRule {
  type: 'allow' | 'deny';
  tool: string;
  scope: 'project' | 'global' | 'local';
}

export interface PermissionSuggestion {
  tool: string;
  promptCount: number;
  suggestedRule: string;
}

export interface AgentConfig {
  skills: SkillFile[];
  agents: AgentDefinition[];
  mcpServers: McpServer[];
  hooks: HookEntry[];
  permissions: PermissionRule[];
  settingsOrigin: {
    global: boolean;
    project: boolean;
    local: boolean;
  };
}

/** A built-in skill template that Hudai can install into a project */
export interface BuiltinSkillTemplate {
  id: string;
  name: string;
  description: string;
  filename: string;
  content: string;
}
