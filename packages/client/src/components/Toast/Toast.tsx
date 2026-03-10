import { useEffect, useState } from 'react';
import type { Toast as ToastType } from '../../stores/toast-store.js';
import { useToastStore } from '../../stores/toast-store.js';
import { colors, alpha, fonts } from '../../theme/tokens.js';

const BORDER_COLORS: Record<ToastType['type'], string> = {
  success: colors.status.successLight,
  warning: colors.status.warning,
  error: colors.status.errorLight,
  info: colors.accent.primary,
};

const ICONS: Record<ToastType['type'], string> = {
  success: '✓',
  warning: '⚠',
  error: '✕',
  info: 'ℹ',
};

export function Toast({ id, type, message, duration = 3000 }: ToastType) {
  const remove = useToastStore((s) => s.remove);
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => remove(id), 200);
    }, duration);
    return () => clearTimeout(timer);
  }, [id, duration, remove]);

  const handleDismiss = () => {
    setExiting(true);
    setTimeout(() => remove(id), 200);
  };

  const borderColor = BORDER_COLORS[type];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: alpha('#0c1220', 0.92),
        backdropFilter: 'blur(8px)',
        borderLeft: `4px solid ${borderColor}`,
        borderRadius: 4,
        fontFamily: fonts.body,
        fontSize: 12,
        color: colors.text.primary,
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        transform: visible && !exiting ? 'translateY(0)' : 'translateY(-12px)',
        opacity: visible && !exiting ? 1 : 0,
        transition: 'transform 200ms ease, opacity 200ms ease',
        pointerEvents: 'auto' as const,
        minWidth: 240,
        maxWidth: 400,
      }}
    >
      <span style={{ color: borderColor, fontSize: 14, flexShrink: 0 }}>
        {ICONS[type]}
      </span>
      <span style={{ flex: 1 }}>{message}</span>
      <button
        onClick={handleDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: colors.text.muted,
          cursor: 'pointer',
          padding: '0 2px',
          fontSize: 14,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}
