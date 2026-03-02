import { describe, it, expect } from 'vitest';
import { useJourneyStore } from '../stores/journey-store.js';
import type { AVPEvent } from '@hudai/shared';

function makeEvent(type: string, data: Record<string, any> = {}, ts = 1000): AVPEvent {
  return {
    id: `evt-${type}-${ts}-${Math.random()}`,
    sessionId: 'test',
    timestamp: ts,
    category: 'navigation',
    type,
    source: 'test',
    data,
  } as AVPEvent;
}

describe('journey-store helpers (via processEvents)', () => {
  it('maps file.read to file type journey entry', () => {
    useJourneyStore.getState().processEvents([
      makeEvent('file.read', { path: '/project/src/foo.ts' }),
    ]);
    const entries = useJourneyStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('file');
    expect(entries[0].actions).toContain('R');
  });

  it('maps file.edit to E action', () => {
    useJourneyStore.getState().processEvents([
      makeEvent('file.edit', { path: '/project/src/bar.ts' }),
    ]);
    expect(useJourneyStore.getState().entries[0].actions).toContain('E');
  });

  it('maps file.create to C action', () => {
    useJourneyStore.getState().processEvents([
      makeEvent('file.create', { path: '/project/src/new.ts' }),
    ]);
    expect(useJourneyStore.getState().entries[0].actions).toContain('C');
  });

  it('maps shell.run to $ action', () => {
    useJourneyStore.getState().processEvents([
      makeEvent('shell.run', { command: 'npm test' }),
    ]);
    const entry = useJourneyStore.getState().entries[0];
    expect(entry.type).toBe('shell');
    expect(entry.actions).toContain('$');
  });

  it('maps search.grep to ? action', () => {
    useJourneyStore.getState().processEvents([
      makeEvent('search.grep', { pattern: 'foo' }),
    ]);
    expect(useJourneyStore.getState().entries[0].actions).toContain('?');
  });

  it('maps think.start to ~ action', () => {
    useJourneyStore.getState().processEvents([
      makeEvent('think.start', { summary: 'Analyzing...' }),
    ]);
    const entry = useJourneyStore.getState().entries[0];
    expect(entry.type).toBe('think');
    expect(entry.actions).toContain('~');
  });

  it('skips raw.output events', () => {
    useJourneyStore.getState().processEvents([
      makeEvent('raw.output', { text: 'some text' }),
    ]);
    expect(useJourneyStore.getState().entries).toHaveLength(0);
  });

  it('extracts file path from event data', () => {
    useJourneyStore.getState().processEvents([
      makeEvent('file.read', { path: '/project/src/utils/helpers.ts' }),
    ]);
    expect(useJourneyStore.getState().entries[0].filePath).toBe('/project/src/utils/helpers.ts');
  });
});

describe('pathToNodeId (via processEvents)', () => {
  it('strips absolute prefix and anchors on src', () => {
    useJourneyStore.getState().processEvents([
      makeEvent('file.read', { path: '/Users/me/project/src/index.ts' }),
    ]);
    expect(useJourneyStore.getState().entries[0].nodeId).toBe('src/index.ts');
  });

  it('anchors on packages', () => {
    useJourneyStore.getState().processEvents([
      makeEvent('file.read', { path: '/Users/me/project/packages/client/src/App.tsx' }),
    ]);
    expect(useJourneyStore.getState().entries[0].nodeId).toBe('packages/client/src/App.tsx');
  });

  it('returns full path when no anchor found', () => {
    useJourneyStore.getState().processEvents([
      makeEvent('file.read', { path: 'README.md' }),
    ]);
    expect(useJourneyStore.getState().entries[0].nodeId).toBe('README.md');
  });
});

describe('journey grouping', () => {
  it('groups same file events within 5s window', () => {
    useJourneyStore.getState().processEvents([
      makeEvent('file.read', { path: '/project/src/a.ts' }, 1000),
      makeEvent('file.edit', { path: '/project/src/a.ts' }, 2000),
    ]);
    const entries = useJourneyStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].actions).toContain('R');
    expect(entries[0].actions).toContain('E');
  });

  it('splits entries when time gap exceeds 5s', () => {
    useJourneyStore.getState().processEvents([
      makeEvent('file.read', { path: '/project/src/a.ts' }, 1000),
      makeEvent('file.read', { path: '/project/src/a.ts' }, 7000),
    ]);
    expect(useJourneyStore.getState().entries).toHaveLength(2);
  });

  it('different files are separate entries', () => {
    useJourneyStore.getState().processEvents([
      makeEvent('file.read', { path: '/project/src/a.ts' }, 1000),
      makeEvent('file.read', { path: '/project/src/b.ts' }, 1500),
    ]);
    expect(useJourneyStore.getState().entries).toHaveLength(2);
  });
});
