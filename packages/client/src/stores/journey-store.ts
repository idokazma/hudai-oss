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
}

const GROUP_WINDOW_MS = 5000;

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
      return `Tests: ${data?.passed ?? 0} passed, ${data?.failed ?? 0} failed`;
    case 'plan.update':
      return `Plan: ${data?.steps?.length ?? 0} steps`;
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

/** Convert a file path to a graph node ID (relative path) */
function pathToNodeId(filePath: string): string {
  // Strip common absolute prefixes — the graph uses relative paths
  // This is a best-effort match; the graph store's pathToId map would be more accurate
  const parts = filePath.split('/');
  // Find 'src' or 'packages' as anchor
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
    const entries: JourneyEntry[] = [];
    let current: JourneyEntry | null = null;

    for (const event of events) {
      // Skip noise events
      if (event.type === 'raw.output' || event.type === 'detail.collapsed') continue;

      const jType = eventToJourneyType(event);
      const filePath = eventFilePath(event);
      const nodeId = filePath ? pathToNodeId(filePath) : null;
      const action = eventAction(event);

      // Try to merge with current entry if same file within time window
      if (
        current &&
        jType === 'file' &&
        current.type === 'file' &&
        current.nodeId === nodeId &&
        event.timestamp - (current.endTimestamp ?? current.timestamp) < GROUP_WINDOW_MS
      ) {
        if (action && !current.actions.includes(action)) {
          current.actions.push(action);
        }
        current.endTimestamp = event.timestamp;
        current.eventIds.push(event.id);
        continue;
      }

      // Finalize previous entry
      if (current) entries.push(current);

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
      };
    }

    if (current) entries.push(current);

    set({ entries });
  },

  selectEntry: (id) => set({ selectedEntryId: id }),
  clear: () => set({ entries: [], selectedEntryId: null }),
}));
