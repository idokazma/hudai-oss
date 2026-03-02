import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ModuleShelf, ProjectOverview } from '@hudai/shared';
import { buildOverviewPrompt, buildDeltaOverviewPrompt } from './library-prompts.js';
import type { LLMClient } from '../llm/llm-provider.js';

export class OverviewBuilder {
  constructor(private llm: LLMClient) {}

  async build(
    rootDir: string,
    modules: ModuleShelf[],
    directoryTree: string,
  ): Promise<ProjectOverview> {
    const packageJson = await this.readPackageJson(rootDir);

    const prompt = buildOverviewPrompt(modules, packageJson, directoryTree);
    const responseText = await this.llm.generate(prompt + '\n\nRespond with valid JSON only.');

    const parsed = JSON.parse(this.stripCodeFences(responseText));

    return this.parseOverview(parsed, packageJson);
  }

  async buildIncremental(
    rootDir: string,
    existingOverview: ProjectOverview,
    allShelves: ModuleShelf[],
    changedModuleSlugs: string[],
    directoryTree: string,
  ): Promise<ProjectOverview> {
    const packageJson = await this.readPackageJson(rootDir);

    const changedSet = new Set(changedModuleSlugs);
    const changedModules = allShelves.filter(m => changedSet.has(m.slug));
    const unchangedModuleNames = allShelves
      .filter(m => !changedSet.has(m.slug))
      .map(m => m.name);

    const prompt = buildDeltaOverviewPrompt(
      existingOverview,
      changedModules,
      unchangedModuleNames,
      packageJson,
      directoryTree,
    );

    const responseText = await this.llm.generate(prompt + '\n\nRespond with valid JSON only.');

    const parsed = JSON.parse(this.stripCodeFences(responseText));
    const llmOverview = this.parseOverview(parsed, packageJson);

    // Field-level merge: use cached overview as base, only accept meaningful changes
    return this.mergeOverview(existingOverview, llmOverview);
  }

  /**
   * Merge LLM-generated overview with cached overview at field level.
   * Stable fields (name, architectureStyle) prefer cached unless structurally different.
   * Evolving fields (stack, patterns, description) accept LLM if materially different.
   */
  private mergeOverview(
    cached: ProjectOverview,
    llm: ProjectOverview,
  ): ProjectOverview {
    return {
      // Stable: almost never changes from a few file edits
      name: cached.name,
      architectureStyle: cached.architectureStyle,

      // Semi-stable: only accept if entries were added/removed (not just reworded)
      entryPoints: this.mergeStringArray(cached.entryPoints, llm.entryPoints),
      scripts: this.hasNewKeys(cached.scripts, llm.scripts) ? llm.scripts : cached.scripts,

      // Evolving: accept if the LLM added/removed items
      stack: this.mergeStringArray(cached.stack, llm.stack),
      patterns: this.mergeStringArray(cached.patterns, llm.patterns),

      // Free text: accept LLM version only if meaningfully different
      description: this.textMeaningfullyChanged(cached.description, llm.description)
        ? llm.description : cached.description,
      directoryMap: this.textMeaningfullyChanged(cached.directoryMap, llm.directoryMap)
        ? llm.directoryMap : cached.directoryMap,
    };
  }

  /**
   * Merge string arrays: accept LLM version only if items were added or removed.
   * Reordering or minor rewording of the same items → keep cached.
   */
  private mergeStringArray(cached: string[], llm: string[]): string[] {
    const cachedNorm = new Set(cached.map(s => s.toLowerCase().trim()));
    const llmNorm = new Set(llm.map(s => s.toLowerCase().trim()));

    // Check if there are genuinely new or removed entries
    const added = [...llmNorm].filter(s => !cachedNorm.has(s));
    const removed = [...cachedNorm].filter(s => !llmNorm.has(s));

    if (added.length === 0 && removed.length === 0) {
      return cached; // Same items, possibly reordered — keep cached
    }

    return llm; // Structural change — accept LLM version
  }

  /**
   * Check if a text field changed meaningfully (not just minor rewording).
   * Uses length difference + overlap as a rough heuristic.
   */
  private textMeaningfullyChanged(cached: string, llm: string): boolean {
    if (!cached && !llm) return false;
    if (!cached || !llm) return true;

    // Significant length change (>20%) likely means meaningful change
    const lenDiff = Math.abs(cached.length - llm.length) / Math.max(cached.length, 1);
    if (lenDiff > 0.2) return true;

    // Check word-level overlap
    const cachedWords = new Set(cached.toLowerCase().split(/\s+/));
    const llmWords = new Set(llm.toLowerCase().split(/\s+/));
    const overlap = [...cachedWords].filter(w => llmWords.has(w)).length;
    const overlapRatio = overlap / Math.max(cachedWords.size, 1);

    // Less than 70% word overlap = meaningfully different
    return overlapRatio < 0.7;
  }

  /** Check if the LLM scripts object has keys not in cached */
  private hasNewKeys(cached: Record<string, string>, llm: Record<string, string>): boolean {
    const cachedKeys = new Set(Object.keys(cached));
    return Object.keys(llm).some(k => !cachedKeys.has(k));
  }

  private async readPackageJson(rootDir: string): Promise<{ name?: string; scripts?: Record<string, string>; description?: string } | null> {
    try {
      const raw = await readFile(path.join(rootDir, 'package.json'), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private stripCodeFences(text: string): string {
    let t = text.trim();
    if (t.startsWith('```')) {
      t = t.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    return t;
  }

  private parseOverview(
    parsed: any,
    packageJson: { name?: string; scripts?: Record<string, string>; description?: string } | null,
  ): ProjectOverview {
    return {
      name: parsed.name ?? packageJson?.name ?? 'Unknown Project',
      description: parsed.description ?? '',
      stack: Array.isArray(parsed.stack) ? parsed.stack : [],
      architectureStyle: parsed.architectureStyle ?? 'monolith',
      patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
      entryPoints: Array.isArray(parsed.entryPoints) ? parsed.entryPoints : [],
      scripts: parsed.scripts && typeof parsed.scripts === 'object' ? parsed.scripts : {},
      directoryMap: parsed.directoryMap ?? '',
    };
  }
}
