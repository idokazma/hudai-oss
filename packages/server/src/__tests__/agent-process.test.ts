import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock child_process before importing
vi.mock('child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    // Default: return sensible values for tmux commands
    if (cmd.includes('which tmux')) return '/opt/homebrew/bin/tmux\n';
    if (cmd.includes('which claude')) return '/usr/local/bin/claude\n';
    if (cmd.includes('display-message') && cmd.includes('ok')) return 'ok\n';
    if (cmd.includes('display-message') && cmd.includes('cursor')) return '0 0 24\n';
    if (cmd.includes('capture-pane')) return '\n';
    return '';
  }),
}));

import { execSync } from 'child_process';
import { AgentProcess } from '../pty/agent-process.js';

const mockExecSync = vi.mocked(execSync);

describe('AgentProcess', () => {
  let process: AgentProcess;

  beforeEach(() => {
    process = new AgentProcess();
    vi.clearAllMocks();
  });

  // --- findNewLines (private method, tested via type cast) ---

  describe('findNewLines', () => {
    function callFindNewLines(prev: string[], curr: string[]): string[] {
      return (process as any).findNewLines(prev, curr);
    }

    it('returns all lines when previous is empty', () => {
      expect(callFindNewLines([], ['line1', 'line2'])).toEqual(['line1', 'line2']);
    });

    it('returns empty when current is empty', () => {
      expect(callFindNewLines(['line1'], [])).toEqual([]);
    });

    it('finds new lines after anchor', () => {
      const prev = ['line1', 'line2'];
      const curr = ['line1', 'line2', 'line3', 'line4'];
      expect(callFindNewLines(prev, curr)).toEqual(['line3', 'line4']);
    });

    it('returns empty when no new lines', () => {
      const lines = ['line1', 'line2'];
      expect(callFindNewLines(lines, lines)).toEqual([]);
    });

    it('uses last non-empty line as anchor', () => {
      const prev = ['line1', 'anchor', '', ''];
      const curr = ['line1', 'anchor', 'new line'];
      expect(callFindNewLines(prev, curr)).toEqual(['new line']);
    });

    it('returns filtered lines when anchor not found (screen cleared)', () => {
      const prev = ['old1', 'old2'];
      const curr = ['completely', 'new', 'content'];
      expect(callFindNewLines(prev, curr)).toEqual(['completely', 'new', 'content']);
    });

    it('filters empty lines from new content', () => {
      const prev = ['anchor'];
      const curr = ['anchor', '', 'real line', ''];
      expect(callFindNewLines(prev, curr)).toEqual(['real line']);
    });

    it('returns empty when previous is all whitespace', () => {
      const prev = ['', '   ', ''];
      expect(callFindNewLines(prev, ['line1'])).toEqual([]);
    });

    it('searches for anchor from end of current', () => {
      // If anchor appears multiple times, should match the last one
      const prev = ['anchor'];
      const curr = ['anchor', 'old', 'anchor', 'new'];
      expect(callFindNewLines(prev, curr)).toEqual(['new']);
    });
  });

  // --- listPanes ---

  describe('listPanes', () => {
    it('parses tmux list-panes output', () => {
      mockExecSync.mockReturnValue(
        'session1:0.0|||My Terminal|||zsh\nsession2:0.0|||Editor|||vim\n'
      );
      const panes = AgentProcess.listPanes();
      expect(panes).toEqual([
        { id: 'session1:0.0', title: 'My Terminal', command: 'zsh' },
        { id: 'session2:0.0', title: 'Editor', command: 'vim' },
      ]);
    });

    it('returns empty array on tmux error', () => {
      mockExecSync.mockImplementation(() => { throw new Error('tmux not running'); });
      expect(AgentProcess.listPanes()).toEqual([]);
    });

    it('handles missing title by using id', () => {
      mockExecSync.mockReturnValue('sess:0.0||||||bash\n');
      const panes = AgentProcess.listPanes();
      expect(panes[0].title).toBe('sess:0.0');
    });
  });

  // --- spawnAgent ---

  describe('spawnAgent', () => {
    it('sanitizes session name', () => {
      mockExecSync.mockReturnValue('');
      AgentProcess.spawnAgent({
        projectPath: '/project',
        sessionName: 'my session@#$name',
      });
      // Check that execSync was called with sanitized name
      const call = mockExecSync.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('new-session')
      );
      expect(call).toBeDefined();
      expect(call![0]).toContain('my-session---name');
    });

    it('generates timestamp-based name when none provided', () => {
      mockExecSync.mockReturnValue('');
      const target = AgentProcess.spawnAgent({ projectPath: '/project' });
      expect(target).toMatch(/^hudai-agent-\d+:0\.0$/);
    });

    it('returns tmux target string', () => {
      mockExecSync.mockReturnValue('');
      const target = AgentProcess.spawnAgent({
        projectPath: '/project',
        sessionName: 'test-agent',
      });
      expect(target).toBe('test-agent:0.0');
    });

    it('passes prompt when provided', () => {
      mockExecSync.mockReturnValue('');
      AgentProcess.spawnAgent({
        projectPath: '/project',
        prompt: 'Fix the bug',
        sessionName: 'test',
      });
      const call = mockExecSync.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('new-session')
      );
      expect(call![0]).toContain('Fix the bug');
    });

    it('escapes single quotes in prompt', () => {
      mockExecSync.mockReturnValue('');
      AgentProcess.spawnAgent({
        projectPath: '/project',
        prompt: "don't break",
        sessionName: 'test',
      });
      const call = mockExecSync.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('new-session')
      );
      // The prompt should be in the command with quotes escaped
      expect(call![0]).toContain('don');
      expect(call![0]).toContain('break');
    });
  });

  // --- killSession ---

  describe('killSession', () => {
    it('extracts session name from target', () => {
      mockExecSync.mockReturnValue('');
      AgentProcess.killSession('my-session:0.0');
      const call = mockExecSync.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('kill-session')
      );
      expect(call![0]).toContain('"my-session"');
    });
  });

  // --- sendKeys ---

  describe('sendKeys', () => {
    it('rejects unknown keys', () => {
      process.attach({ tmuxTarget: 'test:0.0' });
      const callCountBefore = mockExecSync.mock.calls.length;

      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      process.sendKeys('F13');
      // No new execSync call should have been made
      expect(mockExecSync.mock.calls.length).toBe(callCountBefore);
      spy.mockRestore();
    });

    it('sends allowed keys', () => {
      process.attach({ tmuxTarget: 'test:0.0' });
      const callCountBefore = mockExecSync.mock.calls.length;

      process.sendKeys('Enter');
      expect(mockExecSync.mock.calls.length).toBe(callCountBefore + 1);
    });

    it('throws when not attached', () => {
      expect(() => process.sendKeys('Enter')).toThrow('Not attached');
    });
  });

  // --- write ---

  describe('write', () => {
    it('throws when not attached', () => {
      expect(() => process.write('hello')).toThrow('Not attached');
    });

    it('sends text via send-keys', () => {
      process.attach({ tmuxTarget: 'test:0.0' });
      const callCountBefore = mockExecSync.mock.calls.length;

      process.write('hello');
      const newCalls = mockExecSync.mock.calls.slice(callCountBefore);
      const sendKeysCall = newCalls.find(c => typeof c[0] === 'string' && c[0].includes('send-keys'));
      expect(sendKeysCall).toBeDefined();
      expect(sendKeysCall![0]).toContain('hello');
    });
  });

  // --- detach ---

  describe('detach', () => {
    it('clears state', () => {
      process.attach({ tmuxTarget: 'test:0.0' });
      expect(process.running).toBe(true);
      process.detach();
      expect(process.running).toBe(false);
    });

    it('clears poll timer and tmux target', () => {
      process.attach({ tmuxTarget: 'test:0.0' });
      process.detach();
      expect(() => process.write('test')).toThrow('Not attached');
    });
  });

  // --- kill ---

  describe('kill', () => {
    it('delegates to detach', () => {
      process.attach({ tmuxTarget: 'test:0.0' });
      process.kill();
      expect(process.running).toBe(false);
    });
  });
});
