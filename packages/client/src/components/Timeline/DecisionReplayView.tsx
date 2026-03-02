import { useReplayStore } from '../../stores/replay-store.js';
import { colors, fonts, alpha, EVENT_COLORS } from '../../theme/tokens.js';

export function DecisionReplayView() {
  const decisions = useReplayStore((s) => s.decisions);
  const decisionCursor = useReplayStore((s) => s.decisionCursor);
  const stepForward = useReplayStore((s) => s.stepDecisionForward);
  const stepBackward = useReplayStore((s) => s.stepDecisionBackward);

  if (decisions.length === 0) {
    return (
      <div style={{ color: colors.text.muted, fontSize: 13, padding: '12px 16px' }}>
        No decisions to replay
      </div>
    );
  }

  const decision = decisions[decisionCursor];
  if (!decision) return null;

  const thinkSummary = decision.thinkEvent
    ? (decision.thinkEvent as any).data?.summary || 'No summary'
    : 'No thinking block';

  const btnStyle: React.CSSProperties = {
    background: 'none',
    border: `1px solid ${colors.border.subtle}`,
    borderRadius: 3,
    color: colors.text.secondary,
    cursor: 'pointer',
    fontSize: 13,
    width: 28,
    height: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  };

  return (
    <div style={{
      display: 'flex',
      flex: 1,
      overflow: 'hidden',
      padding: '8px 16px',
      gap: 16,
    }}>
      {/* Left: Thinking summary */}
      <div style={{
        flex: 1,
        minWidth: 0,
        background: alpha(colors.action.think, 0.08),
        border: `1px solid ${alpha(colors.action.think, 0.2)}`,
        borderRadius: 6,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 1,
          color: colors.action.think,
          fontWeight: 600,
          marginBottom: 6,
        }}>
          Reasoning
        </div>
        <div style={{
          fontSize: 13,
          fontFamily: fonts.mono,
          color: colors.text.secondary,
          lineHeight: 1.5,
          overflow: 'auto',
          flex: 1,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {thinkSummary}
        </div>
      </div>

      {/* Right: Action list */}
      <div style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}>
          <span style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 1,
            color: colors.text.muted,
            fontWeight: 600,
          }}>
            Actions ({decision.actionEvents.length})
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={stepBackward} style={btnStyle} disabled={decisionCursor === 0}>◀</button>
            <span style={{
              fontSize: 12,
              fontFamily: fonts.mono,
              color: colors.text.secondary,
              minWidth: 60,
              textAlign: 'center',
            }}>
              Decision {decisionCursor + 1}/{decisions.length}
            </span>
            <button onClick={stepForward} style={btnStyle} disabled={decisionCursor >= decisions.length - 1}>▶</button>
          </div>
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>
          {decision.actionEvents.map((event) => (
            <div
              key={event.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '3px 0',
                fontSize: 12,
                fontFamily: fonts.mono,
                color: colors.text.secondary,
              }}
            >
              <div style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: EVENT_COLORS[event.type] || colors.text.muted,
                flexShrink: 0,
              }} />
              <span style={{ color: EVENT_COLORS[event.type] || colors.text.muted }}>
                {event.type}
              </span>
              <span style={{
                color: colors.text.muted,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {getActionSummary(event)}
              </span>
            </div>
          ))}
          {decision.actionEvents.length === 0 && (
            <div style={{ color: colors.text.muted, fontSize: 12, padding: '4px 0' }}>
              No actions in this decision
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getActionSummary(event: any): string {
  switch (event.type) {
    case 'file.read': case 'file.edit': case 'file.create': case 'file.delete':
      return event.data.path?.split('/').pop() || '';
    case 'shell.run': return event.data.command?.slice(0, 40) || '';
    case 'search.grep': case 'search.glob': return event.data.pattern?.slice(0, 30) || '';
    case 'subagent.start': return event.data.agentType || '';
    default: return '';
  }
}
