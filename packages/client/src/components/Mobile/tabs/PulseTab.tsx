import { useState, type KeyboardEvent } from 'react';
import { StatusRing } from '../pulse/StatusRing.js';
import { ActionCardStack } from '../pulse/ActionCardStack.js';
import { PlanProgress } from '../pulse/PlanProgress.js';
import { AdvisorMessages } from '../pulse/AdvisorMessages.js';
import { useChatStore } from '../../../stores/chat-store.js';
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

      {/* Bottom bar: Catch me up + input */}
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
        <button
          onClick={() => {
            useChatStore.getState().addMessage({
              id: `user-catchup-${Date.now()}`,
              sessionId: '',
              timestamp: Date.now(),
              role: 'user',
              text: 'Catch me up',
            });
            wsClient.send({ kind: 'insight.requestSummary' });
          }}
          style={{
            height: 40,
            padding: '0 14px',
            borderRadius: 20,
            border: `1px solid ${alpha(colors.action.think, 0.3)}`,
            background: alpha(colors.action.think, 0.08),
            color: colors.action.think,
            fontSize: 13,
            fontFamily: fonts.body,
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          Catch me up
        </button>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything..."
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
            minWidth: 0,
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
