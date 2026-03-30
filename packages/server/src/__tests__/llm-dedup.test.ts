import { describe, it, expect } from 'vitest';
import { formatEventForPrompt } from '../llm/insight-engine.js';
import type { IntentPhase } from '../llm/insight-engine.js';

/**
 * Phase 2 cleanup: verify that formatEventForPrompt and IntentPhase are
 * exported from insight-engine.ts and usable as the single source of truth.
 * After cleanup, commander-chat.ts should import these rather than redefining them.
 */
describe('formatEventForPrompt (single source in insight-engine)', () => {
  it('is exported as a function', () => {
    expect(typeof formatEventForPrompt).toBe('function');
  });

  it('formats file.read events', () => {
    const event = { type: 'file.read', data: { path: '/src/index.ts' } } as any;
    expect(formatEventForPrompt(event)).toBe('Read /src/index.ts');
  });

  it('formats file.edit events with additions/deletions', () => {
    const event = { type: 'file.edit', data: { path: '/a.ts', additions: 5, deletions: 2 } } as any;
    expect(formatEventForPrompt(event)).toBe('Edit /a.ts (+5/-2)');
  });

  it('formats shell.run events', () => {
    const event = { type: 'shell.run', data: { command: 'npm test' } } as any;
    expect(formatEventForPrompt(event)).toBe('Shell: npm test');
  });

  it('falls back to event.type for unknown types', () => {
    const event = { type: 'custom.unknown', data: {} } as any;
    expect(formatEventForPrompt(event)).toBe('custom.unknown');
  });
});

describe('IntentPhase type', () => {
  it('is structurally valid', () => {
    // Compile-time check: if IntentPhase type changes, this will fail to compile
    const phase: IntentPhase = {
      text: 'Analyzing codebase',
      detectedAt: Date.now(),
      filesEdited: new Set<string>(),
      shellCommands: [],
      testsPassed: 0,
      testsFailed: 0,
      errors: 0,
    };
    expect(phase.text).toBe('Analyzing codebase');
    expect(phase.filesEdited).toBeInstanceOf(Set);
  });
});
