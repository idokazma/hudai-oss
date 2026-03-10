import React, { useState, useRef, useEffect } from 'react';
import { useChatStore } from '../../stores/chat-store.js';
import { wsClient } from '../../ws/ws-client.js';
import { colors, fonts, alpha } from '../../theme/tokens.js';

const PURPLE = colors.action.think;
const MAX_VISIBLE = 5;

export const AdvisorChat: React.FC = () => {
  const messages = useChatStore((s) => s.messages);
  const typing = useChatStore((s) => s.typing);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const visibleMessages = messages.slice(-MAX_VISIBLE);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    wsClient.send({ kind: 'chat.send', text });
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      style={{
        width: 400,
        maxWidth: '100%',
        borderRadius: 12,
        border: `1px solid ${alpha(PURPLE, 0.25)}`,
        background: alpha(PURPLE, 0.06),
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 14px',
          borderBottom: `1px solid ${alpha(PURPLE, 0.15)}`,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: PURPLE,
            boxShadow: `0 0 6px ${alpha(PURPLE, 0.5)}`,
          }}
        />
        <span
          style={{
            fontSize: 12,
            fontFamily: fonts.display,
            fontWeight: 600,
            color: PURPLE,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          Advisor
        </span>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          padding: '8px 12px',
          maxHeight: 180,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {visibleMessages.length === 0 && !typing && (
          <div
            style={{
              fontSize: 12,
              fontFamily: fonts.body,
              color: colors.text.dimmed,
              textAlign: 'center',
              padding: '12px 0',
            }}
          >
            Ask a question about the agent's progress
          </div>
        )}

        {visibleMessages.map((msg) => (
          <div
            key={msg.id}
            style={{
              fontSize: 13,
              fontFamily: fonts.body,
              lineHeight: 1.45,
              color: msg.role === 'user' ? colors.text.primary : colors.text.secondary,
              padding: '4px 8px',
              borderRadius: 6,
              background:
                msg.role === 'user'
                  ? alpha(colors.text.primary, 0.06)
                  : alpha(PURPLE, 0.08),
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              wordBreak: 'break-word',
            }}
          >
            {msg.text}
          </div>
        ))}

        {typing && (
          <div
            style={{
              fontSize: 12,
              fontFamily: fonts.mono,
              color: alpha(PURPLE, 0.7),
              padding: '4px 8px',
            }}
          >
            thinking...
          </div>
        )}
      </div>

      {/* Input */}
      <div
        style={{
          padding: '8px 10px',
          borderTop: `1px solid ${alpha(PURPLE, 0.12)}`,
          display: 'flex',
          gap: 8,
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask advisor..."
          style={{
            flex: 1,
            background: alpha(colors.text.primary, 0.04),
            border: `1px solid ${alpha(PURPLE, 0.2)}`,
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 13,
            fontFamily: fonts.body,
            color: colors.text.primary,
            outline: 'none',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          style={{
            background: input.trim() ? PURPLE : alpha(PURPLE, 0.3),
            border: 'none',
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: 12,
            fontFamily: fonts.display,
            fontWeight: 600,
            color: input.trim() ? '#fff' : alpha('#fff', 0.5),
            cursor: input.trim() ? 'pointer' : 'default',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
};
