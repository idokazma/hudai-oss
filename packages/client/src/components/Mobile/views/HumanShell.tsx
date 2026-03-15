import { useEffect, useRef } from 'react';
import { useEventStore } from '../../../stores/event-store.js';
import { colors, fonts, alpha } from '../../../theme/tokens.js';

interface ConversationEntry {
  id: string;
  timestamp: number;
  role: 'user' | 'agent';
  text: string;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * HumanShell — a filtered terminal view showing only user messages and agent prose.
 * No tool calls, no diffs, no spinners — just the conversation.
 */
export function HumanShell() {
  const events = useEventStore((s) => s.events);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Extract conversation entries from events
  const entries: ConversationEntry[] = [];
  for (const ev of events) {
    if (ev.type === 'task.start') {
      const prompt = ((ev as any).data?.prompt || '').trim();
      if (prompt) {
        entries.push({
          id: ev.id,
          timestamp: ev.timestamp,
          role: 'user',
          text: prompt,
        });
      }
    } else if (ev.type === 'raw.output') {
      const text = ((ev as any).data?.text || '').trim();
      if (!text || text.length < 10) continue;
      entries.push({
        id: ev.id,
        timestamp: ev.timestamp,
        role: 'agent',
        text,
      });
    }
  }

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: fonts.mono,
          fontSize: 13,
          color: colors.text.dimmed,
        }}
      >
        Waiting for conversation...
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: '12px 0',
        fontFamily: fonts.mono,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {entries.map((entry) => (
        <div
          key={entry.id}
          style={{
            padding: '6px 16px',
            borderLeft: `2px solid ${
              entry.role === 'user'
                ? colors.accent.primary
                : alpha(colors.text.muted, 0.3)
            }`,
            marginBottom: 2,
          }}
        >
          {/* Timestamp + role tag */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 2,
            }}
          >
            <span
              style={{
                fontSize: 10,
                color: colors.text.dimmed,
              }}
            >
              {formatTime(entry.timestamp)}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color:
                  entry.role === 'user'
                    ? colors.accent.primary
                    : colors.text.muted,
              }}
            >
              {entry.role === 'user' ? 'you' : 'agent'}
            </span>
          </div>

          {/* Message text */}
          <div
            style={{
              color:
                entry.role === 'user'
                  ? colors.text.primary
                  : colors.text.secondary,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {entry.text}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
