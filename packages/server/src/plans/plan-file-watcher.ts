import { EventEmitter } from 'events';
import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { projectDir } from '../persistence/data-dir.js';
import type { AVPEvent, PlanFileSummary } from '@hudai/shared';
import type { LLMProvider } from '../llm/llm-provider.js';

/**
 * Analyzes plan markdown files from ~/.claude/plans/ using Gemini to extract
 * structured implementation steps.
 *
 * Does NOT proactively scan the plans directory — that would pick up plans from
 * other Claude Code sessions/projects. Instead, it only processes plan files
 * when explicitly requested by the terminal parser (which detects plan file
 * references in the attached tmux pane's output).
 *
 * Session-scoped plan detection happens through:
 * 1. TranscriptWatcher — reads JSONL, emits plan.update for TodoWrite/TaskCreate
 * 2. ClaudeCodeParser — detects plan file names in terminal, calls analyzeFile()
 */
export class PlanFileWatcher extends EventEmitter {
  private sessionId: string;
  private gemini: LLMProvider;
  private plansDir: string;
  private projectRoot: string | null;
  private stopped = false;
  /** Track which files we've already processed (by path + mtime) */
  private processedFiles = new Map<string, number>();
  /** Last emitted plan key for dedup */
  private lastPlanKey = '';

  constructor(sessionId: string, gemini: LLMProvider, projectRoot?: string) {
    super();
    this.sessionId = sessionId;
    this.gemini = gemini;
    this.plansDir = join(homedir(), '.claude', 'plans');
    this.projectRoot = projectRoot ?? null;
  }

  async start(): Promise<void> {
    // No-op: we no longer scan or watch the plans directory proactively.
    // Plan files are only analyzed when explicitly requested via analyzeFile().
  }

  /**
   * Analyze a specific plan file by name (e.g. detected from terminal output).
   * This is the ONLY entry point — ensures we only process plans from the
   * attached session's Claude Code instance.
   */
  async analyzeFile(filename: string): Promise<void> {
    if (filename.startsWith('/')) {
      await this.processFile(filename);
      return;
    }
    // Check project-scoped .claude/plans/ first, then global ~/.claude/plans/
    if (this.projectRoot) {
      const projectPath = join(this.projectRoot, '.claude', 'plans', filename);
      try {
        await stat(projectPath);
        await this.processFile(projectPath);
        return;
      } catch {
        // Not in project dir, fall through to global
      }
    }
    await this.processFile(join(this.plansDir, filename));
  }

  private async processFile(filePath: string): Promise<void> {
    if (this.stopped) return;

    try {
      const s = await stat(filePath);
      const prevMtime = this.processedFiles.get(filePath);
      if (prevMtime && prevMtime >= s.mtimeMs) return; // already processed this version
      this.processedFiles.set(filePath, s.mtimeMs);

      const content = await readFile(filePath, 'utf-8');
      if (content.length < 50) return; // too short to be a real plan

      // Mirror plan file into project-scoped Hudai data dir
      await this.copyToProject(filePath);

      const steps = await this.analyzePlanWithGemini(content);
      if (!steps || steps.length < 2) return; // not a meaningful plan

      // Dedup: don't re-emit identical plans
      const planKey = steps.map((s) => s.label).join('|');
      if (planKey === this.lastPlanKey) return;
      this.lastPlanKey = planKey;

      const planName = basename(filePath, '.md');
      console.log(`[plan-watcher] Analyzed plan "${planName}" with ${steps.length} steps`);

      this.emit('event', {
        id: crypto.randomUUID(),
        sessionId: this.sessionId,
        timestamp: Date.now(),
        category: 'reasoning',
        type: 'plan.update',
        source: 'plan-file',
        data: {
          steps: steps.map((s) => s.label),
          currentStep: 0,
          planFile: filePath,
          stepFiles: steps.map((s) => s.files),
          stepDescriptions: steps.map((s) => s.description),
        },
      } as AVPEvent);
    } catch {
      // File read error
    }
  }

