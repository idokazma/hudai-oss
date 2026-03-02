import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// We need to dynamically import after setting HOME
let hudaiHome: typeof import('../persistence/data-dir.js').hudaiHome;
let projectDir: typeof import('../persistence/data-dir.js').projectDir;
let dbPath: typeof import('../persistence/data-dir.js').dbPath;

describe('data-dir', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hudai-test-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    // Re-import to pick up new HOME
    const mod = await import('../persistence/data-dir.js');
    hudaiHome = mod.hudaiHome;
    projectDir = mod.projectDir;
    dbPath = mod.dbPath;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('hudaiHome creates .hudai directory', () => {
    const dir = hudaiHome();
    expect(dir).toBe(path.join(tmpDir, '.hudai'));
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('projectDir returns deterministic hash-based path', () => {
    const dir1 = projectDir('/my/project');
    const dir2 = projectDir('/my/project');
    expect(dir1).toBe(dir2);
    expect(fs.existsSync(dir1)).toBe(true);
  });

  it('projectDir writes project.json breadcrumb', () => {
    const dir = projectDir('/my/project');
    const breadcrumb = path.join(dir, 'project.json');
    expect(fs.existsSync(breadcrumb)).toBe(true);
    const data = JSON.parse(fs.readFileSync(breadcrumb, 'utf-8'));
    expect(data.rootPath).toBe('/my/project');
    expect(data.createdAt).toBeDefined();
  });

  it('different project paths produce different directories', () => {
    const dir1 = projectDir('/project-a');
    const dir2 = projectDir('/project-b');
    expect(dir1).not.toBe(dir2);
  });

  it('dbPath returns .hudai/hudai.db', () => {
    const p = dbPath();
    expect(p).toBe(path.join(tmpDir, '.hudai', 'hudai.db'));
  });
});
