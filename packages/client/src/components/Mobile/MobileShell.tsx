import { useState } from 'react';
import { useSessionStore } from '../../stores/session-store.js';
import { MobileHeader } from './MobileHeader.js';
import { BottomNav, type MobileTab } from './BottomNav.js';
import { PromptOverlay } from './PromptOverlay.js';
import { SessionPicker } from './SessionPicker.js';
import { PulseTab } from './tabs/PulseTab.js';
import { ViewTab } from './tabs/ViewTab.js';
import { TerminalTab } from './tabs/TerminalTab.js';
import { ControlsTab } from './tabs/ControlsTab.js';
import { colors } from '../../theme/tokens.js';
import { useSwipeHandlers } from '../../hooks/useSwipeGesture.js';

const TABS: MobileTab[] = ['pulse', 'view', 'terminal', 'controls'];

export function MobileShell() {
  const tmuxTarget = useSessionStore((s) => s.session.tmuxTarget);
  const [activeTab, setActiveTab] = useState<MobileTab>('pulse');
  const [promptOpen, setPromptOpen] = useState(false);

  const swipe = useSwipeHandlers({
    onSwipeLeft: () => {
      const idx = TABS.indexOf(activeTab);
      if (idx < TABS.length - 1) setActiveTab(TABS[idx + 1]);
    },
    onSwipeRight: () => {
      const idx = TABS.indexOf(activeTab);
      if (idx > 0) setActiveTab(TABS[idx - 1]);
    },
  });

  const hasSession = !!tmuxTarget;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        width: '100vw',
        background: colors.bg.primary,
        overflow: 'hidden',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {hasSession ? (
        <>
          <MobileHeader onPromptOpen={() => setPromptOpen(true)} />

          <div
            style={{ flex: 1, overflow: 'hidden', position: 'relative' }}
            {...(activeTab !== 'terminal' ? swipe : {})}
          >
            {activeTab === 'pulse' && <PulseTab />}
            {activeTab === 'view' && <ViewTab />}
            {activeTab === 'terminal' && <TerminalTab />}
            {activeTab === 'controls' && <ControlsTab />}
          </div>

          <BottomNav active={activeTab} onChange={setActiveTab} />

          {promptOpen && <PromptOverlay onClose={() => setPromptOpen(false)} />}
        </>
      ) : (
        <SessionPicker />
      )}
    </div>
  );
}
