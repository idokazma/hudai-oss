import React from 'react';
import { colors } from '../../theme/tokens.js';
import { PanePreview } from '../PanePreview.js';

export interface BottomTerminalProps {
  size: number;
  collapsed: boolean;
  startResize: (e: React.MouseEvent) => void;
  toggleCollapse: () => void;
}

export const BottomTerminal: React.FC<BottomTerminalProps> = ({ collapsed }) => {
  if (collapsed) return null;

  return (
    <div
      style={{
        height: '100%',
        overflow: 'hidden',
        background: colors.terminal.bg,
      }}
    >
      <PanePreview />
    </div>
  );
};
