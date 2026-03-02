import { useSessionStore } from '../stores/session-store.js';
import { useEventStore } from '../stores/event-store.js';
import { useLibraryStore } from '../stores/library-store.js';
import { wsClient } from '../ws/ws-client.js';
import { colors, alpha, fonts } from '../theme/tokens.js';

function formatElapsed(startedAt: number): string {
  if (!startedAt) return '0:00';
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

const statusColors: Record<string, string> = {
  idle: colors.text.muted,
  running: colors.accent.blue,
  paused: colors.status.warning,
  complete: colors.status.successLight,
  error: colors.status.errorLight,
};

const activityLabels: Record<string, { label: string; color: string; pulse?: boolean }> = {
  working: { label: 'WORKING', color: colors.accent.blue, pulse: true },
  waiting_permission: { label: 'NEEDS APPROVAL', color: colors.status.errorLight, pulse: true },
  waiting_input: { label: 'IDLE', color: colors.status.warning },
  waiting_answer: { label: 'ASKING QUESTION', color: colors.status.warning, pulse: true },
};

export function StatusBar() {
  const session = useSessionStore((s) => s.session);
  const events = useEventStore((s) => s.events);
  const libraryBuilding = useLibraryStore((s) => s.isBuilding);
  const libraryProgress = useLibraryStore((s) => s.buildProgress);
  const libraryModuleCount = useLibraryStore((s) => s.moduleCount);
  const libraryFileCardCount = useLibraryStore((s) => s.fileCardCount);

  // Find latest permission prompt (agent is waiting)
  const latestPermission = [...events].reverse().find((e) => e.type === 'permission.prompt');
  // Check if there's been activity AFTER the permission prompt (means it was already handled)
  const permissionIdx = latestPermission ? events.indexOf(latestPermission) : -1;
  const hasActivityAfter = permissionIdx >= 0 && events.slice(permissionIdx + 1).some(
    (e) => e.type !== 'raw.output' && e.type !== 'permission.prompt'
  );
  const pendingPermission = latestPermission && !hasActivityAfter ? latestPermission : null;

  const handleApprove = () => {
    // Send "y" + Enter to approve in tmux
    wsClient.send({ kind: 'command', command: { type: 'prompt', data: { text: 'y' } } });
  };

  const handleReject = () => {
    wsClient.send({ kind: 'command', command: { type: 'prompt', data: { text: 'n' } } });
  };

  const handleRun = () => {
    wsClient.send({ kind: 'command', command: { type: 'prompt', data: { text: 'Run the project' } } });
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      background: colors.bg.panel,
      borderBottom: `1px solid ${colors.border.subtle}`,
    }}>
      {/* Main status row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        height: 32,
        fontSize: 12,
        fontFamily: fonts.mono,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: statusColors[session.status] ?? colors.text.muted,
              boxShadow: session.status === 'running' ? `0 0 6px ${colors.accent.blue}` : 'none',
            }} />
            <span style={{ color: statusColors[session.status], textTransform: 'uppercase', fontSize: 12, letterSpacing: 1 }}>
              {session.status}
            </span>
          </div>
          {/* Agent activity indicator */}
          {session.status === 'running' && session.agentActivity && activityLabels[session.agentActivity] && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '2px 8px',
              borderRadius: 3,
              background: `${activityLabels[session.agentActivity].color}18`,
              border: `1px solid ${activityLabels[session.agentActivity].color}40`,
            }}>
              {activityLabels[session.agentActivity].pulse && (
                <div style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: activityLabels[session.agentActivity].color,
                  animation: 'pulse 1.5s ease-in-out infinite',
                }} />
              )}
              <span style={{
                color: activityLabels[session.agentActivity].color,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.5,
              }}>
                {activityLabels[session.agentActivity].label}
              </span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, color: colors.text.muted, fontSize: 13 }}>
          {session.agentCurrentFile && (
            <span style={{ color: colors.text.secondary }}>{session.agentCurrentFile}</span>
          )}
          {libraryBuilding && libraryProgress && (
            <span style={{ color: colors.accent.blue }}>
              Library: {libraryProgress.label}
            </span>
          )}
          {!libraryBuilding && libraryModuleCount > 0 && (
            <span style={{ color: colors.status.successLight }}>
              Library ready
            </span>
          )}
          <span>{events.length} events</span>
          <span>{formatElapsed(session.startedAt)}</span>
          <button
            onClick={handleRun}
            style={{
              padding: '3px 10px',
              border: `1px solid ${colors.status.success}60`,
              borderRadius: 4,
              background: `${colors.status.success}20`,
              color: colors.status.successLight,
              fontSize: 11,
              fontFamily: fonts.mono,
              fontWeight: 600,
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
            title="Tell the agent to run the project"
          >
            Run
          </button>
        </div>
      </div>

      {/* Agent activity detail banner */}
      {session.status === 'running' && session.agentActivity && session.agentActivity !== 'working' && session.agentActivityDetail && !pendingPermission && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '5px 16px',
          background: session.agentActivity === 'waiting_answer'
            ? alpha(colors.status.warning, 0.12)
            : alpha(colors.accent.primary, 0.08),
          borderTop: `1px solid ${session.agentActivity === 'waiting_answer'
            ? alpha(colors.status.warning, 0.25)
            : alpha(colors.accent.primary, 0.15)}`,
          fontSize: 13,
          fontFamily: fonts.mono,
          color: colors.text.secondary,
          gap: 8,
        }}>
          <span style={{
            color: session.agentActivity === 'waiting_answer' ? colors.status.warning : colors.accent.blue,
            fontWeight: 600,
            fontSize: 12,
          }}>
            {session.agentActivity === 'waiting_input' ? '❯' : '?'}
          </span>
          {session.agentActivityDetail}
        </div>
      )}

      {/* Permission prompt banner */}
      {pendingPermission && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 16px',
          background: alpha(colors.status.errorLight, 0.15),
          borderTop: `1px solid ${alpha(colors.status.errorLight, 0.3)}`,
          fontSize: 12,
          fontFamily: fonts.mono,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: colors.status.errorLight, fontWeight: 700 }}>⚠ APPROVAL NEEDED</span>
            <span style={{ color: colors.text.primary }}>
              {(pendingPermission as any).data.tool}: {(pendingPermission as any).data.command}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handleApprove} style={{
              padding: '3px 12px', border: 'none', borderRadius: 4,
              background: colors.status.success, color: colors.text.white, fontSize: 13,
              fontWeight: 600, cursor: 'pointer',
            }}>
              Approve
            </button>
            <button onClick={handleReject} style={{
              padding: '3px 12px', border: 'none', borderRadius: 4,
              background: colors.status.error, color: colors.text.white, fontSize: 13,
              fontWeight: 600, cursor: 'pointer',
            }}>
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
