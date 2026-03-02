import { useState, type KeyboardEvent } from 'react';
import { wsClient } from '../../ws/ws-client.js';
import { useReplayStore } from '../../stores/replay-store.js';
import { colors, fonts } from '../../theme/tokens.js';

export function CommandBar() {
  const [input, setInput] = useState('');
  const isReplay = useReplayStore((s) => s.mode) === 'replay';

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || isReplay) return;
    wsClient.send({
      kind: 'command',
      command: { type: 'prompt', data: { text } },
    });
    setInput('');
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div style={{
      flexShrink: 0,
      borderTop: `1px solid ${colors.border.subtle}`,
      background: colors.surface.dimmer,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '4px 10px',
        borderBottom: `1px solid ${colors.border.subtle}`,
      }}>
        <span style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 1,
          color: colors.text.muted,
        }}>
          Command
        </span>
      </div>

      {/* Input */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '6px 8px',
      }}>
        <span style={{
          color: isReplay ? colors.text.muted : colors.accent.blue,
          fontFamily: fonts.mono,
          fontSize: 13,
          marginRight: 6,
          userSelect: 'none',
        }}>❯</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isReplay ? 'Replay mode' : 'Type here...'}
          disabled={isReplay}
          style={{
            flex: 1,
            height: 28,
            background: 'transparent',
            border: 'none',
            color: colors.text.primary,
            fontSize: 13,
            fontFamily: fonts.mono,
            outline: 'none',
            opacity: isReplay ? 0.4 : 1,
          }}
        />
      </div>
    </div>
  );
}
