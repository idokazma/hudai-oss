import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FileCard } from '@hudai/shared';
import { buildFileCardPrompt } from './library-prompts.js';
import type { LLMClient } from '../llm/llm-provider.js';

const BATCH_SIZE = 6;
const MIN_LINES = 10;

/** Files to skip — test fixtures, non-code configs, lockfiles */
const SKIP_PATTERNS = [
  /\.test\.(ts|tsx|js|jsx)$/,
  /\.spec\.(ts|tsx|js|jsx)$/,
  /\/__tests__\//,
  /\/fixtures?\//,
  /\/mocks?\//,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /tsconfig\.json$/,
  /\.eslintrc/,
  /\.prettierrc/,
  /vite\.config/,
  /turbo\.json$/,
];

function shouldSkip(filePath: string): boolean {
  return SKIP_PATTERNS.some(p => p.test(filePath));
}

export type ProgressCallback = (current: number, total: number) => void;

export class FileCardBuilder {
  constructor(private llm: LLMClient) {}

  /**
   * Build file cards for a list of file paths.
   * Reads files, batches them, and calls LLM for each batch.
   */
  async build(
    rootDir: string,
    filePaths: string[],
    onProgress?: ProgressCallback,
  ): Promise<FileCard[]> {
    // Filter out files that should be skipped
    const eligible = filePaths.filter(f => !shouldSkip(f));

    // Read file contents and filter by minimum line count
    const filesWithContent: { filePath: string; content: string }[] = [];
    for (const fp of eligible) {
      try {
        const content = await readFile(path.join(rootDir, fp), 'utf-8');
        const lineCount = content.split('\n').length;
        if (lineCount >= MIN_LINES) {
          filesWithContent.push({ filePath: fp, content });
        }
      } catch {
        // File might not be readable — skip
      }
    }

    const allCards: FileCard[] = [];
    const total = filesWithContent.length;
    let processed = 0;

    // Process in batches
    for (let i = 0; i < filesWithContent.length; i += BATCH_SIZE) {
      const batch = filesWithContent.slice(i, i + BATCH_SIZE);
      const prompt = buildFileCardPrompt(batch);

      try {
        const responseText = await this.llm.generate(prompt + '\n\nRespond with valid JSON only.');

        let jsonText = responseText.trim();
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }

        const parsed = JSON.parse(jsonText);
        const cards: FileCard[] = Array.isArray(parsed) ? parsed : parsed.cards ?? parsed.files ?? [];

        // Validate and normalize each card
        for (const card of cards) {
          if (!card.filePath || typeof card.filePath !== 'string') continue;
          allCards.push({
            filePath: card.filePath,
            mtimeMs: 0, // Will be set by caller
            purpose: card.purpose ?? '',
            exports: Array.isArray(card.exports) ? card.exports : [],
            keyLogic: card.keyLogic ?? '',
            dependencies: Array.isArray(card.dependencies) ? card.dependencies : [],
            sideEffects: Array.isArray(card.sideEffects) ? card.sideEffects : [],
            gotchas: Array.isArray(card.gotchas) ? card.gotchas : [],
          });
        }
      } catch (err) {
        console.error(`[library] Failed to analyze batch starting at ${batch[0]?.filePath}:`, err);
      }

      processed += batch.length;
      onProgress?.(Math.min(processed, total), total);
    }

    return allCards;
  }
}
