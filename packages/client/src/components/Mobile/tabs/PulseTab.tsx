import { useState, type KeyboardEvent } from 'react';
import { StatusRing } from '../pulse/StatusRing.js';
import { ActionCardStack } from '../pulse/ActionCardStack.js';
import { PlanProgress } from '../pulse/PlanProgress.js';
import { AdvisorMessages } from '../pulse/AdvisorMessages.js';
import { wsClient } from '../../../ws/ws-client.js';
import { colors, fonts, alpha } from '../../../theme/tokens.js';

export function PulseTab() {
  const [input, setInput] = useState('');

  const send = () => {
    const text = input.trim();
    if (!text) return;
    wsClient.send({ kind: 'chat.send', text });
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
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Scrollable content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          paddingTop: 20,
          paddingBottom: 20,
        }}
      >
        <StatusRing />
        <ActionCardStack />
        <AdvisorMessages />
        <PlanProgress />
      </div>

      {/* Ask anything input */}
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
          placeholder="Ask anything about this session..."
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
