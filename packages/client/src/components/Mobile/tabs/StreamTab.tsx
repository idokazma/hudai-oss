import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { useChatStore } from '../../../stores/chat-store.js';
import { useEventStore } from '../../../stores/event-store.js';
import { wsClient } from '../../../ws/ws-client.js';
import { colors, fonts, alpha, EVENT_COLORS } from '../../../theme/tokens.js';
import type { ChatMessage, AVPEvent } from '@hudai/shared';

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

type StreamItem =
  | { kind: 'message'; data: ChatMessage }
  | { kind: 'event'; data: AVPEvent };

function EventDot({ event }: { event: AVPEvent }) {
  const color = EVENT_COLORS[event.type] ?? colors.text.dimmed;
  const label =
    event.type === 'file.read' || event.type === 'file.edit' || event.type === 'file.create'
      ? (event as any).data?.path?.split('/').pop() ?? event.type
      : event.type === 'shell.run'
        ? (event as any).data?.command?.slice(0, 40) ?? 'shell'
        : event.type.replace('.', ' ');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px' }}>
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: 12,
          fontFamily: fonts.mono,
          color: colors.text.dimmed,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.text.dimmed, marginLeft: 'auto', flexShrink: 0 }}>
        {timeAgo(event.timestamp)}
      </span>
    </div>
  );
}

