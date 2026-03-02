import { describe, it, expect } from 'vitest';
import { matchPermission } from '../config/permission-matcher.js';
import type { PermissionRule } from '@hudai/shared';

function rule(type: 'allow' | 'deny', tool: string): PermissionRule {
  return { type, tool, scope: 'project' };
}

describe('matchPermission', () => {
  it('matches simple tool name', () => {
    const result = matchPermission('Read', {}, [rule('allow', 'Read')]);
    expect(result).toEqual({ status: 'allowed', rule: 'Read' });
  });

  it('matches glob pattern on Bash command', () => {
    const result = matchPermission('Bash', { command: 'npm install' }, [
      rule('allow', 'Bash(npm *)'),
    ]);
    expect(result).toEqual({ status: 'allowed', rule: 'Bash(npm *)' });
  });

  it('does not match non-matching glob', () => {
    const result = matchPermission('Bash', { command: 'rm -rf /' }, [
      rule('allow', 'Bash(npm *)'),
    ]);
    expect(result).toEqual({ status: 'prompted' });
  });

  it('matches double-star glob for nested paths', () => {
    const result = matchPermission('Edit', { file_path: 'src/components/deep/file.ts' }, [
      rule('allow', 'Edit(src/**)'),
    ]);
    expect(result).toEqual({ status: 'allowed', rule: 'Edit(src/**)' });
  });

  it('deny rules take priority over allow rules', () => {
    const result = matchPermission('Bash', { command: 'rm file.txt' }, [
      rule('allow', 'Bash'),
      rule('deny', 'Bash(rm *)'),
    ]);
    expect(result).toEqual({ status: 'denied', rule: 'Bash(rm *)' });
  });

  it('returns prompted when no rule matches', () => {
    const result = matchPermission('Write', { file_path: '/tmp/foo.ts' }, [
      rule('allow', 'Read'),
    ]);
    expect(result).toEqual({ status: 'prompted' });
  });

  it('returns prompted for empty rules array', () => {
    const result = matchPermission('Read', {}, []);
    expect(result).toEqual({ status: 'prompted' });
  });

  it('does not match tool with pattern when tool has no primary arg', () => {
    // Unknown tool type — getPrimaryArg returns null
    const result = matchPermission('CustomTool', { foo: 'bar' }, [
      rule('allow', 'CustomTool(bar)'),
    ]);
    expect(result).toEqual({ status: 'prompted' });
  });

  it('matches simple tool name even when tool has args', () => {
    const result = matchPermission('Read', { file_path: '/some/file.ts' }, [
      rule('allow', 'Read'),
    ]);
    expect(result).toEqual({ status: 'allowed', rule: 'Read' });
  });
});
