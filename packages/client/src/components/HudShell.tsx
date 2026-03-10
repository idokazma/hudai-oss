import { useDensityStore } from '../stores/density-store.js';
import { useDensityKeys } from '../hooks/useDensityKeys.js';
import { colors } from '../theme/tokens.js';
import { GlanceMode } from './GlanceMode/GlanceMode.js';
import { WorkMode } from './WorkMode/WorkMode.js';

export function HudShell() {
  useDensityKeys();
  const mode = useDensityStore((s) => s.mode);

  return mode === 'glance' ? <GlanceMode /> : <WorkMode />;
}
