import { useInsightStore } from '../../stores/insight-store.js';
import { wsClient } from '../../ws/ws-client.js';
import { colors, fonts } from '../../theme/tokens.js';
import type { InsightNotification } from '@hudai/shared';

const severityColors: Record<InsightNotification['severity'], string> = {
  info: colors.accent.blue,
  warning: colors.status.warning,
  critical: colors.status.errorLight,
};

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export function IntelTab() {
  const summary = useInsightStore((s) => s.summary);
  const notifications = useInsightStore((s) => s.notifications);

  const handleRefresh = () => {
    wsClient.send({ kind: 'insight.requestSummary' });
  };

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Executive Summary Card */}
      <div style={{
        margin: '10px 10px 6px',
        padding: '10px 12px',
        background: colors.surface.dimmest,
        borderLeft: `3px solid ${colors.accent.blue}`,
        borderRadius: 4,
        flexShrink: 0,
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
            letterSpacing: 1.5,
            color: colors.text.muted,
          }}>
            Executive Summary
          </span>
          <button
            onClick={handleRefresh}
            style={{
              background: 'none',
              border: 'none',
              color: colors.accent.blue,
              fontSize: 12,
              fontFamily: fonts.mono,
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: 3,
              opacity: 0.7,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; }}
          >
            Refresh
          </button>
        </div>

        {summary ? (
          <>
            <div style={{
              fontSize: 13,
              fontFamily: fonts.mono,
              color: colors.text.primary,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}>
              {summary.text}
            </div>
            <div style={{
              fontSize: 11,
              fontFamily: fonts.mono,
              color: colors.text.muted,
              marginTop: 6,
            }}>
              Updated {timeAgo(summary.generatedAt)}
            </div>
          </>
        ) : (
          <div style={{
            fontSize: 12,
            fontFamily: fonts.mono,
            color: colors.text.muted,
            lineHeight: 1.5,
          }}>
            Waiting for agent activity...
          </div>
        )}
      </div>

      {/* Smart Alerts Section */}
      <div style={{
        padding: '6px 10px 4px',
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 1.5,
        color: colors.text.muted,
        flexShrink: 0,
      }}>
        Smart Alerts
        {notifications.length > 0 && (
          <span style={{ marginLeft: 6, fontFamily: fonts.mono }}>
            {notifications.length}
          </span>
        )}
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        padding: '0 10px 10px',
      }}>
        {notifications.length === 0 ? (
          <div style={{
            padding: 16,
            fontSize: 12,
            color: colors.text.muted,
            textAlign: 'center',
          }}>
            No alerts yet
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              style={{
                padding: '8px 10px',
                background: colors.surface.dim,
                borderLeft: `3px solid ${severityColors[n.severity]}`,
                borderRadius: 3,
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  overflow: 'hidden',
                }}>
                  <span style={{
                    color: colors.action.think,
                    fontSize: 12,
                    flexShrink: 0,
                  }}>
                    ✦
                  </span>
                  <span style={{
                    fontSize: 13,
                    fontFamily: fonts.mono,
                    color: colors.text.primary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    lineHeight: 1.3,
                  }}>
                    {n.text}
                  </span>
                </div>
                <span style={{
                  fontSize: 11,
                  fontFamily: fonts.mono,
                  color: colors.text.muted,
                  flexShrink: 0,
                }}>
                  {timeAgo(n.timestamp)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
