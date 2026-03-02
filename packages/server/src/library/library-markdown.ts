import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LibraryManifest, ModuleShelf, ProjectOverview } from '@hudai/shared';

/**
 * Generate agent-readable markdown files from the library manifest.
 */
export async function generateMarkdown(
  libraryDir: string,
  manifest: LibraryManifest,
): Promise<void> {
  // Ensure directories exist
  const modulesDir = path.join(libraryDir, 'modules');
  await mkdir(modulesDir, { recursive: true });

  // Generate OVERVIEW.md
  const overviewMd = buildOverviewMarkdown(manifest.overview, manifest.modules);
  await writeFile(path.join(libraryDir, 'OVERVIEW.md'), overviewMd, 'utf-8');

  // Generate per-module markdown
  for (const mod of manifest.modules) {
    const moduleMd = buildModuleMarkdown(mod);
    await writeFile(path.join(modulesDir, `${mod.slug}.md`), moduleMd, 'utf-8');
  }
}

function buildOverviewMarkdown(overview: ProjectOverview, modules: ModuleShelf[]): string {
  const lines: string[] = [];

  lines.push(`# ${overview.name}`);
  lines.push('');
  lines.push(overview.description);
  lines.push('');

  // Stack
  lines.push('## Tech Stack');
  lines.push('');
  for (const tech of overview.stack) {
    lines.push(`- ${tech}`);
  }
  lines.push('');

  // Architecture
  lines.push(`## Architecture: ${overview.architectureStyle}`);
  lines.push('');

  // Patterns
  if (overview.patterns.length > 0) {
    lines.push('## Key Patterns');
    lines.push('');
    for (const pattern of overview.patterns) {
      lines.push(`- ${pattern}`);
    }
    lines.push('');
  }

  // Entry points
  if (overview.entryPoints.length > 0) {
    lines.push('## Entry Points');
    lines.push('');
    for (const ep of overview.entryPoints) {
      lines.push(`- \`${ep}\``);
    }
    lines.push('');
  }

  // Scripts
  if (Object.keys(overview.scripts).length > 0) {
    lines.push('## Scripts');
    lines.push('');
    lines.push('| Command | Description |');
    lines.push('|---------|-------------|');
    for (const [cmd, desc] of Object.entries(overview.scripts)) {
      lines.push(`| \`${cmd}\` | ${desc} |`);
    }
    lines.push('');
  }

  // Directory map
  if (overview.directoryMap) {
    lines.push('## Directory Map');
    lines.push('');
    lines.push('```');
    lines.push(overview.directoryMap);
    lines.push('```');
    lines.push('');
  }

  // Module index
  lines.push('## Modules');
  lines.push('');
  lines.push('| Module | Directory | Files | Description |');
  lines.push('|--------|-----------|-------|-------------|');
  for (const mod of modules) {
    lines.push(`| [${mod.name}](modules/${mod.slug}.md) | \`${mod.dirPrefix}\` | ${mod.fileCards.length} | ${mod.purpose.split('.')[0]}. |`);
  }
  lines.push('');

  return lines.join('\n');
}

function buildModuleMarkdown(mod: ModuleShelf): string {
  const lines: string[] = [];

  lines.push(`# ${mod.name}`);
  lines.push('');
  lines.push(`> Directory: \`${mod.dirPrefix}\``);
  lines.push('');
  lines.push(mod.purpose);
  lines.push('');

  // Patterns
  if (mod.patterns.length > 0) {
    lines.push('## Patterns');
    lines.push('');
    for (const p of mod.patterns) {
      lines.push(`- ${p}`);
    }
    lines.push('');
  }

  // Public API
  if (mod.publicApi.length > 0) {
    lines.push('## Public API');
    lines.push('');
    lines.push('| Name | Kind | File |');
    lines.push('|------|------|------|');
    for (const api of mod.publicApi) {
      lines.push(`| \`${api.name}\` | ${api.kind} | \`${api.filePath}\` |`);
    }
    lines.push('');
  }

  // Dependencies
  if (mod.dependsOn.length > 0) {
    lines.push('## Dependencies');
    lines.push('');
    for (const dep of mod.dependsOn) {
      lines.push(`- ${dep}`);
    }
    lines.push('');
  }

  // File cards
  lines.push('## Files');
  lines.push('');
  for (const card of mod.fileCards) {
    lines.push(`### \`${card.filePath}\``);
    lines.push('');
    lines.push(card.purpose);
    lines.push('');

    if (card.exports.length > 0) {
      lines.push(`**Exports:** ${card.exports.map(e => `\`${e}\``).join(', ')}`);
      lines.push('');
    }

    if (card.keyLogic) {
      lines.push(`**Key logic:** ${card.keyLogic}`);
      lines.push('');
    }

    if (card.gotchas.length > 0) {
      lines.push('**Gotchas:**');
      for (const g of card.gotchas) {
        lines.push(`- ${g}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
