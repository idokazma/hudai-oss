import { useState } from 'react';
import { CurrentActionWidget } from './CurrentActionWidget.js';
import { CommanderChat } from './CommanderChat.js';
import { colors, alpha, fonts } from '../../theme/tokens.js';

type RightTab = 'activity' | 'chat';

export function RightPanel() {
  const [activeTab, setActiveTab] = useState<RightTab>('chat');

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      borderLeft: `1px solid ${colors.border.subtle}`,
      background: colors.surface.dim,
    }}>
      {/* Activity / Chat toggle */}
      <div style={{
        display: 'flex',
        borderBottom: `1px solid ${colors.border.subtle}`,
        flexShrink: 0,
      }}>
        {(['chat', 'activity'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '5px 0',
              fontSize: 11,
              fontFamily: fonts.mono,
              background: activeTab === tab ? alpha(colors.accent.primary, 0.15) : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? `2px solid ${colors.accent.blue}` : '2px solid transparent',
              color: activeTab === tab ? colors.text.primary : colors.text.muted,
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            {tab === 'activity' ? 'Activity' : 'Chat'}
          </button>
        ))}
      </div>

      {/* Activity Feed or Chat — takes full remaining height */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {activeTab === 'activity' ? <CurrentActionWidget /> : <CommanderChat />}
      </div>
    </div>
  );
}
