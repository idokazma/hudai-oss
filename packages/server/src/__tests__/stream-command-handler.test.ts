import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamCommandHandler } from '../agent/stream-command-handler.js';

// Mock AgentHost
function createMockHost() {
  return {
    resume: vi.fn(),
    terminate: vi.fn(),
  };
}

describe('StreamCommandHandler', () => {
  let handler: StreamCommandHandler;
  let mockHost: ReturnType<typeof createMockHost>;

  beforeEach(() => {
    mockHost = createMockHost();
    handler = new StreamCommandHandler(mockHost as any);
  });

  it('handles prompt by calling resume', () => {
    handler.handle({ type: 'prompt', data: { text: 'Fix the bug' } });
    expect(mockHost.resume).toHaveBeenCalledWith('Fix the bug');
  });

  it('handles focus_file by calling resume with instruction', () => {
    handler.handle({ type: 'focus_file', data: { path: 'src/auth.ts' } });
    expect(mockHost.resume).toHaveBeenCalledWith(
      expect.stringContaining('src/auth.ts')
    );
  });

  it('handles scope_boundary by calling resume with file list', () => {
    handler.handle({
      type: 'scope_boundary',
      data: { files: ['src/a.ts', 'src/b.ts'] },
    });
    expect(mockHost.resume).toHaveBeenCalledWith(
      expect.stringContaining('src/a.ts, src/b.ts')
    );
  });

  it('handles pause by terminating', () => {
    handler.handle({ type: 'pause' } as any);
    expect(mockHost.terminate).toHaveBeenCalled();
  });

  it('handles cancel by terminating', () => {
    handler.handle({ type: 'cancel' } as any);
    expect(mockHost.terminate).toHaveBeenCalled();
  });

  it('handles resume by calling resume', () => {
    handler.handle({ type: 'resume' } as any);
    expect(mockHost.resume).toHaveBeenCalledWith('Continue with the previous task.');
  });

  it('handles reject by terminating', () => {
    handler.handle({ type: 'reject' } as any);
    expect(mockHost.terminate).toHaveBeenCalled();
  });

  it('handles approve as no-op (does not crash)', () => {
    handler.handle({ type: 'approve' } as any);
    expect(mockHost.resume).not.toHaveBeenCalled();
    expect(mockHost.terminate).not.toHaveBeenCalled();
  });

  it('handles send_keys as no-op', () => {
    handler.handle({ type: 'send_keys', data: { keys: 'Enter' } } as any);
    expect(mockHost.resume).not.toHaveBeenCalled();
    expect(mockHost.terminate).not.toHaveBeenCalled();
  });
});
