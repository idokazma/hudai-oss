import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  PanOnScrollMode,
  type Node,
  type NodeTypes,
  type EdgeTypes,
  type NodeMouseHandler,
  type OnNodesChange,
  applyNodeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './pipeline-styles.css';

import { useGraphStore } from '../../stores/graph-store.js';
import { layoutPipeline, type LayoutDirection } from './pipeline-layout.js';
import { PipelineBlockNode, type PipelineBlockNodeData } from './PipelineBlockNode.js';
import { AnimatedFlowEdge } from './AnimatedFlowEdge.js';
import { BlockDetailCard, BUILTIN_AGENTS } from './BlockDetailCard.js';
import { usePipelineActivity, useAllPipelinesActivity } from '../../hooks/usePipelineActivity.js';
import { usePlanPipeline } from '../../hooks/usePlanPipeline.js';
import { useConfigStore } from '../../stores/config-store.js';
import { colors, alpha, fonts } from '../../theme/tokens.js';
import { wsClient } from '../../ws/ws-client.js';
import type { PipelineDefinition, PipelineBlock, AgentDefinition } from '@hudai/shared';

const EMPTY_AGENTS: AgentDefinition[] = [];

const nodeTypes: NodeTypes = {
  pipelineBlock: PipelineBlockNode as any,
};

const edgeTypes: EdgeTypes = {
  animatedFlow: AnimatedFlowEdge as any,
};

/* ─── Pipeline agent picker state ─── */

interface AgentPickerState {
  x: number;
  y: number;
}

/* ─── Scope rectangle state ─── */

interface ScopeRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

/* ─── Detail card position state ─── */

interface DetailCardState {
  block: PipelineBlock;
  x: number;
  y: number;
  heat: number;
  isSpotlight: boolean;
  isFailing: boolean;
}

