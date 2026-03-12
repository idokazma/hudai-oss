import { appendFileSync } from 'node:fs';
import type { Scenario, JsonlEntry, HookNotification } from './types.js';

export class PlaybackEngine {
  private timers: NodeJS.Timeout[] = [];
  private scenario: Scenario;
  private filePath: string;
  private speed: number;
  private serverUrl: string;

  constructor(scenario: Scenario, filePath: string, speed = 1, serverUrl = 'http://localhost:4200') {
    this.scenario = scenario;
    this.filePath = filePath;
    this.speed = speed;
    this.serverUrl = serverUrl;
  }

  start(): void {
    console.log(`[engine] Playing "${this.scenario.name}" → ${this.filePath}`);
    console.log(`[engine] ${this.scenario.timeline.length} steps, ${this.speed}x speed`);

    let cumulative = 0;
    for (const step of this.scenario.timeline) {
      cumulative += step.delay / this.speed;
      const delay = cumulative;

      const timer = setTimeout(() => {
        if (step.label) console.log(`[sim] ${step.label}`);
        this.appendEntries(step.entries);
        if (step.hooks) {
          for (const hook of step.hooks) {
            this.postHook(hook);
          }
        }
      }, delay);

      this.timers.push(timer);
    }

    const doneTimer = setTimeout(() => {
      console.log(`[sim] Scenario complete.`);
    }, cumulative + 500);
    this.timers.push(doneTimer);
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private appendEntries(entries: JsonlEntry[]): void {
    const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    appendFileSync(this.filePath, lines);
  }

  private async postHook(hook: HookNotification): Promise<void> {
    try {
      const res = await fetch(`${this.serverUrl}/api/hooks/notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hook),
      });
      if (!res.ok) {
        console.warn(`[sim] Hook POST failed: ${res.status}`);
      }
    } catch {
      // Server may not be running yet — that's fine
      console.warn(`[sim] Hook POST failed — server not reachable`);
    }
  }
}
