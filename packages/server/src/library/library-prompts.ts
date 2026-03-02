import type { FileCard, ModuleShelf, ProjectOverview } from '@hudai/shared';

const MAX_FILE_CHARS = 15_000;

/**
 * Build a prompt for generating FileCards from a batch of source files.
 * Each file is truncated at MAX_FILE_CHARS to stay within context limits.
 */
export function buildFileCardPrompt(
  files: { filePath: string; content: string }[],
): string {
  const fileBlocks = files.map(f => {
    const truncated = f.content.length > MAX_FILE_CHARS
      ? f.content.slice(0, MAX_FILE_CHARS) + '\n// ... truncated ...'
      : f.content;
    return `### ${f.filePath}\n\`\`\`\n${truncated}\n\`\`\``;
  }).join('\n\n');

  return `You are a code analyst. Analyze these source files and produce a JSON array of file summaries.

For each file, produce an object with these fields:
- filePath (string): exact path as given
- purpose (string): one-line description of what this file does
- exports (string[]): named exports / public API (function names, class names, type names)
- keyLogic (string): 2-3 sentence summary of the key logic and algorithms
- dependencies (string[]): imported modules (just the import path strings)
- sideEffects (string[]): side effects like "writes to disk", "modifies global state", "starts server" — empty array if pure
- gotchas (string[]): non-obvious things an agent should know — empty array if none

Return ONLY a JSON array. No markdown, no explanation.

${fileBlocks}`;
}

/**
 * Build a prompt for generating a ModuleShelf from file card summaries.
 */
export function buildModuleShelfPrompt(
  moduleName: string,
  dirPrefix: string,
  fileCards: FileCard[],
  dependencyEdges: { from: string; to: string }[],
): string {
  const cardSummaries = fileCards.map(c =>
    `- **${c.filePath}**: ${c.purpose}\n  Exports: ${c.exports.join(', ') || 'none'}\n  Key: ${c.keyLogic}`
  ).join('\n');

  const deps = dependencyEdges.length > 0
    ? `\nCross-module dependencies:\n${dependencyEdges.map(e => `  ${e.from} → ${e.to}`).join('\n')}`
    : '';

  return `You are a code architect. Synthesize this module from its file summaries.

Module: "${moduleName}" (directory: ${dirPrefix})

File summaries:
${cardSummaries}
${deps}

Produce a JSON object with these fields:
- name (string): human-readable module name
- purpose (string): 2-4 sentence description of what this module does and why it exists
- patterns (string[]): architectural patterns used (e.g., "observer pattern", "cache-then-LLM", "event emitter")
- publicApi (array of {name, filePath, kind}): key exports other modules should use. "kind" is one of: function, class, type, const, component, other
- dependsOn (string[]): names of other modules this one depends on (inferred from dependencies)

Return ONLY a JSON object. No markdown, no explanation.`;
}

/**
 * Build a prompt for generating the project overview from module shelves.
 */
export function buildOverviewPrompt(
  modules: ModuleShelf[],
  packageJson: { name?: string; scripts?: Record<string, string>; description?: string } | null,
  directoryTree: string,
): string {
  const moduleSummaries = modules.map(m =>
    `### ${m.name} (${m.dirPrefix})\n${m.purpose}\nPatterns: ${m.patterns.join(', ') || 'none'}\nPublic API: ${m.publicApi.map(a => a.name).join(', ') || 'none'}`
  ).join('\n\n');

  const scripts = packageJson?.scripts
    ? Object.entries(packageJson.scripts).map(([k, v]) => `  ${k}: ${v}`).join('\n')
    : 'none';

  return `You are a senior software architect. Produce a concise project overview from these module summaries.

Project: ${packageJson?.name ?? 'Unknown'}
${packageJson?.description ? `Description: ${packageJson.description}` : ''}

Directory structure:
${directoryTree}

Build/run scripts:
${scripts}

Modules:
${moduleSummaries}

Produce a JSON object with these fields:
- name (string): project name
- description (string): 2-3 sentence project description for an agent encountering this codebase for the first time
- stack (string[]): tech stack items (e.g., "React 19", "Fastify 5", "SQLite")
- architectureStyle (string): one of "monorepo", "microservices", "monolith", "library", "cli-tool"
- patterns (string[]): cross-cutting patterns (e.g., "event-driven", "tmux integration", "WebSocket push")
- entryPoints (string[]): main entry point files
- scripts (object): key npm scripts mapped to descriptions
- directoryMap (string): concise ASCII directory map with 1-line annotations

Return ONLY a JSON object. No markdown, no explanation.`;
}

/**
 * Build a delta prompt for incrementally updating the project overview.
 * Only sends changed module summaries, asks LLM to patch affected fields.
 */
export function buildDeltaOverviewPrompt(
  existingOverview: ProjectOverview,
  changedModules: ModuleShelf[],
  unchangedModuleNames: string[],
  packageJson: { name?: string; scripts?: Record<string, string>; description?: string } | null,
  directoryTree: string,
): string {
  const changedSummaries = changedModules.map(m =>
    `### ${m.name} (${m.dirPrefix}) [CHANGED]\n${m.purpose}\nPatterns: ${m.patterns.join(', ') || 'none'}\nPublic API: ${m.publicApi.map(a => a.name).join(', ') || 'none'}`
  ).join('\n\n');

  const unchangedList = unchangedModuleNames.length > 0
    ? `Unchanged modules (not shown): ${unchangedModuleNames.join(', ')}`
    : '';

  return `You are a senior software architect. Update an existing project overview based on module changes.

## Current Overview
\`\`\`json
${JSON.stringify(existingOverview, null, 2)}
\`\`\`

## Changed Modules
${changedSummaries}

${unchangedList}

Directory structure:
${directoryTree}

**Rules:**
- Update ONLY fields affected by the changed modules above.
- Preserve all other fields exactly as they are in the current overview.
- If the changes are minor (e.g., internal logic changes in one module), the overview likely stays the same.
- Only update \`stack\`, \`patterns\`, or \`description\` if the changes materially affect them.

Produce a JSON object with these fields:
- name (string): project name
- description (string): 2-3 sentence project description
- stack (string[]): tech stack items
- architectureStyle (string): one of "monorepo", "microservices", "monolith", "library", "cli-tool"
- patterns (string[]): cross-cutting patterns
- entryPoints (string[]): main entry point files
- scripts (object): key npm scripts mapped to descriptions
- directoryMap (string): concise ASCII directory map with 1-line annotations

Return ONLY a JSON object. No markdown, no explanation.`;
}
