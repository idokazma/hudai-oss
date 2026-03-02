import { colors, fonts, alpha } from '../../theme/tokens.js';

interface ThinkingDetailProps {
  summary: string;
  fullLength?: number;
}

function formatCharCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function ThinkingDetail({ summary, fullLength }: ThinkingDetailProps) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        marginBottom: 8,
        background: colors.bg.card,
        border: `1px solid ${colors.border.subtle}`,
        borderRadius: 6,
        padding: '10px 12px',
        width: 280,
        zIndex: 100,
        boxShadow: colors.surface.shadow,
        pointerEvents: 'none',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
      }}>
        <span style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 1,
          color: colors.action.think,
          fontWeight: 600,
        }}>
          Thinking
        </span>
        {fullLength != null && (
          <span style={{
            fontSize: 11,
            fontFamily: fonts.mono,
            color: colors.text.muted,
          }}>
            {formatCharCount(fullLength)} chars of reasoning
          </span>
        )}
      </div>

      {/* Summary text */}
      <div style={{
        fontSize: 13,
        fontFamily: fonts.mono,
        color: colors.text.secondary,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: 120,
        overflowY: 'auto',
      }}>
        {summary || 'No summary available'}
      </div>

      {/* Arrow */}
      <div style={{
        position: 'absolute',
        bottom: -5,
        left: '50%',
        transform: 'translateX(-50%) rotate(45deg)',
        width: 8,
        height: 8,
        background: colors.bg.card,
        borderRight: `1px solid ${colors.border.subtle}`,
        borderBottom: `1px solid ${colors.border.subtle}`,
      }} />
    </div>
  );
}
