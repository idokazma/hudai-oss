import { EventEmitter } from 'node:events';

/**
 * Mock AgentProcess that records all writes and can simulate pane content.
 * Matches the shape expected by CommandHandler.
 */
export class MockAgentProcess extends EventEmitter {
  private _running = true;
  private _writtenData: string[] = [];

  get running(): boolean {
    return this._running;
  }

  set running(value: boolean) {
    this._running = value;
  }

  write(text: string): void {
    this._writtenData.push(text);
  }

  sendEnter(): void {
    this._writtenData.push('<ENTER>');
  }

  sendInterrupt(): void {
    this._writtenData.push('<INTERRUPT>');
  }

  sendKeys(keys: string): void {
    this._writtenData.push(`<KEY:${keys}>`);
  }

  /** Simulate tmux capture-pane output — emits both events like the real AgentProcess */
  simulatePaneContent(lines: string[]): void {
    const content = lines.join('\n');
    this.emit('pane-content', content, null);
    this.emit('data', content);
  }

  getWrittenData(): string[] {
    return [...this._writtenData];
  }

  clearWrittenData(): void {
    this._writtenData = [];
  }
}
