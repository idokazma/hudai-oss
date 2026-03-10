import { create } from 'zustand';
import type { AVPEvent } from '@hudai/shared';

export interface JourneyEntry {
  id: string;
  nodeId: string | null;
  filePath: string | null;
  type: 'file' | 'shell' | 'search' | 'think' | 'test' | 'plan' | 'control';
  actions: string[];
  label: string;
  detail?: string;
  timestamp: number;
  endTimestamp?: number;
  eventIds: string[];
  /** Number of times this node was revisited (for file dedup) */
  visits: number;
}

function eventToJourneyType(event: AVPEvent): JourneyEntry['type'] {
  switch (event.type) {
    case 'file.read':
    case 'file.edit':
    case 'file.create':
    case 'file.delete':
      return 'file';
    case 'shell.run':
    case 'shell.output':
      return 'shell';
    case 'search.grep':
    case 'search.glob':
      return 'search';
    case 'think.start':
    case 'think.end':
      return 'think';
    case 'test.run':
    case 'test.result':
      return 'test';
    case 'plan.update':
      return 'plan';
    default:
      return 'control';
  }
}

function eventAction(event: AVPEvent): string {
  switch (event.type) {
    case 'file.read': return 'R';
    case 'file.edit': return 'E';
    case 'file.create': return 'C';
    case 'file.delete': return 'D';
    case 'shell.run': return '$';
    case 'search.grep': return '?';
    case 'search.glob': return '?';
    case 'test.run': return 'T';
    case 'think.start': return '~';
    default: return '';
  }
}

function eventFilePath(event: AVPEvent): string | null {
  const data = (event as any).data;
  if (data?.path) return data.path;
  return null;
}

function eventLabel(event: AVPEvent): string {
  const data = (event as any).data;
  switch (event.type) {
    case 'file.read':
    case 'file.edit':
    case 'file.create':
    case 'file.delete': {
      const p = data?.path ?? '';
      return p.split('/').pop() || p;
    }
    case 'shell.run':
      return data?.command?.slice(0, 60) ?? 'shell';
    case 'search.grep':
    case 'search.glob':
      return data?.pattern?.slice(0, 60) ?? 'search';
    case 'think.start':
      return data?.summary?.slice(0, 60) ?? 'Thinking...';
    case 'think.end':
      return data?.summary?.slice(0, 60) ?? 'Done thinking';
    case 'test.run':
      return data?.command?.slice(0, 60) ?? 'Running tests';
    case 'test.result':
      return `${data?.passed ?? 0} passed, ${data?.failed ?? 0} failed`;
    case 'plan.update':
      return `${data?.steps?.length ?? 0} steps`;
    case 'task.start':
      return data?.prompt?.slice(0, 60) ?? 'Task started';
    default:
      return event.type;
  }
}

function eventDetail(event: AVPEvent): string | undefined {
  const data = (event as any).data;
  switch (event.type) {
    case 'file.read':
    case 'file.edit':
    case 'file.create':
    case 'file.delete':
      return data?.path;
    case 'shell.run':
      return data?.command;
    case 'search.grep':
    case 'search.glob':
      return data?.pattern;
    default:
      return undefined;
  }
}

function pathToNodeId(filePath: string): string {
  const parts = filePath.split('/');
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === 'src' || parts[i] === 'packages' || parts[i] === 'lib') {
      return parts.slice(i).join('/');
    }
  }
  return filePath;
}

export interface JourneyStore {
  entries: JourneyEntry[];
  selectedEntryId: string | null;
  processEvents: (events: AVPEvent[]) => void;
  selectEntry: (id: string | null) => void;
  clear: () => void;
}

export const useJourneyStore = create<JourneyStore>((set) => ({
  entries: [],
  selectedEntryId: null,

  processEvents: (events) => {
    // Phase 1: Build raw sequential entries with consecutive grouping
    const raw: JourneyEntry[] = [];
    let current: JourneyEntry | null = null;

    for (const event of events) {
      if (event.type === 'raw.output' || event.type === 'detail.collapsed') continue;

      const jType = eventToJourneyType(event);
      // Skip control/think noise
      if (jType === 'control' || jType === 'think') continue;

      const filePath = eventFilePath(event);
      const nodeId = filePath ? pathToNodeId(filePath) : null;
      const action = eventAction(event);

      // Merge consecutive same-file or same-type events
      if (current) {
        const sameFile = jType === 'file' && current.type === 'file' && current.nodeId === nodeId;
        const sameType = jType !== 'file' && jType === current.type;
        if (sameFile || sameType) {
          if (action && !current.actions.includes(action)) {
            current.actions.push(action);
          }
          current.endTimestamp = event.timestamp;
          current.eventIds.push(event.id);
          // Update label for test results
          if (event.type === 'test.result') {
            current.label = eventLabel(event);
          }
          continue;
        }
      }

      if (current) raw.push(current);

      current = {
        id: event.id,
        nodeId,
        filePath,
        type: jType,
        actions: action ? [action] : [],
        label: eventLabel(event),
        detail: eventDetail(event),
        timestamp: event.timestamp,
        eventIds: [event.id],
        visits: 1,
      };
    }

    if (current) raw.push(current);

    // Phase 2: Deduplicate files — merge entries with same nodeId
    const deduped: JourneyEntry[] = [];
    const fileMap = new Map<string, number>(); // nodeId → index in deduped

    for (const entry of raw) {
      if (entry.type === 'file' && entry.nodeId) {
        const existing = fileMap.get(entry.nodeId);
        if (existing !== undefined) {
          const target = deduped[existing];
          for (const a of entry.actions) {
            if (!target.actions.includes(a)) target.actions.push(a);
          }
          target.endTimestamp = entry.timestamp;
          target.eventIds.push(...entry.eventIds);
          target.visits++;
          continue;
        }
        fileMap.set(entry.nodeId, deduped.length);
      }
      deduped.push(entry);
    }

    set({ entries: deduped });
  },

  selectEntry: (id) => set({ selectedEntryId: id }),
  clear: () => set({ entries: [], selectedEntryId: null }),
}));
