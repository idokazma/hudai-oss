import { useState, type KeyboardEvent } from 'react';
import { wsClient } from '../../ws/ws-client.js';
import { colors, fonts } from '../../theme/tokens.js';

export function PromptBar() {
  const [input, setInput] = useState('');

  const handleSubmit = () => {
    const text = input.trim();
    if (!text) return;

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
    <input
      value={input}
      onChange={(e) => setInput(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="Send instruction to agent..."
      style={{
        flex: 1,
        height: 36,
        background: colors.bg.secondary,
        border: `1px solid ${colors.border.subtle}`,
        borderRadius: 6,
        padding: '0 12px',
        color: colors.text.primary,
        fontSize: 13,
        fontFamily: fonts.mono,
        outline: 'none',
      }}
    />
  );
}
