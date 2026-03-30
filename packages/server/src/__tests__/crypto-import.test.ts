import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Phase 3 cleanup: verify that claude-code-parser.ts explicitly imports
 * crypto/randomUUID instead of relying on Node.js globals.
 */

describe('claude-code-parser crypto import', () => {
  it('has explicit crypto or randomUUID import', () => {
    const filePath = path.resolve(__dirname, '..', 'parser', 'claude-code-parser.ts');
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').slice(0, 20); // Check the import section

    const hasImport = lines.some(
      (line) =>
        line.includes("from 'node:crypto'") ||
        line.includes('from "node:crypto"') ||
        line.includes("from 'crypto'") ||
        line.includes('from "crypto"'),
    );

    expect(hasImport, 'claude-code-parser.ts should explicitly import from node:crypto').toBe(true);
  });
});
