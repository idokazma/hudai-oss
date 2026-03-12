import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSessionStore } from '../../stores/session-store.js';
import { usePanesStore } from '../../stores/panes-store.js';
import { wsClient } from '../../ws/ws-client.js';
import { SpawnModal } from '../shared/SpawnModal.js';
import { colors, fonts, alpha } from '../../theme/tokens.js';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  idle: { label: 'IDLE', color: colors.status.successLight },
  running: { label: 'WORKING', color: colors.accent.blue },
  paused: { label: 'PAUSED', color: colors.status.warning },
  complete: { label: 'COMPLETE', color: colors.status.successLight },
  error: { label: 'ERROR', color: colors.status.errorLight },
};

export const StatusHero: React.FC = () => {
  const session = useSessionStore((s) => s.session);
  const panes = usePanesStore((s) => s.panes);
  const mapped = STATUS_MAP[session.status] ?? STATUS_MAP.idle;
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  const openDropdown = useCallback(() => {
    wsClient.send({ kind: 'panes.list' });
    setDropdownOpen((v) => !v);
  }, []);

  return (
    <div style={{ textAlign: 'center', marginBottom: 32 }}>
      <div
        style={{
          fontSize: 56,
          fontFamily: fonts.display,
          fontWeight: 700,
          letterSpacing: '0.12em',
          color: mapped.color,
          textShadow: `0 0 24px ${alpha(mapped.color, 0.4)}`,
          lineHeight: 1,
          marginBottom: 12,
        }}
      >
        {mapped.label}
      </div>

      {/* Session switcher */}
      <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block', marginBottom: 8 }}>
        <button
          onClick={openDropdown}
          style={{
            background: 'none',
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: 4,
            padding: '3px 12px',
            cursor: 'pointer',
            outline: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <div style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: session.tmuxTarget ? colors.accent.blue : colors.text.muted,
          }} />
          <span style={{
            fontSize: 12,
            fontFamily: fonts.mono,
            color: session.tmuxTarget ? colors.text.secondary : colors.text.muted,
            letterSpacing: 0.5,
          }}>
            {session.tmuxTarget || 'No session'}
          </span>
          <span style={{ fontSize: 9, color: colors.text.muted }}>▾</span>
        </button>

        {dropdownOpen && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: 4,
            minWidth: 220,
            background: colors.bg.panel,
            border: `1px solid ${colors.border.medium}`,
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 200,
            padding: '4px 0',
            textAlign: 'left',
          }}>
            {panes.map((pane) => {
              const isCurrent = pane.id === session.tmuxTarget;
              return (
                <button
                  key={pane.id}
                  onClick={() => {
                    if (!isCurrent) {
                      wsClient.send({ kind: 'session.attach', tmuxTarget: pane.id });
                    }
                    setDropdownOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '6px 12px',
                    border: 'none',
                    background: isCurrent ? alpha(colors.accent.blue, 0.12) : 'transparent',
                    color: isCurrent ? colors.accent.blueLight : colors.text.secondary,
                    fontSize: 12,
                    fontFamily: fonts.mono,
                    cursor: isCurrent ? 'default' : 'pointer',
                    textAlign: 'left',
                    outline: 'none',
                  }}
                  onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                  onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: isCurrent ? colors.accent.blue : colors.text.muted,
                  }} />
                  <span style={{ flex: 1 }}>{pane.id}</span>
                </button>
              );
            })}
            {panes.length === 0 && (
              <div style={{ padding: '8px 12px', fontSize: 12, color: colors.text.muted, fontFamily: fonts.mono }}>
                No tmux panes found
              </div>
            )}
            <div style={{ height: 1, background: colors.border.subtle, margin: '4px 0' }} />
            <button
              onClick={() => {
                setDropdownOpen(false);
                setSpawnOpen(true);
              }}
              style={{
                width: '100%',
                padding: '6px 12px',
                border: 'none',
                background: 'transparent',
                color: colors.accent.blueLight,
                fontSize: 12,
                fontFamily: fonts.mono,
                cursor: 'pointer',
                textAlign: 'left',
                outline: 'none',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              + New Agent
            </button>
            <button
              onClick={() => {
                wsClient.send({ kind: 'session.detach' });
                setDropdownOpen(false);
              }}
              style={{
                width: '100%',
                padding: '6px 12px',
                border: 'none',
                background: 'transparent',
                color: colors.status.warning,
                fontSize: 12,
                fontFamily: fonts.mono,
                cursor: 'pointer',
                textAlign: 'left',
                outline: 'none',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Detach
            </button>
          </div>
        )}
      </div>
      <SpawnModal open={spawnOpen} onClose={() => setSpawnOpen(false)} />

      {session.taskLabel && session.taskLabel !== 'No active task' && (
        <div
          style={{
            fontSize: 15,
            fontFamily: fonts.body,
            color: colors.text.secondary,
            maxWidth: 480,
            margin: '0 auto',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {session.taskLabel}
        </div>
      )}

      {session.agentCurrentFile && (
        <div
          style={{
            fontSize: 12,
            fontFamily: fonts.mono,
            color: colors.text.muted,
            marginTop: 6,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 400,
            margin: '6px auto 0',
          }}
        >
          {session.agentCurrentFile}
        </div>
      )}
    </div>
  );
};