  /**
   * Send the plan markdown to Gemini and get back structured steps.
   */
  private async analyzePlanWithGemini(content: string): Promise<{ label: string; files: string[]; description: string }[] | null> {
    const prompt = `You are analyzing an AI agent's implementation plan written in markdown.

Extract the ordered implementation steps from this plan. For each step provide:
- "label": concise action title (under 80 chars)
- "description": 2-3 sentence explanation of what this step does, why it matters, and key details
- "files": array of file paths involved

Return ONLY a JSON array, no markdown fences, no explanation. Example format:
[{"label": "Add auth middleware", "description": "Create JWT validation middleware that checks tokens on protected routes. This is the security foundation that all subsequent API changes depend on.", "files": ["src/middleware/auth.ts"]}]

If you cannot extract meaningful steps, return an empty array [].

Plan markdown:
${content.slice(0, 8000)}`;

    const response = await this.gemini.ask(prompt, 'Analyzing plan');
    if (!response) return null;

    try {
      // Strip markdown code fences if Gemini wraps the response
      const cleaned = response.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return null;

      return parsed
        .filter((item: any) => item && typeof item.label === 'string' && item.label.length > 3)
        .map((item: any) => ({
          label: item.label.slice(0, 100),
          description: typeof item.description === 'string' ? item.description.slice(0, 500) : '',
          files: Array.isArray(item.files) ? item.files.filter((f: any) => typeof f === 'string') : [],
        }));
    } catch {
      console.error('[plan-watcher] Failed to parse Gemini response');
      return null;
    }
  }

  /**
   * Copy a plan file into the project-scoped Hudai data dir so it's easy to
   * browse plans relevant to a specific project.
   * Destination: ~/.hudai/projects/<hash>/plans/<filename>
   */
  private async copyToProject(filePath: string): Promise<void> {
    if (!this.projectRoot) return;
    try {
      const plansDir = join(projectDir(this.projectRoot), 'plans');
      await mkdir(plansDir, { recursive: true });
      const dest = join(plansDir, basename(filePath));
      await copyFile(filePath, dest);
      console.log(`[plan-watcher] Copied plan to project: ${dest}`);
    } catch {
      // Non-critical — don't block plan processing
    }
  }

  /**
   * Find a plan file by matching a title string against the first heading
   * of each .md file in ~/.claude/plans/. Returns the filename if found.
   * Used by the parser when it detects a plan title in the terminal but not
   * the file path itself.
   */
  async findByTitle(title: string): Promise<string | null> {
    if (!title || title.length < 5) return null;

    const needle = normalizeTitle(title);
    if (!needle) return null;

    try {
      const files = await readdir(this.plansDir);
      const mdFiles = files.filter((f) => f.endsWith('.md'));

      for (const file of mdFiles) {
        try {
          const filePath = join(this.plansDir, file);
          // Only read the first 200 bytes — the title is on line 1
          const fd = await readFile(filePath, 'utf-8');
          const firstLine = fd.slice(0, 200).split('\n')[0] ?? '';
          const heading = normalizeTitle(firstLine);
          if (heading && heading.includes(needle)) {
            return file;
          }
        } catch {
          // skip unreadable files
        }
      }
    } catch {
      // plans dir doesn't exist
    }
    return null;
  }

  /**
   * List plan files from both project-scoped and global directories.
   * Project plans (<projectRoot>/.claude/plans/) come first, then global
   * (~/.claude/plans/), deduped by filename. Works without Gemini.
   */
  async listPlans(): Promise<PlanFileSummary[]> {
    const seen = new Set<string>();
    const plans: PlanFileSummary[] = [];

    // Collect from a directory with a given source tag
    const collectFrom = async (dir: string, source: 'project' | 'global') => {
      try {
        const files = await readdir(dir);
        for (const file of files.filter((f) => f.endsWith('.md'))) {
          if (seen.has(file)) continue;
          seen.add(file);
          try {
            const filePath = join(dir, file);
            const s = await stat(filePath);
            const content = await readFile(filePath, 'utf-8');
            const firstLine = content.slice(0, 300).split('\n')[0] ?? '';
            const title = firstLine.replace(/^#+\s*/, '').replace(/^Plan:\s*/i, '').trim() || file;
            plans.push({ filename: file, title, modifiedAt: s.mtimeMs, source });
          } catch {
            // skip unreadable files
          }
        }
      } catch {
        // dir doesn't exist
      }
    };

    // Project-scoped plans first (higher priority)
    if (this.projectRoot) {
      await collectFrom(join(this.projectRoot, '.claude', 'plans'), 'project');
    }
    // Then global plans
    await collectFrom(this.plansDir, 'global');

    // Sort each group by mtime descending, project plans always first
    plans.sort((a, b) => {
      if (a.source !== b.source) return a.source === 'project' ? -1 : 1;
      return b.modifiedAt - a.modifiedAt;
    });

    return plans;
  }

  stop(): void {
    this.stopped = true;
    this.processedFiles.clear();
  }
}

/** Strip markdown heading prefix, "Plan:", and lowercase for comparison */
function normalizeTitle(raw: string): string {
  return raw
    .replace(/^#+\s*/, '')       // strip markdown heading
    .replace(/^Plan:\s*/i, '')   // strip "Plan:" prefix
    .replace(/[^\w\s]/g, '')     // strip punctuation
    .trim()
    .toLowerCase();
}
