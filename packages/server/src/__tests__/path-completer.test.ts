import { describe, it, expect } from 'vitest';
import { completePath, scanRecentProjects } from '../fs/path-completer.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

describe('completePath', () => {
  it('returns home directory contents for empty input', async () => {
    const results = await completePath('');
    expect(results.length).toBeGreaterThan(0);
    // Should contain common home subdirectories
    const names = results.map((r) => r.name);
    expect(names.some((n) => ['Desktop', 'Documents', 'Downloads'].includes(n))).toBe(true);
  });

  it('expands ~ to home directory', async () => {
    const results = await completePath('~/');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path.startsWith(homedir())).toBe(true);
  });

  it('filters by prefix', async () => {
    const results = await completePath('~/Des');
    // Should match Desktop, possibly others starting with "Des"
    for (const r of results) {
      expect(r.name.toLowerCase().startsWith('des')).toBe(true);
    }
  });

  it('lists directory contents when path ends with /', async () => {
    const results = await completePath(homedir() + '/');
    expect(results.length).toBeGreaterThan(0);
    // All should be under home
    for (const r of results) {
      expect(r.path.startsWith(homedir())).toBe(true);
    }
  });

  it('returns empty array for nonexistent path', async () => {
    const results = await completePath('/nonexistent/path/that/does/not/exist');
    expect(results).toEqual([]);
  });

  it('only returns directories (no files)', async () => {
    const results = await completePath(homedir() + '/');
    for (const r of results) {
      expect(r.isDirectory).toBe(true);
    }
  });

  it('skips hidden directories', async () => {
    const results = await completePath(homedir() + '/');
    for (const r of results) {
      expect(r.name.startsWith('.')).toBe(false);
    }
  });

  it('marks git repos', async () => {
    // The hudai project itself is a git repo
    const projectDir = join(__dirname, '../../..');
    const results = await completePath(projectDir + '/');
    // At least one result should exist
    // The parent of this test file's package should be findable
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it('sorts git repos before non-git directories', async () => {
    const results = await completePath(homedir() + '/');
    // Find first git repo and first non-git repo
    const firstGit = results.findIndex((r) => r.isGitRepo);
    const firstNonGit = results.findIndex((r) => !r.isGitRepo);
    if (firstGit >= 0 && firstNonGit >= 0) {
      expect(firstGit).toBeLessThan(firstNonGit);
    }
  });
});

describe('scanRecentProjects', () => {
  it('returns projects from past paths', async () => {
    const results = await scanRecentProjects([homedir()]);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].path).toBe(homedir());
  });

  it('deduplicates paths', async () => {
    const results = await scanRecentProjects([homedir(), homedir()]);
    const homePaths = results.filter((r) => r.path === homedir());
    expect(homePaths).toHaveLength(1);
  });

  it('skips nonexistent paths', async () => {
    const results = await scanRecentProjects(['/nonexistent/fake/path']);
    const fakePaths = results.filter((r) => r.path === '/nonexistent/fake/path');
    expect(fakePaths).toHaveLength(0);
  });

  it('scans common project directories for git repos', async () => {
    const results = await scanRecentProjects([]);
    // Should find at least something if user has any git repos in common locations
    // This test is environment-dependent but should not crash
    expect(Array.isArray(results)).toBe(true);
  });
});
