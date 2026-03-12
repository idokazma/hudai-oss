import { useState, useEffect } from 'react';
import { colors, fonts, alpha } from '../../theme/tokens.js';
import { wsClient } from '../../ws/ws-client.js';
import type { ServerMessage } from '@hudai/shared';

const SERVICE_META = [
  { key: 'llm' as const, label: 'LLM', icon: '🧠' },
  { key: 'telegram' as const, label: 'Telegram', icon: '✈' },
  { key: 'library' as const, label: 'Library', icon: '📚' },
];

export function ServiceDots() {
  const [services, setServices] = useState({ llm: false, telegram: false, library: false });

  useEffect(() => {
    const unsub = wsClient.onMessage((msg: ServerMessage) => {
      if (msg.kind === 'service.status') setServices(msg.services);
    });
    return () => { unsub(); };
  }, []);

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      gap: 20,
      marginBottom: 28,
    }}>
      {SERVICE_META.map((svc) => {
        const on = services[svc.key];
        return (
          <div
            key={svc.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 13 }}>{svc.icon}</span>
            <div style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: on ? colors.status.successLight : colors.text.dimmed,
              boxShadow: on ? `0 0 6px ${alpha(colors.status.successLight, 0.5)}` : 'none',
              transition: 'all 0.3s',
            }} />
            <span style={{
              fontSize: 11,
              fontFamily: fonts.body,
              color: on ? colors.text.secondary : colors.text.dimmed,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              {svc.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
