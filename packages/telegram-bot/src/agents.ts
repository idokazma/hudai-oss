export interface BotAgentDef {
  name: string;
  icon: string;
  subagentType: string;
}

export const BOT_AGENTS: BotAgentDef[] = [
  { name: 'Code Reviewer', icon: '🔎', subagentType: 'general-purpose' },
  { name: 'QA / Test Writer', icon: '🧪', subagentType: 'general-purpose' },
  { name: 'Refactor Scout', icon: '♻', subagentType: 'general-purpose' },
  { name: 'Security Auditor', icon: '🛡', subagentType: 'general-purpose' },
  { name: 'Explore', icon: '🔍', subagentType: 'Explore' },
  { name: 'Plan', icon: '📋', subagentType: 'Plan' },
];

export function buildSpawnPrompt(agent: BotAgentDef): string {
  const rolePrompts: Record<string, string> = {
    'Code Reviewer': 'Review the current codebase for code quality issues, potential bugs, and improvements. Focus on the most recently changed files.',
    'QA / Test Writer': 'Analyze the codebase and write tests for untested or under-tested code. Focus on critical paths and edge cases.',
    'Refactor Scout': 'Identify refactoring opportunities in the codebase. Look for code duplication, overly complex functions, and architectural improvements.',
    'Security Auditor': 'Perform a security audit of the codebase. Check for common vulnerabilities (OWASP top 10), insecure dependencies, and security best practices.',
    'Explore': 'Explore the codebase structure, understand the architecture, and provide a summary of key components and their relationships.',
    'Plan': 'Analyze the current state of the project and create an implementation plan for the next logical improvements or pending tasks.',
  };

  return rolePrompts[agent.name] ?? `Act as a ${agent.name} and analyze the current project.`;
}
