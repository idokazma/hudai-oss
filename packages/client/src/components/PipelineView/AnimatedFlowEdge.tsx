import { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { colors, fonts } from '../../theme/tokens.js';

export interface AnimatedFlowEdgeData {
  label?: string;
  edgeType?: string;
  heat?: number;
  planSourceStatus?: string;
  planTargetStatus?: string;
  [key: string]: unknown;
}

function AnimatedFlowEdgeInner(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const { label, heat = 0, planSourceStatus, planTargetStatus } = (data ?? {}) as AnimatedFlowEdgeData;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  // Plan-aware edge styling
  const isPlanEdge = !!planSourceStatus;
  let strokeColor: string;
  let strokeWidth: number;
  let dashSpeed: number;
  let edgeOpacity: number;
  let dashArray: string;

  if (isPlanEdge) {
    const bothCompleted = planSourceStatus === 'completed' && planTargetStatus === 'completed';
    const toInProgress = planSourceStatus === 'completed' && planTargetStatus === 'in-progress';
    const bothPlanned = planSourceStatus === 'planned' || planTargetStatus === 'planned';

    if (bothCompleted) {
      strokeColor = colors.status.successLight;
      strokeWidth = 2.5;
      dashSpeed = 1.5;
      edgeOpacity = 0.9;
      dashArray = '6 4';
    } else if (toInProgress) {
      strokeColor = colors.accent.primary;
      strokeWidth = 2.5;
      dashSpeed = 1;
      edgeOpacity = 0.9;
      dashArray = '6 4';
    } else if (bothPlanned) {
      strokeColor = colors.text.dimmed;
      strokeWidth = 1.5;
      dashSpeed = 4;
      edgeOpacity = 0.35;
      dashArray = '4 6';
    } else {
      strokeColor = colors.text.dimmed;
      strokeWidth = 1.5;
      dashSpeed = 3;
      edgeOpacity = 0.5;
      dashArray = '6 4';
    }
  } else {
    strokeColor = heat > 0.5 ? colors.block.transform : heat > 0 ? colors.accent.primary : colors.text.dimmed;
    strokeWidth = 1.5 + heat * 1.5;
    dashSpeed = heat > 0 ? Math.max(0.5, 2 - heat * 1.5) : 3;
    edgeOpacity = 0.6 + heat * 0.4;
    dashArray = '6 4';
  }

  return (
    <>
      {/* Background path for hit area */}
      <BaseEdge
        path={edgePath}
        style={{
          stroke: 'transparent',
          strokeWidth: 16,
        }}
      />
      {/* Visible animated edge */}
      <path
        d={edgePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={dashArray}
        opacity={edgeOpacity}
        style={{
          animation: `pipeline-dash ${dashSpeed}s linear infinite`,
        }}
      />
      {/* Hot particle dots overlay */}
      {!isPlanEdge && heat > 0.3 && (
        <path
          d={edgePath}
          fill="none"
          stroke={strokeColor}
          strokeWidth={3}
          strokeDasharray="2 18"
          opacity={heat * 0.8}
          style={{
            animation: `pipeline-dash ${dashSpeed * 0.7}s linear infinite`,
          }}
        />
      )}
      {/* Label */}
      {label && (
        <foreignObject
          x={labelX - 60}
          y={labelY - 10}
          width={120}
          height={20}
          requiredExtensions="http://www.w3.org/1999/xhtml"
        >
          <div
            style={{
              fontSize: 10,
              fontFamily: fonts.mono,
              color: colors.text.label,
              textAlign: 'center',
              background: colors.bg.panel,
              padding: '1px 4px',
              borderRadius: 3,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {label}
          </div>
        </foreignObject>
      )}
    </>
  );
}

export const AnimatedFlowEdge = memo(AnimatedFlowEdgeInner);