function MessageItem({ msg }: { msg: ChatMessage }) {
  const resolveMessage = useChatStore((s) => s.resolveMessage);

  // Permission prompt
  if (msg.actionable) {
    return (
      <div style={{ padding: '6px 16px' }}>
        <div
          style={{
            padding: '10px 14px',
            background: alpha(colors.status.warning, 0.08),
            borderLeft: `3px solid ${colors.status.warning}`,
            borderRadius: 6,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: colors.status.warning,
              marginBottom: 6,
            }}
          >
            Approval needed
          </div>
          <div
            style={{
              fontSize: 13,
              fontFamily: fonts.mono,
              color: colors.text.secondary,
              lineHeight: 1.4,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              marginBottom: 10,
            }}
          >
            {msg.text}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => {
                wsClient.send({ kind: 'command', command: { type: 'approve' } });
                resolveMessage(msg.id);
              }}
              style={{
                flex: 1,
                height: 44,
                border: 'none',
                borderRadius: 8,
                background: colors.status.success,
                color: colors.text.white,
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Approve
            </button>
            <button
              onClick={() => {
                wsClient.send({ kind: 'command', command: { type: 'reject' } });
                resolveMessage(msg.id);
              }}
              style={{
                flex: 1,
                height: 44,
                border: 'none',
                borderRadius: 8,
                background: colors.status.error,
                color: colors.text.white,
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Reject
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Question
  if (msg.respondable) {
    return (
      <div style={{ padding: '6px 16px' }}>
        <div
          style={{
            padding: '10px 14px',
            background: alpha(colors.accent.primary, 0.06),
            borderLeft: `3px solid ${colors.accent.primary}`,
            borderRadius: 6,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontFamily: fonts.mono,
              color: colors.text.secondary,
              lineHeight: 1.4,
              marginBottom: 8,
            }}
          >
            {msg.text}
          </div>
          {msg.options?.map((opt, idx) => (
            <button
              key={idx}
              onClick={() => {
                wsClient.send({ kind: 'command', command: { type: 'prompt', data: { text: String(idx + 1) } } });
                resolveMessage(msg.id);
              }}
              style={{
                display: 'block',
                width: '100%',
                padding: '10px 12px',
                marginBottom: 4,
                background: colors.surface.base,
                border: `1px solid ${colors.border.subtle}`,
                borderRadius: 8,
                color: colors.text.primary,
                fontSize: 14,
                fontFamily: fonts.mono,
                cursor: 'pointer',
                textAlign: 'left',
                minHeight: 44,
              }}
            >
              <span style={{ color: colors.accent.primary, fontWeight: 700, marginRight: 8 }}>
                {idx + 1}.
              </span>
              {opt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // System notification
  if (msg.role === 'system') {
    return (
      <div
        style={{
          padding: '4px 16px',
          fontSize: 12,
          fontFamily: fonts.mono,
          color: colors.text.muted,
          textAlign: 'center',
          fontStyle: 'italic',
        }}
      >
        {msg.text}
      </div>
    );
  }

  // User message
  if (msg.role === 'user') {
    return (
      <div style={{ padding: '4px 16px', display: 'flex', justifyContent: 'flex-end' }}>
        <div
          style={{
            maxWidth: '85%',
            padding: '10px 14px',
            background: alpha(colors.accent.primary, 0.12),
            borderRadius: '12px 12px 2px 12px',
            fontSize: 14,
            fontFamily: fonts.mono,
            color: colors.text.primary,
            lineHeight: 1.5,
          }}
        >
          {msg.text}
        </div>
      </div>
    );
  }

  // Advisor message
  return (
    <div style={{ padding: '4px 16px', display: 'flex', justifyContent: 'flex-start' }}>
      <div
        style={{
          maxWidth: '85%',
          padding: '10px 14px',
          background: colors.surface.dimmest,
          borderRadius: '12px 12px 12px 2px',
          fontSize: 14,
          fontFamily: fonts.mono,
          color: colors.text.primary,
          lineHeight: 1.5,
        }}
      >
        {msg.proactive && (
          <span
            style={{
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: colors.action.think,
              display: 'block',
              marginBottom: 4,
              fontWeight: 600,
            }}
          >
            {msg.severity === 'critical' ? 'Alert' : msg.severity === 'warning' ? 'Warning' : 'Insight'}
          </span>
        )}
        {msg.text}
        <div style={{ fontSize: 10, color: colors.text.dimmed, marginTop: 4, textAlign: 'right' }}>
          {timeAgo(msg.timestamp)}
        </div>
      </div>
    </div>
  );
}

export function StreamTab() {
  const messages = useChatStore((s) => s.messages);
  const events = useEventStore((s) => s.events);
  const typing = useChatStore((s) => s.typing);
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Merge messages and events into a timeline
  const items: StreamItem[] = [];

  // Add significant events (skip raw.output, detail.collapsed)
  const significantEvents = events.filter(
    (e) =>
      e.type !== 'raw.output' &&
      e.type !== 'detail.collapsed' &&
      e.type !== 'think.start' &&
      e.type !== 'think.end',
  );
  // Only show last 50 events to keep it snappy
  const recentEvents = significantEvents.slice(-50);
  for (const ev of recentEvents) {
    items.push({ kind: 'event', data: ev });
  }
  for (const msg of messages) {
    items.push({ kind: 'message', data: msg });
  }
  items.sort((a, b) => {
    const tsA = a.kind === 'message' ? a.data.timestamp : a.data.timestamp;
    const tsB = b.kind === 'message' ? b.data.timestamp : b.data.timestamp;
    return tsA - tsB;
  });

  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [items.length, typing, autoScroll]);

  const handleScroll = () => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  };

  const send = () => {
    const text = input.trim();
    if (!text) return;
    wsClient.send({ kind: 'chat.send', text });
    setInput('');
    setAutoScroll(true);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Message list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          padding: '8px 0',
        }}
      >
        {items.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontFamily: fonts.mono,
              color: colors.text.dimmed,
            }}
          >
            Activity stream
          </div>
        ) : (
          items.map((item, i) =>
            item.kind === 'message' ? (
              <MessageItem key={`m-${item.data.id}`} msg={item.data} />
            ) : (
              <EventDot key={`e-${item.data.id}-${i}`} event={item.data} />
            ),
          )
        )}

        {typing && (
          <div style={{ padding: '4px 16px' }}>
            <div
              style={{
                display: 'inline-block',
                padding: '8px 14px',
                background: colors.surface.dimmer,
                borderRadius: 12,
                fontSize: 14,
                fontFamily: fonts.mono,
                color: colors.text.muted,
                animation: 'mobilePulse 1.5s ease-in-out infinite',
              }}
            >
              ···
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div
        style={{
          flexShrink: 0,
          borderTop: `1px solid ${colors.border.subtle}`,
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about the session..."
          style={{
            flex: 1,
            height: 40,
            background: colors.surface.dimmer,
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: 20,
            color: colors.text.primary,
            fontSize: 14,
            fontFamily: fonts.mono,
            padding: '0 16px',
            outline: 'none',
          }}
        />
        <button
          onClick={send}
          disabled={!input.trim()}
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: 'none',
            background: input.trim() ? colors.accent.primary : colors.surface.dimmer,
            color: colors.text.white,
            fontSize: 18,
            cursor: input.trim() ? 'pointer' : 'default',
            opacity: input.trim() ? 1 : 0.4,
            flexShrink: 0,
          }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
