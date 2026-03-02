import { describe, it, expect } from 'vitest';
import { analyzePaneContent } from '../parser/pane-analyzer.js';

describe('analyzePaneContent', () => {
  it('returns working for empty content', () => {
    expect(analyzePaneContent('')).toEqual({ activity: 'working' });
  });

  it('returns working for whitespace-only content', () => {
    expect(analyzePaneContent('   \n  \n   ')).toEqual({ activity: 'working' });
  });

  it('returns waiting_input for idle ❯ prompt', () => {
    const result = analyzePaneContent('some output\n❯ \n');
    expect(result.activity).toBe('waiting_input');
  });

  it('returns waiting_input for bare ❯', () => {
    const result = analyzePaneContent('output\n❯');
    expect(result.activity).toBe('waiting_input');
  });

  it('returns waiting_permission for "Do you want to proceed?"', () => {
    const content = `
──────────────
 Bash command
   git push origin main
 This command requires approval
 Do you want to proceed?
`;
    const result = analyzePaneContent(content);
    expect(result.activity).toBe('waiting_permission');
    expect(result.detail).toContain('Bash');
  });

  it('returns waiting_answer for numbered options with question', () => {
    const content = `
Which approach should we take?
1. Option A
2. Option B
3. Option C
`;
    const result = analyzePaneContent(content);
    expect(result.activity).toBe('waiting_answer');
    expect(result.options).toEqual(['Option A', 'Option B', 'Option C']);
  });

  it('returns working for active output', () => {
    const content = `Reading file src/index.ts...\nProcessing imports\nAnalyzing dependencies`;
    const result = analyzePaneContent(content);
    expect(result.activity).toBe('working');
  });

  it('strips ANSI codes before analysis', () => {
    const content = '\x1b[32msome output\x1b[0m\n❯ ';
    const result = analyzePaneContent(content);
    expect(result.activity).toBe('waiting_input');
  });

  it('handles ❯ prefix on numbered options', () => {
    const content = `
What do you want to do?
❯ 1. First option
  2. Second option
`;
    const result = analyzePaneContent(content);
    expect(result.activity).toBe('waiting_answer');
    expect(result.options).toContain('First option');
  });

  it('only picks up options after the last question, not earlier numbered items', () => {
    const content = `
Here's my plan:
1. Refactor the auth module
2. Add unit tests
3. Update the API docs

Which step should I start with?
1. Start with step 1
2. Start with step 2
3. Start with step 3
`;
    const result = analyzePaneContent(content);
    expect(result.activity).toBe('waiting_answer');
    expect(result.options).toEqual([
      'Start with step 1',
      'Start with step 2',
      'Start with step 3',
    ]);
    // Should NOT include the plan items
    expect(result.options).not.toContain('Refactor the auth module');
  });
});
