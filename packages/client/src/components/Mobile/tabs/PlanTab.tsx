import { ProgressHero } from '../plan/ProgressHero.js';
import { StepList } from '../plan/StepList.js';

export function PlanTab() {
  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <ProgressHero />
      <StepList />
    </div>
  );
}
