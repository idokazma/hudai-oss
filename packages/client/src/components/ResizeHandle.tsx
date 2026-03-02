import { useState } from 'react';
import { colors } from '../theme/tokens.js';

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical';
  onMouseDown: (e: React.MouseEvent) => void;
  onCollapse?: () => void;
  collapsed?: boolean;
  collapseDirection?: 'left' | 'right' | 'down';
  style?: React.CSSProperties;
}

export function ResizeHandle({
  direction,
  onMouseDown,
  onCollapse,
  collapsed = false,
  collapseDirection,
  style,
}: ResizeHandleProps) {
  const [hovered, setHovered] = useState(false);

  const isHorizontal = direction === 'horizontal';

  const arrowLabel = collapseDirection === 'left'
    ? (collapsed ? '‹' : '›')
    : collapseDirection === 'right'
    ? (collapsed ? '›' : '‹')
    : (collapsed ? '▴' : '▾');

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        cursor: isHorizontal ? 'col-resize' : 'row-resize',
        background: hovered ? colors.border.medium : 'transparent',
        transition: 'background 0.15s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
        position: 'relative',
        ...(isHorizontal
          ? { width: 4, minHeight: 0 }
          : { height: 4, minWidth: 0 }),
        ...style,
      }}
    >
      {onCollapse && hovered && (
        <button
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onCollapse();
          }}
          style={{
            position: 'absolute',
            ...(isHorizontal
              ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
              : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }),
            width: isHorizontal ? 14 : 28,
            height: isHorizontal ? 28 : 14,
            borderRadius: 4,
            border: `1px solid ${colors.border.medium}`,
            background: colors.bg.panel,
            color: colors.text.muted,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            lineHeight: 1,
            padding: 0,
            zIndex: 20,
          }}
        >
          {arrowLabel}
        </button>
      )}
    </div>
  );
}
