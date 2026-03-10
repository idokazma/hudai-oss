import { PanePreview } from '../../PanePreview.js';
import { colors } from '../../../theme/tokens.js';

export function TerminalTab() {
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
}