export function PipelineView() {
  const pipelineLayer = useGraphStore((s) => s.pipelineLayer);
  const pipelineAnalyzing = useGraphStore((s) => s.pipelineAnalyzing);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailCard, setDetailCard] = useState<DetailCardState | null>(null);
  const [agentPicker, setAgentPicker] = useState<AgentPickerState | null>(null);
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>('TB');
  const [scopeRect, setScopeRect] = useState<ScopeRect | null>(null);
  const [liveNodes, setLiveNodes] = useState<Node[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hasBlocksBelow, setHasBlocksBelow] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const agentPickerRef = useRef<HTMLDivElement>(null);
  const prevHadPlanRef = useRef(false);
  const rfInstanceRef = useRef<any>(null);
  const configAgents = useConfigStore((s) => s.config?.agents ?? EMPTY_AGENTS);
  const allAgents = [...BUILTIN_AGENTS, ...configAgents.filter((a) => !BUILTIN_AGENTS.some((b) => b.name === a.name))];

  const planPipeline = usePlanPipeline();
  const structuralPipelines = pipelineLayer?.pipelines ?? [];
  const pipelines = planPipeline ? [planPipeline, ...structuralPipelines] : structuralPipelines;

  // Auto-select plan tab when it first appears
  useEffect(() => {
    if (planPipeline && !prevHadPlanRef.current) {
      setSelectedId('__agent-plan__');
    }
    prevHadPlanRef.current = !!planPipeline;
  }, [planPipeline]);

  const selected: PipelineDefinition | null =
    pipelines.find((p) => p.id === selectedId) ?? pipelines[0] ?? null;

  const activity = usePipelineActivity(selected);
  const allActivity = useAllPipelinesActivity(pipelines);

  const isPlanView = selected?.category === 'agent-plan';

  // Stable empty result to avoid new array refs on every render when no pipeline selected
  const EMPTY_LAYOUT = useMemo(() => ({ layoutNodes: [] as Node[], layoutEdges: [] as any[] }), []);

  // Compute structural layout — NO activity deps (avoids 500ms re-render loop)
  const { layoutNodes, layoutEdges } = useMemo(() => {
    if (!selected) return EMPTY_LAYOUT;
    const layout = layoutPipeline(selected.blocks, selected.edges, layoutDirection);

    const enrichedNodes = layout.nodes.map((node) => {
      const enriched = { ...node, draggable: true };
      if (isPlanView) {
        const block = node.data.block as PipelineBlock;
        const planHeat = block.planStatus === 'in-progress' ? 1 : block.planStatus === 'completed' ? 0.3 : 0;
        return { ...enriched, data: { ...node.data, heat: planHeat, isSpotlight: block.planStatus === 'in-progress' } };
      }
      return enriched;
    });

    const enrichedEdges = layout.edges.map((edge) => {
      if (isPlanView) {
        const sourceBlock = selected.blocks.find((b) => b.id === edge.source);
        const targetBlock = selected.blocks.find((b) => b.id === edge.target);
        return { ...edge, data: { ...edge.data, planSourceStatus: sourceBlock?.planStatus, planTargetStatus: targetBlock?.planStatus } };
      }
      return edge;
    });

    return { layoutNodes: enrichedNodes, layoutEdges: enrichedEdges };
  }, [selected, isPlanView, layoutDirection]);

  // Sync layout into live nodes (only on structural change)
  useEffect(() => {
    setLiveNodes(layoutNodes);
  }, [layoutNodes]);

  // Merge activity onto live nodes (cheap overlay, no setState)
  const nodes = useMemo(() => {
    if (isPlanView) return liveNodes;
    return liveNodes.map((node) => {
      const blockActivity = activity.get(node.id);
      if (blockActivity) {
        return { ...node, data: { ...node.data, ...blockActivity } };
      }
      return node;
    });
  }, [liveNodes, activity, isPlanView]);

  // Compute translate extent to clamp panning near the blocks
  const translateExtent = useMemo((): [[number, number], [number, number]] => {
    if (liveNodes.length === 0) return [[-Infinity, -Infinity], [Infinity, Infinity]];
    const padX = 300;
    const padY = 80;
    const xs = liveNodes.map((n) => n.position.x);
    const ys = liveNodes.map((n) => n.position.y);
    return [
      [Math.min(...xs) - padX, Math.min(...ys) - padY],
      [Math.max(...xs) + 400 + padX, Math.max(...ys) + 200 + padY],
    ];
  }, [liveNodes]);

  // Merge activity onto edges
  const edges = useMemo(() => {
    if (isPlanView) return layoutEdges;
    return layoutEdges.map((edge) => {
      const sourceActivity = activity.get(edge.source);
      const heat = sourceActivity?.heat ?? 0;
      return { ...edge, data: { ...edge.data, heat } };
    });
  }, [layoutEdges, activity, isPlanView]);

  const handleSelectPipeline = useCallback((id: string) => {
    setSelectedId(id);
    setDetailCard(null);
  }, []);

  /* ─── Node position changes (drag) ─── */
  const onNodesChange: OnNodesChange = useCallback((changes) => {
    setLiveNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  /* ─── Scope rectangle (shift-drag on pane background) ─── */
  const onContainerMouseDown = useCallback((event: React.MouseEvent) => {
    if (!event.shiftKey) return;
    // Only start scope when clicking the pane background, not a node
    const target = event.target as HTMLElement;
    if (target.closest('.react-flow__node')) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setScopeRect({ startX: x, startY: y, currentX: x, currentY: y });
  }, []);

  const onScopeMouseMove = useCallback((event: React.MouseEvent) => {
    if (!scopeRect) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setScopeRect((prev) => prev ? { ...prev, currentX: event.clientX - rect.left, currentY: event.clientY - rect.top } : null);
  }, [scopeRect]);

  const onScopeMouseUp = useCallback(() => {
    if (!scopeRect || !rfInstanceRef.current || !selected) return;
    const instance = rfInstanceRef.current;

    // Convert screen rect corners to flow coordinates
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) { setScopeRect(null); return; }

    const topLeft = instance.screenToFlowPosition({
      x: Math.min(scopeRect.startX, scopeRect.currentX) + containerRect.left,
      y: Math.min(scopeRect.startY, scopeRect.currentY) + containerRect.top,
    });
    const bottomRight = instance.screenToFlowPosition({
      x: Math.max(scopeRect.startX, scopeRect.currentX) + containerRect.left,
      y: Math.max(scopeRect.startY, scopeRect.currentY) + containerRect.top,
    });

    // Find blocks whose centers fall within the scope rectangle
    const scopedFiles: string[] = [];
    for (const node of nodes) {
      const cx = node.position.x + 140; // approximate center
      const cy = node.position.y + 50;
      if (cx >= topLeft.x && cx <= bottomRight.x && cy >= topLeft.y && cy <= bottomRight.y) {
        const block = (node.data as PipelineBlockNodeData).block;
        scopedFiles.push(...block.files);
      }
    }

    if (scopedFiles.length > 0) {
      wsClient.send({
        kind: 'command',
        command: { type: 'scope_boundary', data: { files: [...new Set(scopedFiles)], label: 'Pipeline scope' } },
      });
    }

    setScopeRect(null);
  }, [scopeRect, selected, nodes]);

  /* ─── Track if blocks exist below viewport ─── */
  const onViewportChange = useCallback(({ x, y, zoom }: { x: number; y: number; zoom: number }) => {
    const container = containerRef.current;
    if (!container || liveNodes.length === 0) return;
    const rect = container.getBoundingClientRect();
    const maxNodeBottom = Math.max(...liveNodes.map((n) => n.position.y + 200));
    const viewportBottom = (-y + rect.height) / zoom;
    setHasBlocksBelow(maxNodeBottom > viewportBottom + 20);
  }, [liveNodes]);

  /* ─── Click background → dismiss overlays ─── */
  const onPaneClick = useCallback(() => {
    setDetailCard(null);
    setAgentPicker(null);
  }, []);

  /* ─── Click → Detail Card ─── */
  const onNodeClick: NodeMouseHandler = useCallback((event, node) => {
    const data = node.data as PipelineBlockNodeData;
    const rect = containerRef.current?.getBoundingClientRect();
    const mouseEvent = event as unknown as MouseEvent;
    const rawX = mouseEvent.clientX - (rect?.left ?? 0);
    const rawY = mouseEvent.clientY - (rect?.top ?? 0);

    // Position card to the right of the click, clamped to container
    const cardWidth = 320;
    const cardHeight = 350;
    let x = rawX + 16;
    let y = rawY - 20;
    if (rect) {
      // If card would overflow right, place it to the left of the click instead
      if (x + cardWidth > rect.width) x = rawX - cardWidth - 16;
      y = Math.min(y, rect.height - cardHeight);
      x = Math.max(8, x);
      y = Math.max(8, y);
    }

    setDetailCard({
      block: data.block,
      x,
      y,
      heat: data.heat ?? 0,
      isSpotlight: data.isSpotlight ?? false,
      isFailing: data.isFailing ?? false,
    });
  }, []);

  /* ─── Send prompt from detail card ─── */
  const handleSendPrompt = useCallback((text: string) => {
    wsClient.send({
      kind: 'command',
      command: { type: 'prompt', data: { text } },
    });
    setDetailCard(null);
  }, []);

  /* ─── Right-click background → pipeline agent picker ─── */
  const onPaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rawX = (event as MouseEvent).clientX - rect.left;
    const rawY = (event as MouseEvent).clientY - rect.top;
    const x = Math.max(8, Math.min(rawX, rect.width - 240));
    const y = Math.max(8, Math.min(rawY, rect.height - 260));
    setDetailCard(null);
    setAgentPicker({ x, y });
  }, []);

  const handlePipelineAgent = useCallback((agent: AgentDefinition) => {
    if (!selected) return;
    const allFiles = [...new Set(selected.blocks.flatMap((b) => b.files))];
    const blockSummary = selected.blocks.map((b) => `- ${b.label} (${b.blockType}${b.technology ? ', ' + b.technology : ''})`).join('\n');
    const fileList = allFiles.length > 0
      ? `\nFiles: ${allFiles.slice(0, 20).join(', ')}${allFiles.length > 20 ? ` (+${allFiles.length - 20} more)` : ''}`
      : '';
    const prompt = `Use a subagent (Task tool, subagent_type="${agent.name}") to work on the "${selected.label}" pipeline.\n\nBlocks:\n${blockSummary}${fileList}\n\n${agent.description ? `Agent purpose: ${agent.description}\n` : ''}The subagent should analyze the full pipeline, identify issues or improvements across blocks, and report back with findings.`;
    wsClient.send({
      kind: 'command',
      command: { type: 'prompt', data: { text: prompt } },
    });
    setAgentPicker(null);
  }, [selected]);

  // Close pipeline dropdown on click outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handle = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as HTMLElement)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [dropdownOpen]);

  // Close agent picker on click outside
  useEffect(() => {
    if (!agentPicker) return;
    const handle = (e: MouseEvent) => {
      if (agentPickerRef.current && !agentPickerRef.current.contains(e.target as HTMLElement)) {
        setAgentPicker(null);
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handle), 100);
    return () => { document.removeEventListener('mousedown', handle); clearTimeout(timer); };
  }, [agentPicker]);

  if (pipelines.length === 0) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 12,
          color: colors.text.muted,
          fontFamily: fonts.mono,
          fontSize: 12,
        }}
      >
        {pipelineAnalyzing ? (
          <>
            <div style={{
              width: 24,
              height: 24,
              border: `2px solid ${colors.border.subtle}`,
              borderTop: `2px solid ${colors.accent.blue}`,
              borderRadius: '50%',
              animation: 'pipeline-spin 1s linear infinite',
            }} />
            <span>Analyzing pipelines...</span>
            <style>{`
              @keyframes pipeline-spin {
                to { transform: rotate(360deg); }
              }
            `}</style>
          </>
        ) : (
          'No pipeline data — attach to a session'
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="pipeline-view"
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onMouseDown={onContainerMouseDown}
      onMouseMove={scopeRect ? onScopeMouseMove : undefined}
      onMouseUp={scopeRect ? onScopeMouseUp : undefined}
    >
      {/* Pipeline selector dropdown — positioned after the view-mode dropdown */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 110,
          zIndex: 10,
          display: 'flex',
          gap: 6,
          alignItems: 'center',
        }}
      >
        {/* Direction toggle */}
        <button
          onClick={() => setLayoutDirection((d) => (d === 'LR' ? 'TB' : 'LR'))}
          title={layoutDirection === 'LR' ? 'Switch to vertical layout' : 'Switch to horizontal layout'}
          style={{
            padding: '2px 6px',
            fontSize: 13,
            fontFamily: fonts.mono,
            background: colors.surface.raised,
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: 3,
            color: colors.text.muted,
            cursor: 'pointer',
            lineHeight: 1,
          }}
        >
          {layoutDirection === 'LR' ? '⇄' : '⇅'}
        </button>
        {/* Custom dropdown */}
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          {/* Trigger button */}
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontFamily: fonts.mono,
              background: colors.bg.panel,
              border: `1px solid ${dropdownOpen ? colors.accent.blue : colors.border.subtle}`,
              borderRadius: 4,
              color: colors.text.primary,
              padding: '4px 24px 4px 8px',
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              minWidth: 140,
              position: 'relative',
              transition: 'border-color 0.2s ease',
            }}
          >
            {(() => {
              const selActivity = selected ? allActivity.get(selected.id) : undefined;
              const isPlanSel = selected?.category === 'agent-plan';
              const hasAct = isPlanSel || (selActivity?.hasActivity ?? false);
              const dotColor = isPlanSel
                ? colors.block.planStep
                : (selActivity?.hasFailing)
                  ? colors.status.errorLight
                  : (selActivity?.hasEdits)
                    ? colors.accent.orange
                    : colors.accent.blue;
              return hasAct ? (
                <div style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: dotColor,
                  boxShadow: `0 0 4px ${dotColor}`,
                  flexShrink: 0,
                }} />
              ) : null;
            })()}
            {selected ? selected.label.replace(' Pipeline', '').replace(' Flow', '') : 'Select...'}
            {/* Chevron */}
            <svg
              width="10" height="6"
              viewBox="0 0 10 6"
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: `translateY(-50%) ${dropdownOpen ? 'rotate(180deg)' : ''}`,
                transition: 'transform 0.2s ease',
              }}
            >
              <path d="M0 0l5 6 5-6z" fill={colors.text.muted} />
            </svg>
          </button>

          {/* Dropdown menu */}
          {dropdownOpen && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              minWidth: '100%',
              background: colors.bg.panel,
              border: `1px solid ${colors.border.medium}`,
              borderRadius: 4,
              boxShadow: `0 4px 16px rgba(0,0,0,0.5), 0 0 8px ${colors.accent.blue}10`,
              overflow: 'hidden',
              zIndex: 20,
            }}>
              {pipelines.map((p) => {
                const isOpt = p.id === (selected?.id ?? '');
                const isPlanOpt = p.category === 'agent-plan';
                const act = allActivity.get(p.id);
                const hasAct = isPlanOpt || (act?.hasActivity ?? false);
                const dotColor = isPlanOpt
                  ? colors.block.planStep
                  : (act?.hasFailing)
                    ? colors.status.errorLight
                    : (act?.hasEdits)
                      ? colors.accent.orange
                      : colors.accent.blue;

                return (
                  <button
                    key={p.id}
                    onClick={() => { handleSelectPipeline(p.id); setDropdownOpen(false); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      width: '100%',
                      padding: '6px 10px',
                      fontSize: 11,
                      fontFamily: fonts.mono,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                      background: isOpt ? `${colors.accent.blue}25` : 'transparent',
                      border: 'none',
                      color: isOpt ? colors.accent.blueLight : colors.text.secondary,
                      cursor: 'pointer',
                      textAlign: 'left',
                      whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={(e) => {
                      if (!isOpt) (e.currentTarget as HTMLElement).style.background = colors.surface.hover;
                    }}
                    onMouseLeave={(e) => {
                      if (!isOpt) (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                  >
                    {hasAct ? (
                      <div style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: dotColor,
                        boxShadow: `0 0 4px ${dotColor}`,
                        flexShrink: 0,
                      }} />
                    ) : (
                      <div style={{ width: 5, flexShrink: 0 }} />
                    )}
                    {p.label.replace(' Pipeline', '').replace(' Flow', '')}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {selected?.description && (
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            maxWidth: 400,
            padding: '6px 10px',
            background: colors.bg.panel,
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: 4,
            fontSize: 11,
            fontFamily: fonts.mono,
            color: colors.text.muted,
            lineHeight: 1.4,
          }}
        >
          {selected.description}
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(instance) => {
          rfInstanceRef.current = instance;
          // Set initial zoom to show ~3 blocks, aligned to top
          // TB block height ~130 + 80 gap = 210 per block, 3 blocks ≈ 630px
          const container = containerRef.current;
          if (container && nodes.length > 0) {
            const rect = container.getBoundingClientRect();
            const targetZoom = Math.min(1.2, rect.height / 700);
            // Find top-most node
            const minY = Math.min(...nodes.map((n) => n.position.y));
            const centerX = nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length + 190;
            instance.setViewport({ x: rect.width / 2 - centerX * targetZoom, y: -minY * targetZoom + 40, zoom: targetZoom }, { duration: 0 });
            // Check if blocks are below initial viewport
            const maxNodeBottom = Math.max(...nodes.map((n) => n.position.y + 200));
            const viewportBottom = (minY * targetZoom - 40 + rect.height) / targetZoom;
            setHasBlocksBelow(maxNodeBottom > viewportBottom + 20);
          }
        }}
        onViewportChange={onViewportChange}
        onNodesChange={onNodesChange}
        minZoom={0.3}
        maxZoom={2}
        zoomOnScroll={false}
        panOnScroll={true}
        panOnScrollMode={PanOnScrollMode.Free}
        translateExtent={translateExtent}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        elementsSelectable={true}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onPaneContextMenu={onPaneContextMenu}
      >
        <Background color={colors.bg.secondary} gap={20} />
        <Controls position="bottom-right" />
        <MiniMap
          position="bottom-left"
          nodeColor={alpha(colors.accent.primary, 0.4)}
          maskColor={colors.bg.panel}
          style={{ width: 120, height: 80 }}
        />
      </ReactFlow>

      {/* Block Detail Card */}
      {detailCard && (
        <BlockDetailCard
          block={detailCard.block}
          x={detailCard.x}
          y={detailCard.y}
          heat={detailCard.heat}
          isSpotlight={detailCard.isSpotlight}
          isFailing={detailCard.isFailing}
          onClose={() => setDetailCard(null)}
          onSendPrompt={handleSendPrompt}
        />
      )}

      {/* Pipeline agent picker (right-click background) */}
      {agentPicker && (
        <div
          ref={agentPickerRef}
          style={{
            position: 'absolute',
            left: agentPicker.x,
            top: agentPicker.y,
            width: 230,
            background: colors.bg.panel,
            border: `1px solid ${colors.accent.orange}44`,
            borderRadius: 8,
            boxShadow: `0 4px 24px rgba(0,0,0,0.5), 0 0 12px ${colors.accent.orange}15`,
            zIndex: 25,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{
            padding: '8px 10px',
            borderBottom: `1px solid ${colors.accent.orange}22`,
            fontSize: 11,
            fontFamily: fonts.mono,
            fontWeight: 600,
            color: colors.text.secondary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span>Send agent to pipeline</span>
            <button
              onClick={() => setAgentPicker(null)}
              style={{ background: 'none', border: 'none', color: colors.text.muted, fontSize: 14, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
            >
              ×
            </button>
          </div>
          <div style={{ padding: 4, maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {allAgents.map((agent) => (
              <button
                key={agent.name}
                onClick={() => handlePipelineAgent(agent)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  padding: '6px 8px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = colors.surface.hover; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <span style={{ fontSize: 12, fontFamily: fonts.mono, fontWeight: 600, color: colors.accent.orangeLight }}>
                  {agent.name}
                </span>
                {agent.description && (
                  <span style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.text.muted, lineHeight: 1.3 }}>
                    {agent.description}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Scope selection rectangle */}
      {scopeRect && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(scopeRect.startX, scopeRect.currentX),
            top: Math.min(scopeRect.startY, scopeRect.currentY),
            width: Math.abs(scopeRect.currentX - scopeRect.startX),
            height: Math.abs(scopeRect.currentY - scopeRect.startY),
            border: `2px solid ${colors.action.edit}`,
            background: alpha(colors.action.edit, 0.08),
            borderRadius: 2,
            pointerEvents: 'none',
            zIndex: 30,
          }}
        />
      )}

      {/* Scroll-down indicator */}
      {hasBlocksBelow && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            animation: 'scroll-hint 1.5s ease-in-out infinite',
          }}
        >
          <span style={{
            fontSize: 10,
            fontFamily: fonts.mono,
            color: colors.text.muted,
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}>
            more
          </span>
          <span style={{ fontSize: 18, color: colors.accent.blueLight }}>▼</span>
        </div>
      )}
      <style>{`
        @keyframes scroll-hint {
          0%, 100% { opacity: 0.3; transform: translateX(-50%) translateY(0); }
          50% { opacity: 1; transform: translateX(-50%) translateY(4px); }
        }
      `}</style>

    </div>
  );
}
