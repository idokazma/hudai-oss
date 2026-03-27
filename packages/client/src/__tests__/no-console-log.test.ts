import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Phase 3 cleanup: verify that debug console.log statements have been removed
 * from production code. console.error and console.warn are allowed.
 */

const CLIENT_SRC = path.resolve(__dirname, '..');

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(CLIENT_SRC, relativePath), 'utf-8');
}

function findConsoleLogLines(content: string): number[] {
  const lines = content.split('\n');
  const matches: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Skip comments
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
    if (line.includes('console.log(')) {
      matches.push(i + 1);
    }
  }
  return matches;
}

describe('no debug console.log in production code', () => {
  it('JourneyPanel.tsx has no console.log', () => {
    const content = readFile('components/BuildQueue/JourneyPanel.tsx');
    const logLines = findConsoleLogLines(content);
    expect(logLines, `console.log found on lines: ${logLines.join(', ')}`).toHaveLength(0);
  });

  it('ws-client.ts has no console.log', () => {
    const content = readFile('ws/ws-client.ts');
    const logLines = findConsoleLogLines(content);
    expect(logLines, `console.log found on lines: ${logLines.join(', ')}`).toHaveLength(0);
  });
});
