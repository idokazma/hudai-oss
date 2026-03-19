import { useState, type KeyboardEvent } from 'react';
import { wsClient } from '../../../ws/ws-client.js';
import { colors, fonts } from '../../../theme/tokens.js';
import { ThreadCards } from './ThreadCards.js';

/**
 * HumanShell — Thread-based conversation view with structured task cards.
 */
export function HumanShell() {
  const [input, setInput] = useState('');

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
      {/* Thread cards */}
      <ThreadCards />

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
