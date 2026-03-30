import { useState, useEffect, useRef, useMemo, type KeyboardEvent } from 'react';
import { wsClient } from '../../../ws/ws-client.js';
import { useEventStore } from '../../../stores/event-store.js';
import { colors, fonts, alpha } from '../../../theme/tokens.js';

interface ChatLine {
  kind: 'human' | 'agent';
  text: string;
  ts: number;
}

/** Strip XML-like tags (e.g. <task-notification>, <command-name>) from text */
function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * HumanShell — Flat conversation view with human prompts highlighted inline.
 */
export function HumanShell() {
  const [input, setInput] = useState('');
  const events = useEventStore((s) => s.events);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Build interleaved human + agent lines from events
  const lines = useMemo(() => {
    const result: ChatLine[] = [];
    for (const ev of events) {
      if (ev.type === 'task.start') {
        const text = stripTags(((ev as any).data?.prompt || '').trim());
        if (text) result.push({ kind: 'human', text, ts: ev.timestamp });
      } else if (ev.type === 'raw.output') {
        const text = ((ev as any).data?.text || '').trim();
        // Skip tool-use lines like "TaskCreate(args)" emitted by the parser
        if (text && !/^[A-Z]\w+\(/.test(text)) {
          result.push({ kind: 'agent', text, ts: ev.timestamp });
        }
      }
    }
    return result;
  }, [events]);

  // Auto-scroll on new content
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 30);
  };

  const send = () => {
    const text = input.trim();
    if (!text) return;
    wsClient.send({ kind: 'command', command: { type: 'prompt', data: { text } } });
    setInput('');
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Agent prose */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '6px 10px',
          minHeight: 0,
        }}
      >
        {lines.length === 0 ? (
          <div
            style={{
              padding: 20,
              textAlign: 'center',
              color: colors.text.dimmed,
              fontSize: 11,
              fontFamily: fonts.mono,
            }}
          >
            Waiting for agent output...
          </div>
        ) : (
          lines.map((line, i) =>
            line.kind === 'human' ? (
              <div
                key={i}
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 11,
                  fontWeight: 600,
                  color: colors.accent.primary,
                  background: alpha(colors.accent.primary, 0.08),
                  borderLeft: `3px solid ${colors.accent.primary}`,
                  padding: '4px 8px',
                  margin: '6px 0',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: 1.5,
                  borderRadius: '0 3px 3px 0',
                }}
              >
                &gt; {line.text}
              </div>
            ) : (
              <div
                key={i}
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 11,
                  color: colors.text.secondary,
                  lineHeight: 1.5,
                  padding: '2px 0',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {line.text}
              </div>
            )
          )
        )}
      </div>

      {/* Input line */}
      <div
        style={{
          flexShrink: 0,
          borderTop: `1px solid ${colors.border.subtle}`,
          padding: '4px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: colors.bg.secondary,
        }}
      >
        <span style={{ color: colors.accent.primary, fontSize: 11, fontFamily: fonts.mono, flexShrink: 0 }}>
          &gt;
        </span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send to agent..."
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: colors.text.primary,
            fontSize: 11,
            fontFamily: fonts.mono,
          }}
        />
        <button
          onClick={send}
          disabled={!input.trim()}
          style={{
            background: 'none',
            border: 'none',
            color: input.trim() ? colors.accent.primary : colors.text.muted,
            fontSize: 12,
            fontFamily: fonts.mono,
            cursor: input.trim() ? 'pointer' : 'default',
            padding: '2px 4px',
            flexShrink: 0,
          }}
        >
          ↵
        </button>
      </div>
    </div>
  );
}
