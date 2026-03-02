/**
 * Parses test runner output to extract pass/fail counts.
 * Supports: Jest, Vitest, pytest, Mocha, Go test, cargo test.
 */

export interface TestParseResult {
  passed: number;
  failed: number;
  total: number;
  skipped: number;
  durationMs: number;
  framework?: string;
  failures: Array<{ name: string; file?: string; message: string }>;
}

/**
 * Try to parse test output from a shell command's stdout/stderr.
 * Returns null if the output doesn't look like test results.
 */
export function parseTestOutput(command: string, output: string): TestParseResult | null {
  // Only try to parse commands that look like test runners
  if (!isTestCommand(command)) return null;
  if (!output || output.length < 10) return null;

  return (
    parseJestVitest(output) ??
    parsePytest(output) ??
    parseMocha(output) ??
    parseGoTest(output) ??
    parseCargoTest(output) ??
    parseGenericTestOutput(output)
  );
}

function isTestCommand(command: string): boolean {
  const testPatterns = [
    /\btest\b/i,
    /\bjest\b/i,
    /\bvitest\b/i,
    /\bpytest\b/i,
    /\bmocha\b/i,
    /\bcargo\s+test\b/i,
    /\bgo\s+test\b/i,
    /\bnpm\s+(?:run\s+)?test/i,
    /\bpnpm\s+(?:run\s+)?test/i,
    /\bbun\s+test/i,
    /\bnpx\s+(?:jest|vitest|mocha)/i,
  ];
  return testPatterns.some((p) => p.test(command));
}

/** Jest / Vitest output: "Tests:  3 passed, 1 failed, 4 total" */
function parseJestVitest(output: string): TestParseResult | null {
  // Match "Tests:  X failed, Y passed, Z total"
  const testsLine = output.match(/Tests:\s+(.+?)(?:\n|$)/i);
  if (!testsLine) return null;

  const line = testsLine[1];
  const passed = parseInt(line.match(/(\d+)\s+passed/)?.[1] ?? '0');
  const failed = parseInt(line.match(/(\d+)\s+failed/)?.[1] ?? '0');
  const skipped = parseInt(line.match(/(\d+)\s+skipped/)?.[1] ?? '0');
  const total = parseInt(line.match(/(\d+)\s+total/)?.[1] ?? '0') || (passed + failed + skipped);

  if (total === 0 && passed === 0 && failed === 0) return null;

  const duration = parseDuration(output);
  const failures = extractFailures(output);
  const framework = output.includes('VITE') || output.includes('vitest') ? 'vitest' : 'jest';

  return { passed, failed, total, skipped, durationMs: duration, framework, failures };
}

/** pytest output: "3 passed, 1 failed in 2.34s" */
function parsePytest(output: string): TestParseResult | null {
  const match = output.match(/=+\s+(.+?)\s+in\s+([\d.]+)s\s+=+/);
  if (!match) return null;

  const summary = match[1];
  const passed = parseInt(summary.match(/(\d+)\s+passed/)?.[1] ?? '0');
  const failed = parseInt(summary.match(/(\d+)\s+failed/)?.[1] ?? '0');
  const skipped = parseInt(summary.match(/(\d+)\s+(?:skipped|deselected)/)?.[1] ?? '0');
  const errors = parseInt(summary.match(/(\d+)\s+error/)?.[1] ?? '0');
  const total = passed + failed + skipped + errors;
  const durationMs = parseFloat(match[2]) * 1000;

  return { passed, failed: failed + errors, total, skipped, durationMs, framework: 'pytest', failures: [] };
}

/** Mocha output: "  3 passing (2s)\n  1 failing" */
function parseMocha(output: string): TestParseResult | null {
  const passing = output.match(/(\d+)\s+passing/);
  if (!passing) return null;

  const passed = parseInt(passing[1]);
  const failed = parseInt(output.match(/(\d+)\s+failing/)?.[1] ?? '0');
  const skipped = parseInt(output.match(/(\d+)\s+pending/)?.[1] ?? '0');
  const total = passed + failed + skipped;
  const duration = parseDuration(output);

  return { passed, failed, total, skipped, durationMs: duration, framework: 'mocha', failures: [] };
}

/** Go test output: "ok  	package	0.123s" or "FAIL	package	0.456s" */
function parseGoTest(output: string): TestParseResult | null {
  const okCount = (output.match(/^ok\s/gm) ?? []).length;
  const failCount = (output.match(/^FAIL\s/gm) ?? []).length;
  if (okCount === 0 && failCount === 0) return null;

  const passed = parseInt(output.match(/(\d+)\s+(?:tests?\s+)?passed/i)?.[1] ?? String(okCount));
  const failed = parseInt(output.match(/(\d+)\s+(?:tests?\s+)?failed/i)?.[1] ?? String(failCount));
  const total = passed + failed;
  const duration = parseDuration(output);

  return { passed, failed, total, skipped: 0, durationMs: duration, framework: 'go', failures: [] };
}

/** cargo test output: "test result: ok. 3 passed; 0 failed; 0 ignored" */
function parseCargoTest(output: string): TestParseResult | null {
  const match = output.match(/test result:\s+\w+\.\s+(\d+)\s+passed;\s+(\d+)\s+failed;\s+(\d+)\s+ignored/);
  if (!match) return null;

  const passed = parseInt(match[1]);
  const failed = parseInt(match[2]);
  const skipped = parseInt(match[3]);
  const total = passed + failed + skipped;
  const duration = parseDuration(output);

  return { passed, failed, total, skipped, durationMs: duration, framework: 'cargo', failures: [] };
}

/** Generic fallback: look for common patterns */
function parseGenericTestOutput(output: string): TestParseResult | null {
  // "X passed" and/or "Y failed"
  const passed = parseInt(output.match(/(\d+)\s+(?:tests?\s+)?pass(?:ed|ing)?/i)?.[1] ?? '0');
  const failed = parseInt(output.match(/(\d+)\s+(?:tests?\s+)?fail(?:ed|ing|ure)?/i)?.[1] ?? '0');
  if (passed === 0 && failed === 0) return null;

  const total = passed + failed;
  const duration = parseDuration(output);

  return { passed, failed, total, skipped: 0, durationMs: duration, failures: [] };
}

function parseDuration(output: string): number {
  // "Time: 2.345 s" or "in 2.345s" or "(2s)" or "0.123s"
  const match = output.match(/(?:Time|in|took|finished in)[:\s]*([\d.]+)\s*m?s/i)
    ?? output.match(/\(([\d.]+)\s*m?s?\)/);
  if (match) {
    const val = parseFloat(match[1]);
    // If it looks like seconds (small number), convert to ms
    return val < 1000 ? val * 1000 : val;
  }
  return 0;
}

function extractFailures(output: string): Array<{ name: string; file?: string; message: string }> {
  const failures: Array<{ name: string; file?: string; message: string }> = [];

  // Jest/Vitest failure blocks: "● Test Name"
  const failBlocks = output.matchAll(/●\s+(.+?)(?:\n\n|\n\s*\n)/gs);
  for (const match of failBlocks) {
    const block = match[1];
    const lines = block.split('\n');
    const name = lines[0].trim();
    const file = block.match(/at\s+.*?\((.*?:\d+)/)?.[1];
    const message = lines.slice(1, 3).join(' ').trim().slice(0, 200);
    failures.push({ name, file, message });
    if (failures.length >= 5) break;
  }

  return failures;
}
