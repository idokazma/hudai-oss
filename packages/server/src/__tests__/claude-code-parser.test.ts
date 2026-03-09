import { describe, it, expect, beforeEach } from 'vitest';
import { ClaudeCodeParser } from '../parser/claude-code-parser.js';
import type { AVPEvent } from '@hudai/shared';

describe('ClaudeCodeParser', () => {
  let parser: ClaudeCodeParser;
  let events: AVPEvent[];

  beforeEach(() => {
    parser = new ClaudeCodeParser('test-session');
    events = [];
    parser.on('event', (e: AVPEvent) => events.push(e));
  });

  // --- Tool parsing ---

  it('parses Read(path) as file.read', () => {
    parser.feed('⏺ Read(src/index.ts)');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('file.read');
    expect(events[0].data.path).toBe('src/index.ts');
  });

  it('parses Edit(path) as file.edit', () => {
    parser.feed('⏺ Edit(src/main.ts)');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('file.edit');
    expect(events[0].data.path).toBe('src/main.ts');
  });

  it('parses Write(path) as file.create', () => {
    parser.feed('⏺ Write(new-file.ts)');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('file.create');
  });

  it('parses Bash(command) as shell.run', () => {
    parser.feed('⏺ Bash(npm test)');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('shell.run');
    expect(events[0].data.command).toBe('npm test');
  });

  it('parses Grep(pattern) as search.grep', () => {
    parser.feed('⏺ Grep(TODO)');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('search.grep');
    expect(events[0].data.pattern).toBe('TODO');
  });

  it('parses Glob(pattern) as search.glob', () => {
    parser.feed('⏺ Glob(*.ts)');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('search.glob');
  });

  it('strips quotes from tool args', () => {
    parser.feed('⏺ Read("src/foo.ts")');
    expect(events[0].data.path).toBe('src/foo.ts');
  });

  it('handles alternative bullet characters', () => {
    parser.feed('✻ Read(src/a.ts)');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('file.read');
  });

  // --- Thinking indicators ---

  it('parses thinking start', () => {
    parser.feed('✢ Thinking…');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('think.start');
    expect(events[0].data.summary).toBe('Thinking…');
  });

  it('parses thinking end with duration', () => {
    parser.feed('⏺ Done for 5s');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('think.end');
    expect(events[0].data.durationMs).toBe(5000);
  });

  it('parses Baked/Fermented variants', () => {
    parser.feed('✻ Baked for 3s');
    expect(events[0].type).toBe('think.end');
    expect(events[0].data.durationMs).toBe(3000);
  });

  // --- User prompts ---

  it('parses ❯ prompt as task.start', () => {
    parser.feed('❯ Fix the login bug');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('task.start');
    expect(events[0].data.prompt).toBe('Fix the login bug');
  });

  it('deduplicates same prompt', () => {
    parser.feed('❯ Fix the bug\n❯ Fix the bug');
    const taskStarts = events.filter(e => e.type === 'task.start');
    expect(taskStarts).toHaveLength(1);
  });

  it('resetDedup allows re-emitting prompts', () => {
    parser.feed('❯ My task');
    expect(events).toHaveLength(1);
    parser.resetDedup();
    parser.feed('❯ My task');
    const taskStarts = events.filter(e => e.type === 'task.start');
    expect(taskStarts).toHaveLength(2);
  });

  it('does not treat ❯ menu selections as prompts', () => {
    parser.feed('❯ 1. Yes, allow once');
    expect(events.filter(e => e.type === 'task.start')).toHaveLength(0);
  });

  // --- Permission prompts ---

  it('detects permission prompt from multi-line block', () => {
    parser.feed([
      'Bash command',
      'rm -rf /tmp/test',
      'Do you want to proceed?',
    ].join('\n'));
    const perms = events.filter(e => e.type === 'permission.prompt');
    expect(perms).toHaveLength(1);
    expect(perms[0].data.tool).toBe('Bash');
    expect(perms[0].data.command).toBe('rm -rf /tmp/test');
  });

  it('permission prompt requires "Do you want to proceed"', () => {
    parser.feed('Bash command\nrm -rf /tmp\nSome other text');
    expect(events.filter(e => e.type === 'permission.prompt')).toHaveLength(0);
  });

  // --- Noise filtering ---

  it('filters box-drawing characters', () => {
    parser.feed('─────────────');
    parser.feed('╭──────────────╮');
    expect(events).toHaveLength(0);
  });

  it('filters Claude Code version line', () => {
    parser.feed('Claude Code v1.0.0');
    expect(events).toHaveLength(0);
  });

  it('filters esc to interrupt', () => {
    parser.feed('esc to interrupt');
    expect(events).toHaveLength(0);
  });

  it('filters permission menu items', () => {
    parser.feed('1. Yes, allow once');
    parser.feed('2. Yes and don\'t ask again');
    parser.feed('3. No');
    expect(events.filter(e => e.type !== 'raw.output')).toHaveLength(0);
  });

  it('filters model names', () => {
    parser.feed('Using Opus for this response');
    expect(events).toHaveLength(0);
  });

  it('filters shortcuts line', () => {
    parser.feed('? for shortcuts');
    expect(events).toHaveLength(0);
  });

  // --- ANSI stripping ---

  it('strips ANSI escape codes before parsing', () => {
    parser.feed('\x1b[32m⏺ Read(src/a.ts)\x1b[0m');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('file.read');
  });

  // --- TodoWrite capturing ---

  it('captures TodoWrite output as plan.update', () => {
    parser.feed([
      '⏺ TodoWrite(todos)',
      '⎿ - [x] Step 1 done',
      '⎿ - [ ] Step 2 pending',
      '⎿ - [ ] Step 3 pending',
    ].join('\n'));
    // Trigger flush by feeding a structural event
    parser.feed('⏺ Read(foo.ts)');
    const planUpdates = events.filter(e => e.type === 'plan.update');
    expect(planUpdates).toHaveLength(1);
    expect(planUpdates[0].data.steps).toEqual(['Step 1 done', 'Step 2 pending', 'Step 3 pending']);
    expect(planUpdates[0].data.currentStep).toBe(1); // First non-done
  });

  it('captures TaskCreate output', () => {
    parser.feed([
      '⏺ TaskCreate(test)',
      '⎿ Task: Build the API',
    ].join('\n'));
    parser.feed('⏺ Read(x.ts)');
    const planUpdates = events.filter(e => e.type === 'plan.update');
    expect(planUpdates).toHaveLength(1);
    expect(planUpdates[0].data.steps).toContain('Build the API');
  });

  // --- Numbered plan detection ---

  it('detects numbered plan with 3+ items', () => {
    parser.feed([
      '⏺ 1. Analyze the codebase structure',
      '⏺ 2. Implement the new feature',
      '⏺ 3. Write comprehensive tests',
    ].join('\n'));
    // Flush via structural event
    parser.feed('⏺ Read(a.ts)');
    const plans = events.filter(e => e.type === 'plan.update');
    expect(plans).toHaveLength(1);
    expect(plans[0].data.steps).toHaveLength(3);
  });

  it('does not emit plan with fewer than 3 items', () => {
    parser.feed('⏺ 1. Step one\n⏺ 2. Step two');
    parser.feed('⏺ Read(a.ts)');
    expect(events.filter(e => e.type === 'plan.update')).toHaveLength(0);
  });

  it('deduplicates identical plans', () => {
    parser.feed('⏺ 1. A step\n⏺ 2. B step\n⏺ 3. C step');
    parser.feed('⏺ Read(a.ts)');
    // Feed same plan again
    parser.feed('⏺ 1. A step\n⏺ 2. B step\n⏺ 3. C step');
    parser.feed('⏺ Read(b.ts)');
    expect(events.filter(e => e.type === 'plan.update')).toHaveLength(1);
  });

  // --- Plan file detection ---

  it('emits plan-file when plan path detected', () => {
    const planFiles: string[] = [];
    parser.on('plan-file', (f: string) => planFiles.push(f));
    parser.feed('Created plan at ~/.claude/plans/my-plan.md');
    expect(planFiles).toEqual(['my-plan.md']);
  });

  it('does not re-emit same plan file', () => {
    const planFiles: string[] = [];
    parser.on('plan-file', (f: string) => planFiles.push(f));
    parser.feed('Created plan at ~/.claude/plans/test.md');
    parser.feed('Loading ~/.claude/plans/test.md');
    expect(planFiles).toHaveLength(1);
  });

  // --- Plan title detection ---

  it('emits plan-title from box format', () => {
    const titles: string[] = [];
    parser.on('plan-title', (t: string) => titles.push(t));
    parser.feed('│ Plan to implement │');
    parser.feed('│ Add user authentication │');
    expect(titles).toEqual(['Add user authentication']);
  });

  it('emits plan-title from Plan: format', () => {
    const titles: string[] = [];
    parser.on('plan-title', (t: string) => titles.push(t));
    parser.feed('│ Plan: Refactor database layer │');
    expect(titles).toEqual(['Refactor database layer']);
  });

  // --- Task status lines ---

  it('parses task completion status lines', () => {
    parser.feed('✓ Completed: Fix the authentication bug');
    expect(events.filter(e => e.type === 'task.complete')).toHaveLength(1);
  });

  // --- Agent response text ---

  it('emits raw.output for agent text', () => {
    parser.feed('⏺ Let me analyze this code');
    const raw = events.filter(e => e.type === 'raw.output');
    expect(raw).toHaveLength(1);
    expect(raw[0].data.text).toBe('Let me analyze this code');
  });

  // --- flush ---

  it('flush triggers pending todo and numbered plan', () => {
    parser.feed([
      '⏺ TodoWrite(todos)',
      '⎿ - [x] Done step',
      '⎿ - [ ] Pending step',
    ].join('\n'));
    parser.flush();
    expect(events.filter(e => e.type === 'plan.update')).toHaveLength(1);
  });

  // --- session ID ---

  it('emitted events have correct sessionId', () => {
    parser.feed('⏺ Read(foo.ts)');
    expect(events[0].sessionId).toBe('test-session');
  });

  // --- empty/whitespace lines ---

  it('skips empty lines', () => {
    parser.feed('\n\n\n');
    expect(events).toHaveLength(0);
  });
});
