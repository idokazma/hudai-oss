import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CodebaseGraph, PipelineDefinition } from '@hudai/shared';
import type { PipelineStaleness } from './pipeline-cache.js';

const ENTRY_POINT_NAMES = ['index.ts', 'index.tsx', 'main.ts', 'main.tsx', 'app.ts', 'app.tsx', 'server.ts', 'App.tsx'];
const MAX_FILE_TREE_LINES = 200;
const MAX_CROSS_EDGES = 30;
const MAX_EXCERPT_LINES = 50;

/**
 * Build the LLM prompt from codebase graph data for pipeline analysis.
 */
export async function gatherPipelineContext(
  rootDir: string,
  graph: CodebaseGraph,
): Promise<string> {
  const sections: string[] = [];

  // 1. File tree grouped by container (or group)
  sections.push(buildFileTree(graph));

  // 2. Architecture containers
  if (graph.architecture) {
    sections.push(buildArchitectureSection(graph));
  }

  // 3. Cross-container import edges
  sections.push(buildCrossEdges(graph));

  // 4. Entry point excerpts
  const excerpts = await buildEntryPointExcerpts(rootDir, graph);
  if (excerpts) {
    sections.push(excerpts);
  }

  // 5. Output schema
  sections.push(buildOutputSchema());

  return sections.join('\n\n');
}

function buildFileTree(graph: CodebaseGraph): string {
  const lines: string[] = ['## File Tree'];
  const byGroup = new Map<string, string[]>();

  for (const node of graph.nodes) {
    const group = node.group || '.';
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)!.push(node.id);
  }

  let lineCount = 0;
  for (const [group, files] of byGroup) {
    if (lineCount >= MAX_FILE_TREE_LINES) {
      lines.push(`... (truncated, ${graph.nodes.length} total files)`);
      break;
    }
    lines.push(`\n### ${group}/`);
    lineCount++;
    for (const f of files) {
      if (lineCount >= MAX_FILE_TREE_LINES) break;
      lines.push(`  ${f}`);
      lineCount++;
    }
  }

  return lines.join('\n');
}

function buildArchitectureSection(graph: CodebaseGraph): string {
  const lines: string[] = ['## Architecture Containers'];
  const arch = graph.architecture!;

  for (const c of arch.containers) {
    lines.push(`- **${c.label}** (${c.id})${c.technology ? ` — ${c.technology}` : ''}`);
    lines.push(`  Groups: ${c.groups.join(', ')}`);
  }

  if (arch.relationships.length > 0) {
    lines.push('\n### Container Relationships');
    for (const r of arch.relationships) {
      lines.push(`- ${r.source} → ${r.target}: ${r.label}`);
    }
  }

  return lines.join('\n');
}

function buildCrossEdges(graph: CodebaseGraph): string {
  const lines: string[] = ['## Key Import Edges (cross-directory)'];

  // Filter for cross-group edges
  const nodeGroupMap = new Map<string, string>();
  for (const n of graph.nodes) nodeGroupMap.set(n.id, n.group);

  const crossEdges = graph.edges
    .filter(e => {
      const sg = nodeGroupMap.get(e.source);
      const tg = nodeGroupMap.get(e.target);
      return sg && tg && sg !== tg;
    })
    .slice(0, MAX_CROSS_EDGES);

  for (const e of crossEdges) {
    lines.push(`- ${e.source} → ${e.target}`);
  }

  if (crossEdges.length === 0) {
    lines.push('(no cross-directory imports found)');
  }

  return lines.join('\n');
}

async function buildEntryPointExcerpts(
  rootDir: string,
  graph: CodebaseGraph,
): Promise<string | null> {
  const entryNodes = graph.nodes.filter(n =>
    ENTRY_POINT_NAMES.includes(n.label),
  );

  if (entryNodes.length === 0) return null;

  const lines: string[] = ['## Entry Point Excerpts'];

  for (const node of entryNodes.slice(0, 5)) {
    try {
      const content = await readFile(path.join(rootDir, node.id), 'utf-8');
      const excerpt = content.split('\n').slice(0, MAX_EXCERPT_LINES).join('\n');
      lines.push(`\n### ${node.id}`);
      lines.push('```');
      lines.push(excerpt);
      lines.push('```');
    } catch {
      // Skip files we can't read
    }
  }

  return lines.length > 1 ? lines.join('\n') : null;
}

/**
 * Build a delta prompt for incremental pipeline updates.
 * Sends existing pipelines + changed files, asking LLM to patch only affected blocks.
 */
