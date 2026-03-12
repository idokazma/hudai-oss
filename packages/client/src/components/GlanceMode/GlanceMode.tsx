import React from 'react';
import { StatusHero } from './StatusHero.js';
import { TaskRing } from './TaskRing.js';
import { MetricPills } from './MetricPills.js';
import { ServiceDots } from './ServiceDots.js';
import { AdvisorChat } from './AdvisorChat.js';
import { colors } from '../../theme/tokens.js';

export const GlanceMode: React.FC = () => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        width: '100%',
        background: colors.bg.primary,
        padding: '40px 20px',
        boxSizing: 'border-box',
      }}
    >
      <StatusHero />
      <TaskRing />
      <MetricPills />
      <ServiceDots />
      <AdvisorChat />
    </div>
  );
};
