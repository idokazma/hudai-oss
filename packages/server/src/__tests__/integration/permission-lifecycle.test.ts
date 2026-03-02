import { describe, it, expect, beforeEach } from 'vitest';
import { analyzePaneContent } from '../../parser/pane-analyzer.js';
import { CommandHandler } from '../../ws/command-handler.js';
import { MockAgentProcess } from './helpers/mock-agent-process.js';
import type { SessionState } from '@hudai/shared';

describe('Permission Prompt Lifecycle', () => {
  let mockAgent: MockAgentProcess;
  let handler: CommandHandler;

  beforeEach(() => {
    mockAgent = new MockAgentProcess();
    handler = new CommandHandler(mockAgent as any);
  });

  it('detects working → permission prompt → approve → working', () => {
    // Step 1: Feed working output
    const workingContent = [
      'Reading file src/index.ts...',
      'Processing imports',
      'Analyzing dependencies',
    ].join('\n');
    const workingResult = analyzePaneContent(workingContent);
    expect(workingResult.activity).toBe('working');

    // Step 2: Feed permission prompt
    const permissionContent = [
      '──────────────',
      ' Bash command',
      '   npm test',
      ' This command requires approval',
      ' Do you want to proceed?',
    ].join('\n');
    const permResult = analyzePaneContent(permissionContent);
    expect(permResult.activity).toBe('waiting_permission');
    expect(permResult.detail).toContain('Bash');

    // Step 3: Build SessionState from detected activity
    const state: SessionState = {
      sessionId: 'test-session-1',
      status: 'running',
      agentCurrentFile: 'src/index.ts',
      taskLabel: 'Run tests',
      startedAt: Date.now() - 60_000,
      eventCount: 10,
      agentActivity: permResult.activity,
      agentActivityDetail: permResult.detail,
    };
    expect(state.agentActivity).toBe('waiting_permission');
    expect(state.sessionId).toBe('test-session-1');

    // Step 4: Route approve command through CommandHandler
    handler.handle({ type: 'approve' });
    expect(mockAgent.getWrittenData()).toEqual(['y', '<ENTER>']);

    // Step 5: Feed resumed working output
    mockAgent.clearWrittenData();
    const resumedContent = [
      'Running npm test...',
      'PASS src/utils.test.ts',
      'Tests: 5 passed, 5 total',
    ].join('\n');
    const resumedResult = analyzePaneContent(resumedContent);
    expect(resumedResult.activity).toBe('working');
  });

  it('detects working → permission prompt → reject → working', () => {
    // Step 1: Working
    const workingResult = analyzePaneContent('Building project...\nCompiling TypeScript');
    expect(workingResult.activity).toBe('working');

    // Step 2: Permission prompt
    const permissionContent = [
      '──────────────',
      ' Bash command',
      '   rm -rf dist/',
      ' This command requires approval',
      ' Do you want to proceed?',
    ].join('\n');
    const permResult = analyzePaneContent(permissionContent);
    expect(permResult.activity).toBe('waiting_permission');

    // Step 3: Route reject command
    handler.handle({ type: 'reject' });
    expect(mockAgent.getWrittenData()).toEqual(['n', '<ENTER>']);

    // Step 4: Back to working
    mockAgent.clearWrittenData();
    const resumedResult = analyzePaneContent('Skipping command, continuing...\nReading next file');
    expect(resumedResult.activity).toBe('working');
  });

  it('handles multiple permission prompts in sequence', () => {
    // First permission → approve
    handler.handle({ type: 'approve' });
    expect(mockAgent.getWrittenData()).toEqual(['y', '<ENTER>']);
    mockAgent.clearWrittenData();

    // Second permission → reject
    handler.handle({ type: 'reject' });
    expect(mockAgent.getWrittenData()).toEqual(['n', '<ENTER>']);
    mockAgent.clearWrittenData();

    // Third permission → approve
    handler.handle({ type: 'approve' });
    expect(mockAgent.getWrittenData()).toEqual(['y', '<ENTER>']);
  });

  it('handles other steering commands correctly', () => {
    // Pause
    handler.handle({ type: 'pause' });
    expect(mockAgent.getWrittenData()).toEqual(['<INTERRUPT>']);
    mockAgent.clearWrittenData();

    // Prompt
    handler.handle({ type: 'prompt', data: { text: 'focus on auth module' } });
    expect(mockAgent.getWrittenData()).toEqual(['focus on auth module', '<ENTER>']);
    mockAgent.clearWrittenData();

    // Send keys
    handler.handle({ type: 'send_keys', data: { keys: 'Enter' } });
    expect(mockAgent.getWrittenData()).toEqual(['<KEY:Enter>']);
  });
});
