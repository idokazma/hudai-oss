import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

function projectHash(projectRoot: string): string {
  return crypto.createHash('sha256').update(projectRoot).digest('hex').slice(0, 12);
}

export function hudaiHome(): string {
  const dir = path.join(process.env.HOME ?? '~', '.hudai');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function projectDir(projectRoot: string): string {
  const dir = path.join(hudaiHome(), 'projects', projectHash(projectRoot));
  fs.mkdirSync(dir, { recursive: true });

  // Write breadcrumb so we can map hash → real path
  const breadcrumb = path.join(dir, 'project.json');
  if (!fs.existsSync(breadcrumb)) {
    fs.writeFileSync(
      breadcrumb,
      JSON.stringify({ rootPath: projectRoot, createdAt: new Date().toISOString() }, null, 2),
      'utf-8',
    );
  }

  return dir;
}

export function dbPath(): string {
  return path.join(hudaiHome(), 'hudai.db');
}
