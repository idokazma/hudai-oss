import { useNotificationStore } from '../../stores/notification-store.js';
import { colors, fonts } from '../../theme/tokens.js';

export type MobileTab = 'pulse' | 'view' | 'terminal' | 'controls';

interface TabDef {
  id: MobileTab;
  label: string;
  icon: string;
}

const TABS: TabDef[] = [
  { id: 'pulse', label: 'Pulse', icon: '◉' },
  { id: 'view', label: 'View', icon: '◈' },
  { id: 'terminal', label: 'Terminal', icon: '▸_' },
  { id: 'controls', label: 'Controls', icon: '⚙' },
];

interface Props {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
}

export function BottomNav({ active, onChange }: Props) {
  const lastActivity = useNotificationStore((s) => s.lastActivity);
  const needsAttention = lastActivity === 'waiting_permission' || lastActivity === 'waiting_answer';

  return (
    <nav
      style={{
        display: 'flex',
        borderTop: `1px solid ${colors.border.subtle}`,
        background: colors.bg.secondary,
        flexShrink: 0,
      }}
    >
      {TABS.map((tab) => {
        const isActive = active === tab.id;
        const showBadge = tab.id === 'pulse' && needsAttention && !isActive;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              padding: '8px 0 6px',
              border: 'none',
              background: 'transparent',
              color: isActive ? colors.accent.primary : colors.text.muted,
              cursor: 'pointer',
              position: 'relative',
              transition: 'color 0.15s',
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1, fontFamily: fonts.mono }}>
              {tab.icon}
            </span>
            <span
              style={{
                fontSize: 10,
                fontFamily: fonts.body,
                fontWeight: isActive ? 700 : 500,
                letterSpacing: '0.03em',
              }}
            >
              {tab.label}
            </span>
            {isActive && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '20%',
                  right: '20%',
                  height: 2,
                  background: colors.accent.primary,
                  borderRadius: '0 0 2px 2px',
                }}
              />
            )}
            {showBadge && (
              <div
                style={{
                  position: 'absolute',
                  top: 6,
                  right: '30%',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: colors.status.errorLight,
                  border: `2px solid ${colors.bg.secondary}`,
                }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
