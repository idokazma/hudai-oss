import { describe, it, expect, beforeEach } from 'vitest';
import { usePlanStore } from '../stores/plan-store.js';
import type { AVPEvent } from '@hudai/shared';

function makeEvent(type: string, data: any, sessionId = 'test-session'): AVPEvent {
  return {
    id: `e-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    timestamp: Date.now(),
    category: 'control',
    type,
    data,
  } as AVPEvent;
}

describe('usePlanStore', () => {
  beforeEach(() => {
    usePlanStore.getState().clear();
    usePlanStore.getState().setSessionId('test-session');
  });

  // --- plan.update (explicit plan) ---

  it('plan.update creates tasks with correct statuses', () => {
    const event = makeEvent('plan.update', {
      steps: ['Step A', 'Step B', 'Step C'],
      currentStep: 1,
    });
    usePlanStore.getState().updateFromEvent(event);
    const tasks = usePlanStore.getState().tasks;
    expect(tasks).toHaveLength(3);
    expect(tasks[0].status).toBe('done');
    expect(tasks[1].status).toBe('active');
    expect(tasks[2].status).toBe('queued');
  });

  it('plan.update sets hasExplicitPlan', () => {
    usePlanStore.getState().updateFromEvent(makeEvent('plan.update', {
      steps: ['A'], currentStep: 0,
    }));
    expect(usePlanStore.getState().hasExplicitPlan).toBe(true);
  });

  it('plan.update with stepFiles populates file arrays', () => {
    usePlanStore.getState().updateFromEvent(makeEvent('plan.update', {
      steps: ['Step A', 'Step B'],
      currentStep: 0,
      stepFiles: [['file1.ts'], ['file2.ts', 'file3.ts']],
    }));
    expect(usePlanStore.getState().tasks[0].files).toEqual(['file1.ts']);
    expect(usePlanStore.getState().tasks[1].files).toEqual(['file2.ts', 'file3.ts']);
  });

  it('plan.update with stepDescriptions populates detail', () => {
    usePlanStore.getState().updateFromEvent(makeEvent('plan.update', {
      steps: ['A', 'B'],
      currentStep: 0,
      stepDescriptions: ['Detailed A', 'Detailed B'],
    }));
    expect(usePlanStore.getState().tasks[0].detail).toBe('Detailed A');
    expect(usePlanStore.getState().tasks[1].detail).toBe('Detailed B');
  });

  // --- file tracking on active task ---

  it('file events add to active task files when explicit plan', () => {
    usePlanStore.getState().updateFromEvent(makeEvent('plan.update', {
      steps: ['Step A'], currentStep: 0,
    }));
    usePlanStore.getState().updateFromEvent(makeEvent('file.read', { path: '/src/a.ts' }));
    expect(usePlanStore.getState().tasks[0].files).toContain('/src/a.ts');
  });

  it('duplicate file paths are not added twice', () => {
    usePlanStore.getState().updateFromEvent(makeEvent('plan.update', {
      steps: ['Step A'], currentStep: 0,
    }));
    usePlanStore.getState().updateFromEvent(makeEvent('file.read', { path: '/a.ts' }));
    usePlanStore.getState().updateFromEvent(makeEvent('file.read', { path: '/a.ts' }));
    expect(usePlanStore.getState().tasks[0].files).toEqual(['/a.ts']);
  });

  // --- task.complete advancing ---

  it('task.complete advances active to done and promotes next', () => {
    usePlanStore.getState().updateFromEvent(makeEvent('plan.update', {
      steps: ['A', 'B', 'C'], currentStep: 0,
    }));
    usePlanStore.getState().updateFromEvent(makeEvent('task.complete', { summary: 'done A' }));
    const tasks = usePlanStore.getState().tasks;
    expect(tasks[0].status).toBe('done');
    expect(tasks[1].status).toBe('active');
    expect(tasks[2].status).toBe('queued');
  });

  // --- session filtering ---

  it('events with mismatched sessionId are ignored', () => {
    usePlanStore.getState().updateFromEvent(makeEvent('plan.update', {
      steps: ['A'], currentStep: 0,
    }, 'wrong-session'));
    expect(usePlanStore.getState().tasks).toHaveLength(0);
  });

  // --- inferred tasks from task.start ---

  it('task.start creates inferred task when no explicit plan', () => {
    usePlanStore.getState().updateFromEvent(makeEvent('task.start', {
      prompt: 'Fix the login bug',
    }));
    const tasks = usePlanStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe('Fix the login bug');
    expect(tasks[0].status).toBe('active');
  });

  it('task.start closes previous active task', () => {
    usePlanStore.getState().updateFromEvent(makeEvent('task.start', { prompt: 'First task' }));
    usePlanStore.getState().updateFromEvent(makeEvent('task.start', { prompt: 'Second task' }));
    const tasks = usePlanStore.getState().tasks;
    expect(tasks[0].status).toBe('done');
    expect(tasks[1].status).toBe('active');
  });

  it('task.start deduplicates same name', () => {
    usePlanStore.getState().updateFromEvent(makeEvent('task.start', { prompt: 'Fix bug' }));
    usePlanStore.getState().updateFromEvent(makeEvent('task.start', { prompt: 'Fix bug' }));
    expect(usePlanStore.getState().tasks).toHaveLength(1);
  });

  it('task.start skips meta prompts', () => {
    usePlanStore.getState().updateFromEvent(makeEvent('task.start', { prompt: '/clear' }));
    usePlanStore.getState().updateFromEvent(makeEvent('task.start', { prompt: '/help' }));
    usePlanStore.getState().updateFromEvent(makeEvent('task.start', { prompt: '/exit' }));
    expect(usePlanStore.getState().tasks).toHaveLength(0);
  });

  it('task.start truncates long prompts to 80 chars', () => {
    const longPrompt = 'x'.repeat(100);
    usePlanStore.getState().updateFromEvent(makeEvent('task.start', { prompt: longPrompt }));
    expect(usePlanStore.getState().tasks[0].name).toHaveLength(80);
  });

  // --- task.complete in inferred mode ---

  it('task.complete marks active inferred task as done', () => {
    usePlanStore.getState().updateFromEvent(makeEvent('task.start', { prompt: 'Do work' }));
    usePlanStore.getState().updateFromEvent(makeEvent('task.complete', { summary: 'done' }));
    expect(usePlanStore.getState().tasks[0].status).toBe('done');
  });

  // --- auto-infer from event categories ---

  it('file.read auto-infers Analyzing phase', () => {
    usePlanStore.getState().updateFromEvent(makeEvent('file.read', { path: '/a.ts' }) as any);
    const tasks = usePlanStore.getState().tasks;
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks.find(t => t.name === 'Analyzing')).toBeTruthy();
  });

  it('file.edit auto-infers Modifying phase', () => {
    usePlanStore.getState().updateFromEvent({ ...makeEvent('file.edit', { path: '/b.ts' }), category: 'mutation', type: 'file.edit' } as AVPEvent);
    expect(usePlanStore.getState().tasks.find(t => t.name === 'Modifying')).toBeTruthy();
  });

  it('same category reuses existing active task', () => {
    usePlanStore.getState().updateFromEvent(makeEvent('file.read', { path: '/a.ts' }) as any);
    usePlanStore.getState().updateFromEvent(makeEvent('file.read', { path: '/b.ts' }) as any);
    // Should still be one Analyzing task, not two
    const analyzing = usePlanStore.getState().tasks.filter(t => t.name === 'Analyzing');
    expect(analyzing).toHaveLength(1);
    expect(analyzing[0].files).toContain('/b.ts');
  });

  it('phase reactivation: reuses last done task of same category when no active', () => {
    // Create Analyzing phase, then complete it
    usePlanStore.getState().updateFromEvent(makeEvent('file.read', { path: '/a.ts' }) as any);
    usePlanStore.getState().updateFromEvent(makeEvent('task.complete', { summary: 'done' }));
    // All tasks are done, no active task. Now analyze again — should reactivate.
    usePlanStore.getState().updateFromEvent(makeEvent('file.read', { path: '/c.ts' }) as any);
    const analyzing = usePlanStore.getState().tasks.filter(t => t.name === 'Analyzing');
    expect(analyzing).toHaveLength(1);
    expect(analyzing[0].status).toBe('active');
    expect(analyzing[0].files).toContain('/c.ts');
  });

  // --- markAllDone ---

  it('markAllDone marks all active/queued as done', () => {
    usePlanStore.getState().updateFromEvent(makeEvent('plan.update', {
      steps: ['A', 'B', 'C'], currentStep: 1,
    }));
    usePlanStore.getState().markAllDone();
    const tasks = usePlanStore.getState().tasks;
    expect(tasks.every(t => t.status === 'done')).toBe(true);
  });

  // --- clear ---

  it('clear resets all state including inferCounter', () => {
    usePlanStore.getState().updateFromEvent(makeEvent('task.start', { prompt: 'Task A' }));
    usePlanStore.getState().clear();
    expect(usePlanStore.getState().tasks).toHaveLength(0);
    expect(usePlanStore.getState().hasExplicitPlan).toBe(false);
    expect(usePlanStore.getState().sessionId).toBe('');
  });

  it('setAvailablePlans stores plan files', () => {
    const plans = [{ filename: 'plan.md' }] as any;
    usePlanStore.getState().setAvailablePlans(plans);
    expect(usePlanStore.getState().availablePlans).toBe(plans);
  });
});
