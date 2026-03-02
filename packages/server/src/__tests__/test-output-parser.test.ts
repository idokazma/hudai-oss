import { describe, it, expect } from 'vitest';
import { parseTestOutput } from '../parser/test-output-parser.js';

describe('parseTestOutput', () => {
  it('returns null for non-test command', () => {
    expect(parseTestOutput('git status', 'some output')).toBeNull();
  });

  it('returns null for empty output', () => {
    expect(parseTestOutput('npm test', '')).toBeNull();
  });

  it('returns null for very short output', () => {
    expect(parseTestOutput('npm test', 'ok')).toBeNull();
  });

  describe('Jest output', () => {
    it('parses pass/fail/total counts', () => {
      const output = `
PASS src/utils.test.ts
Tests:  3 passed, 1 failed, 4 total
Time:   2.345 s
`;
      const result = parseTestOutput('npm test', output);
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(3);
      expect(result!.failed).toBe(1);
      expect(result!.total).toBe(4);
      expect(result!.framework).toBe('jest');
    });

    it('parses with skipped tests', () => {
      const output = `Tests:  2 passed, 1 skipped, 3 total`;
      const result = parseTestOutput('npx jest', output);
      expect(result!.skipped).toBe(1);
      expect(result!.total).toBe(3);
    });
  });

  describe('Vitest output', () => {
    it('detects vitest framework from VITE marker', () => {
      const output = `
 DEV  v1.0.0 /project
 VITE v5.0.0  ready

Tests:  5 passed, 5 total
`;
      const result = parseTestOutput('npx vitest', output);
      expect(result!.framework).toBe('vitest');
      expect(result!.passed).toBe(5);
    });
  });

  describe('pytest output', () => {
    it('parses pytest summary line', () => {
      const output = `========================= 3 passed, 1 failed in 2.34s =========================`;
      const result = parseTestOutput('pytest', output);
      expect(result!.passed).toBe(3);
      expect(result!.failed).toBe(1);
      expect(result!.framework).toBe('pytest');
      expect(result!.durationMs).toBeCloseTo(2340);
    });

    it('counts errors as failures', () => {
      const output = `========================= 2 passed, 1 error in 1.00s =========================`;
      const result = parseTestOutput('pytest tests/', output);
      expect(result!.failed).toBe(1);
    });
  });

  describe('Mocha output', () => {
    it('parses passing/failing/pending counts', () => {
      const output = `  3 passing (2s)\n  1 failing\n  2 pending`;
      const result = parseTestOutput('npx mocha', output);
      expect(result!.passed).toBe(3);
      expect(result!.failed).toBe(1);
      expect(result!.skipped).toBe(2);
      expect(result!.framework).toBe('mocha');
    });
  });

  describe('Go test output', () => {
    it('counts ok and FAIL lines', () => {
      const output = `ok  \tgithub.com/foo/bar\t0.123s\nok  \tgithub.com/foo/baz\t0.456s\nFAIL\tgithub.com/foo/qux\t0.789s`;
      const result = parseTestOutput('go test ./...', output);
      expect(result!.passed).toBe(2);
      expect(result!.failed).toBe(1);
      expect(result!.framework).toBe('go');
    });
  });

  describe('cargo test output', () => {
    it('parses test result summary', () => {
      const output = `test result: ok. 10 passed; 2 failed; 1 ignored; 0 measured; 0 filtered out`;
      const result = parseTestOutput('cargo test', output);
      expect(result!.passed).toBe(10);
      expect(result!.failed).toBe(2);
      expect(result!.skipped).toBe(1);
      expect(result!.framework).toBe('cargo');
    });
  });

  describe('generic fallback', () => {
    it('parses "X passed" and "Y failed" patterns', () => {
      const output = `Results: 5 tests passed, 2 tests failed`;
      const result = parseTestOutput('npm test', output);
      expect(result!.passed).toBe(5);
      expect(result!.failed).toBe(2);
    });
  });

  describe('duration parsing', () => {
    it('parses "Time: X s" format', () => {
      const output = `Tests:  1 passed, 1 total\nTime:   3.5 s`;
      const result = parseTestOutput('jest', output);
      expect(result!.durationMs).toBeCloseTo(3500);
    });
  });

  describe('failure extraction', () => {
    it('extracts Jest failure blocks from ● markers', () => {
      const output = `Tests:  0 passed, 1 failed, 1 total

● should work

    expect(true).toBe(false)

`;
      const result = parseTestOutput('jest', output);
      expect(result!.failures.length).toBe(1);
      expect(result!.failures[0].name).toBe('should work');
    });
  });
});
