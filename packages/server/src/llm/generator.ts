import type { LLMProvider } from './llm-provider.js';

export interface GenerateResult {
  filename: string;
  name: string;
  content: string;
}

const SKILL_SYSTEM_PROMPT = `You are an expert at writing Claude Code skill files.

A skill file is a markdown file with YAML frontmatter that defines reusable instructions for Claude Code.

Format:
---
name: "<short name>"
description: "<one-line description>"
---

<markdown body with behavioral instructions, constraints, and examples>

Guidelines:
- The name should be short, lowercase, kebab-case (e.g. "test-runner", "api-docs")
- The description should be a brief one-liner
- The body should contain clear, actionable instructions that Claude Code will follow
- Include specific patterns, conventions, or rules the skill enforces
- Available tools Claude Code can use: Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch
- Do NOT include the --- delimiters in your explanation, only in the actual file content

Return ONLY the complete markdown file content (frontmatter + body), nothing else.`;

const AGENT_SYSTEM_PROMPT = `You are an expert at writing Claude Code agent/subagent definition files.

An agent file is a markdown file with YAML frontmatter that defines a specialized sub-agent.

Format:
---
name: "<agent name>"
description: "<one-line description>"
tools: "<comma-separated list of tools>"
model: "<model name>"
---

<markdown body with the agent's role definition, capabilities, and behavioral instructions>

Guidelines:
- The name should be descriptive, PascalCase or kebab-case (e.g. "CodeReviewer", "test-helper")
- Available tools: Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch
- Available models: sonnet, opus, haiku
  - Use "haiku" for fast, simple tasks
  - Use "sonnet" for balanced quality/speed (default)
  - Use "opus" for complex reasoning tasks
- The body should define the agent's role, what it specializes in, and how it should behave
- Include specific instructions for the agent's domain of expertise

Return ONLY the complete markdown file content (frontmatter + body), nothing else.`;

function toFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') + '.md';
}

function extractName(content: string): string {
  const match = content.match(/^---\n[\s\S]*?name:\s*["']?([^"'\n]+)["']?\s*\n[\s\S]*?\n---/);
  return match?.[1]?.trim() || 'untitled';
}

export async function generateSkill(
  gemini: LLMProvider,
  description: string,
): Promise<GenerateResult | null> {
  const prompt = `${SKILL_SYSTEM_PROMPT}\n\nUser request: ${description}`;
  const result = await gemini.ask(prompt, 'Generating skill');
  if (!result) return null;

  // Strip markdown code fences if present
  const content = result.replace(/^```(?:markdown|md|yaml)?\n/, '').replace(/\n```\s*$/, '');
  const name = extractName(content);
  return { filename: toFilename(name), name, content };
}

export async function generateAgent(
  gemini: LLMProvider,
  description: string,
): Promise<GenerateResult | null> {
  const prompt = `${AGENT_SYSTEM_PROMPT}\n\nUser request: ${description}`;
  const result = await gemini.ask(prompt, 'Generating agent');
  if (!result) return null;

  const content = result.replace(/^```(?:markdown|md|yaml)?\n/, '').replace(/\n```\s*$/, '');
  const name = extractName(content);
  return { filename: toFilename(name), name, content };
}
