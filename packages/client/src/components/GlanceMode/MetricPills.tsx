import React, { useEffect, useState } from 'react';
import { useEventStore } from '../../stores/event-store.js';
import { useSessionStore } from '../../stores/session-store.js';
import { useDensityStore } from '../../stores/density-store.js';
import { colors, fonts, alpha } from '../../theme/tokens.js';
import { formatUptime } from '../../utils/format-time.js';

function countFilesChanged(events: { type: string }[]): number {
  const files = new Set<string>();
  for (const e of events) {
    const data = (e as any).data;
    if ((e.type === 'file.edit' || e.type === 'file.create') && data?.path) {
      files.add(data.path);
    }
  }
  return files.size;
}

function countTests(events: { type: string }[]): number {
  let total = 0;
  for (const e of events) {
    if (e.type === 'test.result') {
      total += (e as any).data?.total ?? 0;
    }
  }
  return total;
}

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 14px',
  borderRadius: 20,
  background: alpha(colors.text.primary, 0.06),
  border: `1px solid ${colors.border.subtle}`,
  fontSize: 13,
  fontFamily: fonts.body,
  color: colors.text.secondary,
  whiteSpace: 'nowrap',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: colors.text.muted,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

export const MetricPills: React.FC = () => {
  const events = useEventStore((s) => s.events);
  const startedAt = useSessionStore((s) => s.session.startedAt);
  const eventCount = useSessionStore((s) => s.session.eventCount);
  const setMode = useDensityStore((s) => s.setMode);

  const [uptime, setUptime] = useState(() => formatUptime(startedAt));

  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setUptime(formatUptime(startedAt)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const filesChanged = countFilesChanged(events);
  const testCount = countTests(events);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 10,
        flexWrap: 'wrap',
        marginBottom: 20,
      }}
    >
      <div
        style={{ ...pillStyle, cursor: 'pointer' }}
        onClick={() => setMode('work')}
        title="Switch to Deep mode"
      >
        <span style={labelStyle}>events</span>
        <span style={{ fontFamily: fonts.mono, fontWeight: 600 }}>
          {eventCount || events.length}
        </span>
      </div>

      <div style={pillStyle}>
        <span style={labelStyle}>uptime</span>
        <span style={{ fontFamily: fonts.mono, fontWeight: 600 }}>{uptime}</span>
      </div>

      <div style={pillStyle}>
        <span style={labelStyle}>files</span>
        <span style={{ fontFamily: fonts.mono, fontWeight: 600 }}>{filesChanged}</span>
      </div>

      {testCount > 0 && (
        <div style={pillStyle}>
          <span style={labelStyle}>tests</span>
          <span style={{ fontFamily: fonts.mono, fontWeight: 600 }}>{testCount}</span>
        </div>
      )}
    </div>
  );
};
