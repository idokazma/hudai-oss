import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PipelineBlock, PipelineBlockType, PlanBlockStatus } from '@hudai/shared';
import type { LayoutDirection } from './pipeline-layout.js';
import { colors, alpha, fonts } from '../../theme/tokens.js';
import { DescriptionBullets } from './DescriptionBullets.js';

const BLOCK_COLORS: Record<PipelineBlockType, string> = {
  source: colors.block.source,
  transform: colors.block.transform,
  sink: colors.block.sink,
  branch: colors.block.branch,
  merge: colors.block.merge,
  'plan-step': colors.block.planStep,
};

const BLOCK_ICONS: Record<PipelineBlockType, string> = {
  source: '◉',
  transform: '⟁',
  sink: '◎',
  branch: '⑂',
  merge: '⊕',
  'plan-step': '▸',
};

const PLAN_STATUS_STYLES: Record<PlanBlockStatus, { color?: string; opacity: number; borderStyle: string; icon?: string; labelColor?: string }> = {
  planned: { opacity: 1, borderStyle: 'solid' },
  'in-progress': { color: colors.accent.primary, opacity: 1, borderStyle: 'solid', icon: '⟳' },
  completed: { color: colors.status.successLight, opacity: 1, borderStyle: 'solid', icon: '✓' },
};

export interface PipelineBlockNodeData {
  block: PipelineBlock;
  direction?: LayoutDirection;
  heat?: number;
  isSpotlight?: boolean;
  indicator?: string;
  isFailing?: boolean;
  [key: string]: unknown;
}

function PipelineBlockNodeInner({ data }: NodeProps) {
  const { block, direction = 'LR', heat = 0, isSpotlight = false, indicator, isFailing = false } = data as PipelineBlockNodeData;
  const [hovered, setHovered] = useState(false);

  const planStyle = block.planStatus ? PLAN_STATUS_STYLES[block.planStatus] : null;
  const color = planStyle?.color ?? BLOCK_COLORS[block.blockType];
  const icon = planStyle?.icon ?? BLOCK_ICONS[block.blockType];
  const nodeOpacity = planStyle?.opacity ?? 1;
  const borderStyle = planStyle?.borderStyle ?? 'solid';
  const labelColor = planStyle?.labelColor ?? colors.text.primary;
  const isPlanInProgress = block.planStatus === 'in-progress';

  const glowIntensity = Math.max(heat, isFailing ? 0.8 : 0, isSpotlight || isPlanInProgress ? 0.6 : 0, hovered ? 0.4 : 0);
  const glowColor = isFailing ? colors.block.sink : isSpotlight ? colors.block.branch : color;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: direction === 'TB' ? 380 : 280,
        minHeight: 100,
        opacity: nodeOpacity,
        background: hovered ? colors.bg.panelSolid : colors.bg.panel,
        border: `1px ${borderStyle} ${color}${glowIntensity > 0 ? 'cc' : '44'}`,
        borderRadius: 8,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        position: 'relative',
        cursor: 'pointer',
        transform: hovered ? 'scale(1.02)' : 'scale(1)',
        boxShadow: glowIntensity > 0
          ? `0 0 ${12 + glowIntensity * 20}px ${glowColor}${Math.round(glowIntensity * 60).toString(16).padStart(2, '0')}`
          : 'none',
        transition: 'box-shadow 0.3s ease, border-color 0.3s ease, transform 0.2s ease, background 0.2s ease, opacity 0.3s ease',
      }}
    >
      {/* Construction stripe border for planned blocks — only on the edge, not behind content */}
      {block.planStatus === 'planned' && (
        <>
          {/* Stripe frame */}
          <div
            style={{
              position: 'absolute',
              inset: -3,
              borderRadius: 10,
              background: `repeating-linear-gradient(135deg, ${colors.block.branch} 0px, ${colors.block.branch} 3px, ${colors.bg.primary} 3px, ${colors.bg.primary} 6px)`,
              opacity: 0.35,
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
          {/* Inner mask to cut out the stripe from the content area */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 8,
              background: colors.bg.panel,
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
        </>
      )}

      {/* Spotlight / in-progress pulse ring */}
      {(isSpotlight || isPlanInProgress) && (
        <div
          style={{
            position: 'absolute',
            inset: -4,
            borderRadius: 12,
            border: `2px solid ${color}66`,
            animation: 'pipeline-pulse 2s ease-in-out infinite',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Indicator badge */}
      {indicator && (
        <div
          style={{
            position: 'absolute',
            top: -8,
            right: -8,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: isFailing ? colors.block.sink : color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 700,
            color: colors.text.white,
            boxShadow: `0 0 8px ${isFailing ? colors.block.sink : color}88`,
            zIndex: 2,
          }}
        >
          {indicator}
        </div>
      )}

      {/* Content wrapper — z-index above construction stripe mask */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Header: icon + label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16, color, lineHeight: 1 }}>{icon}</span>
          <span
            style={{
              fontSize: 12,
              fontFamily: fonts.mono,
              fontWeight: 600,
              color: labelColor,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
          >
            {block.label}
          </span>
        </div>

        {/* Technology badge */}
        {block.technology && (
          <span
            style={{
              fontSize: 11,
              fontFamily: fonts.mono,
              color: colors.text.label,
              background: colors.surface.raised,
              padding: '2px 6px',
              borderRadius: 3,
              alignSelf: 'flex-start',
            }}
          >
            {block.technology}
          </span>
        )}

        {/* Description — bullet list */}
        {block.description && (
          <DescriptionBullets
            description={block.description}
            planStatus={block.planStatus}
            maxItems={3}
          />
        )}
      </div>

      {/* Block type label */}
      <span
        style={{
          position: 'absolute',
          bottom: 6,
          right: 10,
          fontSize: 10,
          fontFamily: fonts.mono,
          color: `${color}88`,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          zIndex: 1,
        }}
      >
        {block.blockType}
      </span>

      <Handle type="target" position={direction === 'TB' ? Position.Top : Position.Left} style={{ background: color, width: 8, height: 8, border: 'none' }} />
      <Handle type="source" position={direction === 'TB' ? Position.Bottom : Position.Right} style={{ background: color, width: 8, height: 8, border: 'none' }} />
    </div>
  );
}

export const PipelineBlockNode = memo(PipelineBlockNodeInner);