export async function gatherDeltaPipelineContext(
  rootDir: string,
  graph: CodebaseGraph,
  existingPipelines: PipelineDefinition[],
  staleness: PipelineStaleness,
): Promise<string> {
  const sections: string[] = [];

  // 1. Current pipeline state
  sections.push('## Current Pipelines (preserve unaffected pipelines exactly)\n```json\n' +
    JSON.stringify(existingPipelines, null, 2) + '\n```');

  // 2. Changed/added files with short excerpts
  const changedFiles = [...staleness.changed, ...staleness.added];
  const filesToShow = changedFiles.slice(0, 10);

  if (filesToShow.length > 0) {
    const excerptLines: string[] = ['## Changed/Added Files'];
    for (const filePath of filesToShow) {
      try {
        const content = await readFile(path.join(rootDir, filePath), 'utf-8');
        const excerpt = content.split('\n').slice(0, MAX_EXCERPT_LINES).join('\n');
        excerptLines.push(`\n### ${filePath}`);
        excerptLines.push('```');
        excerptLines.push(excerpt);
        excerptLines.push('```');
      } catch {
        excerptLines.push(`\n### ${filePath}\n(file not readable)`);
      }
    }
    sections.push(excerptLines.join('\n'));
  }

  // 3. Removed files
  if (staleness.removed.length > 0) {
    sections.push('## Removed Files\n' + staleness.removed.map(f => `- ${f}`).join('\n'));
  }

  // 4. File tree (for context on new files)
  sections.push(buildFileTree(graph));

  // 5. Delta-specific instructions
  sections.push(buildDeltaOutputSchema());

  return sections.join('\n\n');
}

function buildDeltaOutputSchema(): string {
  return `## Task

You are updating existing pipeline definitions based on file changes. The current pipelines are shown above.

**Rules:**
- Preserve unaffected pipelines EXACTLY as-is (same IDs, labels, descriptions, blocks, edges).
- Only update blocks whose \`files\` array overlaps with the changed/added/removed files listed above.
- If a removed file was the only file in a block, remove that block and its edges.
- If an added file belongs to an existing pipeline flow, add it to the appropriate block's \`files\` array or create a new block.
- Keep the same pipeline IDs — do NOT rename or re-ID existing pipelines.
- Return the COMPLETE updated array of all pipelines (not just the changed ones).

**Block quality requirements (same as full analysis):**
- \`description\` is REQUIRED for every block. Write 2-4 short bullet phrases separated by newlines (\\n), 5-10 words each. No "- " prefixes.
- \`technology\` is REQUIRED for every block.
- Edge \`label\` should describe what data flows along the edge.

Respond with ONLY a JSON array of PipelineDefinition objects. No explanation text.`;
}

function buildOutputSchema(): string {
  return `## Task

You are analyzing a codebase to identify **processing pipelines** — sequences of data transformations, event flows, request handling chains, or state management patterns.

For each pipeline you identify, output a JSON array of PipelineDefinition objects matching this TypeScript schema:

\`\`\`typescript
type PipelineCategory = 'event-driven' | 'state-management' | 'request-handling' | 'data-processing';
type PipelineBlockType = 'source' | 'transform' | 'sink' | 'branch' | 'merge';
type PipelineEdgeType = 'data' | 'control' | 'error';

interface PipelineBlock {
  id: string;          // unique within this pipeline
  label: string;       // human-readable name (concise, 2-4 words)
  blockType: PipelineBlockType;
  files: string[];     // relative file paths that implement this block
  technology: string;  // key tech used (e.g., "Express middleware", "Zustand", "WebSocket")
  description: string; // Newline-separated bullet list (no "- " prefix). Each bullet is a short phrase (5-10 words). 2-4 bullets: what it does, data in/out, key technique. Example: "Polls tmux capture-pane every 300ms\nDiffs against previous snapshot\nEmits new lines as raw strings"
}

interface PipelineEdge {
  id: string;          // unique within this pipeline
  source: string;      // block id
  target: string;      // block id
  label?: string;      // what flows along this edge
  edgeType: PipelineEdgeType;
}

interface PipelineDefinition {
  id: string;          // unique pipeline identifier (kebab-case)
  label: string;       // human-readable name
  category: PipelineCategory;
  description?: string;
  blocks: PipelineBlock[];
  edges: PipelineEdge[];
}
\`\`\`

**Guidelines:**
- Identify 2-5 major pipelines (don't over-segment).
- Each pipeline should have 3-8 blocks representing distinct processing stages.
- Use file paths from the file tree above — only reference files that actually exist.
- Focus on the main data/event flows, not every utility function.
- The \`files\` array in each block should list 1-4 files most relevant to that stage.
- Edge IDs should be unique within each pipeline (e.g., "e1", "e2", ...).
- Block IDs should be unique within each pipeline (e.g., kebab-case descriptive names).

**Block quality requirements:**
- \`description\` is REQUIRED for every block. Write 2-4 short bullet phrases separated by newlines (\\n). Each bullet should be 5-10 words — no full sentences. Cover: what it does, data in/out, key technique. Example: "Polls tmux capture-pane every 300ms\\nDiffs against previous snapshot\\nEmits new lines as raw strings". Do NOT use "- " bullet prefixes.
- \`technology\` is REQUIRED for every block. Name the specific library, protocol, or technique (e.g., "better-sqlite3 WAL mode", "regex state machine", "Zustand selector subscriptions").
- Edge \`label\` should describe what data flows along the edge (e.g., "raw terminal lines", "AVPEvent[]", "JSON config").

Respond with ONLY a JSON array of PipelineDefinition objects. No explanation text.`;
}
