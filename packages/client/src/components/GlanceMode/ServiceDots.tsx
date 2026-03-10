import React from 'react';
import { colors, fonts, alpha } from '../../theme/tokens.js';

interface ServiceIndicator {
  label: string;
  color: string;
}

const SERVICES: ServiceIndicator[] = [
  { label: 'LLM', color: colors.status.successLight },
  { label: 'Telegram', color: colors.status.successLight },
  { label: 'Library', color: colors.text.muted },
  { label: 'SQLite', color: colors.status.successLight },
];

export const ServiceDots: React.FC = () => {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 20,
        marginBottom: 28,
      }}
    >
      {SERVICES.map((svc) => (
        <div
          key={svc.label}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: svc.color,
              boxShadow: `0 0 6px ${alpha(svc.color, 0.5)}`,
            }}
          />
          <span
            style={{
              fontSize: 11,
              fontFamily: fonts.body,
              color: colors.text.dimmed,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {svc.label}
          </span>
        </div>
      ))}
    </div>
  );
};
