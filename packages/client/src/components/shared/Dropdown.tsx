import { useState, useRef, useEffect } from 'react';
import { colors, fonts } from '../../theme/tokens.js';

interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  style?: React.CSSProperties;
}

export function Dropdown<T extends string>({ value, options, onChange, style }: Props<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          padding: '2px 8px',
          fontSize: 11,
          fontFamily: fonts.mono,
          background: colors.bg.secondary,
          border: `1px solid ${colors.border.subtle}`,
          borderRadius: 3,
          color: colors.text.secondary,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          whiteSpace: 'nowrap',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {current?.label ?? value}
        <span style={{ fontSize: 8, color: colors.text.muted }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: 2,
          background: colors.bg.primary,
          border: `1px solid ${colors.border.medium}`,
          borderRadius: 4,
          boxShadow: colors.surface.shadowSm,
          zIndex: 100,
          overflow: 'hidden',
          minWidth: '100%',
        }}>
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                display: 'block',
                width: '100%',
                padding: '5px 10px',
                fontSize: 11,
                fontFamily: fonts.mono,
                background: opt.value === value ? `${colors.accent.blue}20` : 'transparent',
                border: 'none',
                color: opt.value === value ? colors.text.primary : colors.text.secondary,
                cursor: 'pointer',
                textAlign: 'left',
                whiteSpace: 'nowrap',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
              onMouseEnter={(e) => {
                if (opt.value !== value) e.currentTarget.style.background = colors.surface.hover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = opt.value === value ? `${colors.accent.blue}20` : 'transparent';
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
