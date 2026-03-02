import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { nodeRadius, type SimNode } from './ForceLayout.js';
import type { ActivityKind, FileIndicator, SemanticZoomTier } from '../../stores/graph-store.js';
import type { ContainerRelationship } from '@hudai/shared';
import { colors, hex } from '../../theme/tokens.js';

export interface PositionedActivity {
  id: string;
  kind: ActivityKind;
  label: string;
  detail?: string;
  heat: number;
  x: number;
  y: number;
}

// Color constants — derived from centralized tokens
const COLOR_MODIFIED = hex(colors.accent.muted);
const COLOR_GLOW_READ = hex(colors.accent.light);
const COLOR_GLOW_WRITE = hex(colors.accent.light);
const COLOR_HIGHLIGHT = 0xffffff;
const COLOR_HIGHLIGHT_EDGE = hex(colors.accent.light);
const EDGE_COLOR = hex(colors.accent.primary);
const COLOR_FOCUS_RING = hex(colors.accent.light);
const COLOR_SCOPE_RING = hex(colors.action.edit);
const COLOR_SPOTLIGHT = hex(colors.accent.primary);
const COLOR_CONTAINER_BG = hex(colors.bg.secondary);
const COLOR_CONTAINER_BORDER = hex(colors.accent.primary);
const COLOR_CONTAINER_LABEL = hex(colors.text.primary);
const COLOR_CONTAINER_TECH = hex(colors.text.dimmed);

// File indicator colors
const INDICATOR_COLORS: Record<string, number> = {
  read: hex(colors.accent.primary),
  edit: hex(colors.accent.muted),
  create: hex(colors.action.edit),
  delete: hex(colors.status.error),
  search: hex(colors.action.search),
};

const INDICATOR_LABELS: Record<string, string> = {
  read: 'R',
  edit: 'E',
  create: '+',
  delete: '×',
  search: '?',
};

// Directory color palette
const GROUP_PALETTE = [
  hex(colors.accent.primary), hex(colors.action.edit), hex(colors.action.think), hex(colors.accent.light), hex(colors.action.search),
  0xe74c8b, hex(colors.action.bash), 0x5dade2, hex(colors.accent.muted), 0x7dcea0,
  hex(colors.terminal.magenta), hex(colors.terminal.cyan), hex(colors.terminal.yellow), 0x85c1e9, 0xd98880,
];

// Activity kind colors
const ACTIVITY_COLORS: Record<ActivityKind, number> = {
  shell: hex(colors.action.bash),
  web: 0x00d4ff,
  thinking: hex(colors.terminal.magenta),
  testing: hex(colors.action.edit),
  search: 0x5dade2,
  error: hex(colors.status.errorLight),
  prompt: hex(colors.terminal.yellow),
};

const groupColorCache = new Map<string, number>();

function getGroupColor(group: string): number {
  let color = groupColorCache.get(group);
  if (color !== undefined) return color;
  let hash = 0;
  for (let i = 0; i < group.length; i++) {
    hash = ((hash << 5) - hash + group.charCodeAt(i)) | 0;
  }
  color = GROUP_PALETTE[Math.abs(hash) % GROUP_PALETTE.length];
  groupColorCache.set(group, color);
  return color;
}

function getNodeColor(node: SimNode): number {
  if (node.modified) return COLOR_MODIFIED;
  return getGroupColor(node.group);
}

function getGlowColor(node: SimNode): number {
  return node.modified ? COLOR_GLOW_WRITE : COLOR_GLOW_READ;
}

export class MapRenderer {
  app: Application;
  world: Container;
  onNodeDoubleClick: ((node: SimNode) => void) | null = null;
  onNodeClick: ((node: SimNode, shiftKey: boolean, screenX?: number, screenY?: number) => void) | null = null;
  /** Right-click on any node (file or group). Passes node + screen position for popup. */
  onNodeRightClick: ((node: SimNode, screenX: number, screenY: number) => void) | null = null;
  /** Click on empty space (no node hit). Used to dismiss overlays. */
  onBackgroundClick: (() => void) | null = null;

  private nodeGfx = new Map<string, Graphics>();
  private labelGfx = new Map<string, Text>();
  private edgeGfx: Graphics;
  private highlightEdgeGfx: Graphics;
  private indicatorGfx: Graphics;
  private scale = 1;
  private offset = { x: 0, y: 0 };
  private dragging = false;
  private dragStart = { x: 0, y: 0 };
  private dragMoved = false;
  private pointerDownPos = { x: 0, y: 0 };
  private canvas: HTMLCanvasElement | null = null;

  // Hover state
  private hoveredNodeId: string | null = null;
  private connectedNodeIds = new Set<string>();
  private currentNodes: SimNode[] = [];
  private currentNodeById: Map<string, SimNode> = new Map();
  private currentEdges: { source: string; target: string }[] = [];
  private tooltip: Text | null = null;
  private adjacency = new Map<string, Set<string>>();

  // Activity nodes — pooled graphics to avoid destroy/recreate
  private activityContainer: Container;
  private activityPool: { gfx: Graphics; lbl: Text }[] = [];
  private activityData: PositionedActivity[] = [];

  // File indicators
  private _fileIndicators: Map<string, FileIndicator> = new Map();
  private indicatorLabels = new Map<string, Text>();

  // Double-click detection
  private lastClickTime = 0;
  private lastClickNodeId: string | null = null;

  // Focus state
  private focusedNodeId: string | null = null;
  private focusLabel: Text | null = null;
  private focusTimeout: ReturnType<typeof setTimeout> | null = null;

  // Scope selection
  private _scopeNodeIds = new Set<string>();

  // Agent spotlight
  private _spotlightNodeId: string | null = null;
  private spotlightGfx: Graphics;
  private spotlightPhase = 0;
  private spotlightTicker: ReturnType<typeof setInterval> | null = null;

  // Movement trail
  private trailGfx: Graphics;
  private _trailNodeIds: string[] = [];

  // Test failure highlighting
  private _failingFiles = new Set<string>();

  // Cumulative activity counts per node (for activity rings)
  private _activityCounts: Map<string, { reads: number; edits: number; shells: number; searches: number }> = new Map();

  // Diff annotation labels (reusable text per node)
  private diffLabels = new Map<string, Text>();

  // Architecture mode
  private _semanticZoom: SemanticZoomTier = 'file';
  private _isArchMode = false;
  private _containerRelationships: ContainerRelationship[] = [];
  private containerTechLabels = new Map<string, Text>();
  private containerStatLabels = new Map<string, Text>();
  private relationshipGfx: Graphics;
  private relationshipLabels = new Map<string, Text>();
  private onZoomChange: ((zoom: number) => void) | null = null;

  constructor() {
    this.app = new Application();
    this.world = new Container();
    this.edgeGfx = new Graphics();
    this.highlightEdgeGfx = new Graphics();
    this.indicatorGfx = new Graphics();
    this.spotlightGfx = new Graphics();
    this.trailGfx = new Graphics();
    this.activityContainer = new Container();
    this.relationshipGfx = new Graphics();
  }

  get scopeNodeIds(): Set<string> {
    return this._scopeNodeIds;
  }

  async init(canvas: HTMLCanvasElement, width: number, height: number) {
    this.canvas = canvas;

    await this.app.init({
      canvas,
      width,
      height,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    this.app.stage.addChild(this.world);
    this.world.addChild(this.relationshipGfx);
    this.world.addChild(this.edgeGfx);
    this.world.addChild(this.highlightEdgeGfx);
    this.world.addChild(this.trailGfx);
    this.world.addChild(this.indicatorGfx);
    this.world.addChild(this.activityContainer);
    this.world.addChild(this.spotlightGfx);

    this.tooltip = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'Courier New, monospace',
        fontSize: 11,
        fill: hex(colors.text.primary),
        padding: 4,
      }),
    });
    this.tooltip.visible = false;
    this.app.stage.addChild(this.tooltip);

    this.focusLabel = new Text({
      text: 'FOCUS',
      style: new TextStyle({
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: 8,
        fill: COLOR_FOCUS_RING,
        letterSpacing: 2,
        fontWeight: 'bold',
      }),
    });
    this.focusLabel.anchor.set(0.5, 0);
    this.focusLabel.visible = false;
    this.world.addChild(this.focusLabel);

    // Spotlight + failing files animation
    this.spotlightTicker = setInterval(() => {
      this.spotlightPhase = (this.spotlightPhase + 0.05) % (Math.PI * 2);
      if (this._spotlightNodeId || this._failingFiles.size > 0) {
        this.spotlightGfx.clear();
        this.renderSpotlight();
        this.renderFailingFiles();
      }
      if (this._trailNodeIds.length > 0) {
        this.renderTrail();
      }
    }, 50);

    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  createNodes(nodes: SimNode[]) {
    for (const gfx of this.nodeGfx.values()) {
      this.world.removeChild(gfx);
      gfx.destroy();
    }
    for (const lbl of this.labelGfx.values()) {
      this.world.removeChild(lbl);
      lbl.destroy();
    }
    for (const lbl of this.indicatorLabels.values()) {
      this.world.removeChild(lbl);
      lbl.destroy();
    }
    for (const lbl of this.containerTechLabels.values()) {
      this.world.removeChild(lbl);
      lbl.destroy();
    }
    for (const lbl of this.containerStatLabels.values()) {
      this.world.removeChild(lbl);
      lbl.destroy();
    }
    for (const lbl of this.relationshipLabels.values()) {
      this.world.removeChild(lbl);
      lbl.destroy();
    }
    this.nodeGfx.clear();
    this.labelGfx.clear();
    this.indicatorLabels.clear();
    this.containerTechLabels.clear();
    this.containerStatLabels.clear();
    this.relationshipLabels.clear();
    this.adjacency.clear();

    for (const node of nodes) {
      const gfx = new Graphics();
      this.world.addChild(gfx);
      this.nodeGfx.set(node.id, gfx);

      if (node.isContainerNode) {
        // Container label (large)
        const lbl = new Text({
          text: node.label,
          style: new TextStyle({
            fontFamily: 'Trebuchet MS, sans-serif',
            fontSize: 13,
            fill: COLOR_CONTAINER_LABEL,
            fontWeight: 'bold',
            letterSpacing: 1,
          }),
        });
        lbl.anchor.set(0.5, 0.5);
        this.world.addChild(lbl);
        this.labelGfx.set(node.id, lbl);

        // Technology badge
        if (node.containerTech) {
          const techLbl = new Text({
            text: `[${node.containerTech}]`,
            style: new TextStyle({
              fontFamily: 'Courier New, monospace',
              fontSize: 9,
              fill: COLOR_CONTAINER_TECH,
              letterSpacing: 0.3,
            }),
          });
          techLbl.anchor.set(0.5, 0);
          this.world.addChild(techLbl);
          this.containerTechLabels.set(node.id, techLbl);
        }

        // Stats label (file count, modified)
        const statLbl = new Text({
          text: '',
          style: new TextStyle({
            fontFamily: 'Courier New, monospace',
            fontSize: 8,
            fill: COLOR_CONTAINER_TECH,
          }),
        });
        statLbl.anchor.set(0.5, 0);
        this.world.addChild(statLbl);
        this.containerStatLabels.set(node.id, statLbl);
      } else if (node.isGroupNode) {
        const lbl = new Text({
          text: node.label,
          style: new TextStyle({
            fontFamily: 'Trebuchet MS, sans-serif',
            fontSize: 9,
            fill: hex(colors.text.primary),
            letterSpacing: 0.5,
          }),
        });
        lbl.anchor.set(0.5, 0.5);
        this.world.addChild(lbl);
        this.labelGfx.set(node.id, lbl);
      }
    }
  }

  updatePositions(nodes: SimNode[], nodeById: Map<string, SimNode>, edges: { source: string; target: string }[]) {
    this.currentNodes = nodes;
    this.currentNodeById = nodeById;
    this.currentEdges = edges;

    if (edges.length > 0 && this.adjacency.size === 0) {
      this.buildAdjacency(edges);
    }

    this.render();
  }

  setSpotlight(nodeId: string | null) {
    this._spotlightNodeId = nodeId;
    // spotlightGfx is continuously redrawn by the ticker
  }

  setFileIndicators(indicators: Map<string, FileIndicator>) {
    this._fileIndicators = indicators;
  }

  setTrail(nodeIds: string[]) {
    this._trailNodeIds = nodeIds;
    this.renderTrail();
  }

  setFailingFiles(files: Set<string>) {
    this._failingFiles = files;
  }

  setActivityCounts(counts: Map<string, { reads: number; edits: number; shells: number; searches: number }>) {
    this._activityCounts = counts;
  }

  setArchitectureMode(enabled: boolean) {
    this._isArchMode = enabled;
  }

  setSemanticZoom(tier: SemanticZoomTier) {
    this._semanticZoom = tier;
  }

  setContainerRelationships(rels: ContainerRelationship[]) {
    this._containerRelationships = rels;
  }

  setOnZoomChange(cb: ((zoom: number) => void) | null) {
    this.onZoomChange = cb;
  }

  getScale(): number {
    return this.scale;
  }

  showFocusRing(nodeId: string) {
    this.focusedNodeId = nodeId;
    if (this.focusTimeout) clearTimeout(this.focusTimeout);
    this.focusTimeout = setTimeout(() => {
      this.focusedNodeId = null;
      if (this.focusLabel) this.focusLabel.visible = false;
      this.render();
    }, 2000);
    this.render();
  }

  toggleScopeNode(nodeId: string) {
    if (this._scopeNodeIds.has(nodeId)) {
      this._scopeNodeIds.delete(nodeId);
    } else {
      this._scopeNodeIds.add(nodeId);
    }
    this.render();
  }

  clearScope() {
    this._scopeNodeIds.clear();
    this.render();
  }

  private buildAdjacency(edges: { source: string; target: string }[]) {
    this.adjacency.clear();
    for (const edge of edges) {
      const sId = typeof edge.source === 'string' ? edge.source : (edge.source as any).id;
      const tId = typeof edge.target === 'string' ? edge.target : (edge.target as any).id;
      if (!this.adjacency.has(sId)) this.adjacency.set(sId, new Set());
      if (!this.adjacency.has(tId)) this.adjacency.set(tId, new Set());
      this.adjacency.get(sId)!.add(tId);
      this.adjacency.get(tId)!.add(sId);
    }
  }

  private render() {
    const { currentNodes: nodes, currentNodeById: nodeById, currentEdges: edges } = this;
    const hovered = this.hoveredNodeId;
    const connected = this.connectedNodeIds;
    const hasHover = hovered !== null;

    // Edges
    this.edgeGfx.clear();
    this.highlightEdgeGfx.clear();

    for (const edge of edges) {
      const sId = typeof edge.source === 'string' ? edge.source : (edge.source as any).id;
      const tId = typeof edge.target === 'string' ? edge.target : (edge.target as any).id;
      const s = nodeById.get(sId);
      const t = nodeById.get(tId);
      if (!s || !t) continue;

      const isHighlighted = hasHover && (sId === hovered || tId === hovered);
      if (isHighlighted) {
        this.highlightEdgeGfx.moveTo(s.x, s.y).lineTo(t.x, t.y);
      } else {
        this.edgeGfx.moveTo(s.x, s.y).lineTo(t.x, t.y);
      }
    }

    this.edgeGfx.stroke({ width: 0.5, color: EDGE_COLOR, alpha: hasHover ? 0.03 : 0.08 });
    if (hasHover) {
      this.highlightEdgeGfx.stroke({ width: 1.5, color: COLOR_HIGHLIGHT_EDGE, alpha: 0.5 });
    }

    // File indicators overlay
    this.indicatorGfx.clear();
    const now = Date.now();

    // Container relationship arrows (architecture mode)
    this.relationshipGfx.clear();
    if (this._isArchMode && this._semanticZoom === 'container' && this._containerRelationships.length > 0) {
      for (const rel of this._containerRelationships) {
        const sNode = nodeById.get(`__container__${rel.source}`);
        const tNode = nodeById.get(`__container__${rel.target}`);
        if (!sNode || !tNode) continue;

        // Draw dashed line
        const dx = tNode.x - sNode.x;
        const dy = tNode.y - sNode.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const sR = nodeRadius(sNode.displaySize ?? sNode.size, false, sNode.childCount, true);
        const tR = nodeRadius(tNode.displaySize ?? tNode.size, false, tNode.childCount, true);
        const startX = sNode.x + nx * (sR + 8);
        const startY = sNode.y + ny * (sR + 8);
        const endX = tNode.x - nx * (tR + 8);
        const endY = tNode.y - ny * (tR + 8);

        this.relationshipGfx.moveTo(startX, startY).lineTo(endX, endY)
          .stroke({ width: 2, color: EDGE_COLOR, alpha: 0.4 });

        // Arrowhead
        const aLen = 10;
        const ax = endX - nx * aLen;
        const ay = endY - ny * aLen;
        const px = -ny * 4;
        const py = nx * 4;
        this.relationshipGfx
          .moveTo(endX, endY)
          .lineTo(ax + px, ay + py)
          .lineTo(ax - px, ay - py)
          .closePath()
          .fill({ color: EDGE_COLOR, alpha: 0.5 });

        // Relationship label at midpoint
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        const relKey = `${rel.source}→${rel.target}`;
        let rlbl = this.relationshipLabels.get(relKey);
        if (!rlbl) {
          rlbl = new Text({
            text: rel.label,
            style: new TextStyle({
              fontFamily: 'Courier New, monospace',
              fontSize: 8,
              fill: COLOR_CONTAINER_TECH,
            }),
          });
          rlbl.anchor.set(0.5, 0.5);
          this.world.addChild(rlbl);
          this.relationshipLabels.set(relKey, rlbl);
        }
        rlbl.text = rel.label;
        rlbl.position.set(midX, midY - 8);
        rlbl.visible = true;
      }
    } else {
      // Hide all relationship labels when not in container zoom
      for (const lbl of this.relationshipLabels.values()) lbl.visible = false;
    }

    // Nodes
    for (const node of nodes) {
      const gfx = this.nodeGfx.get(node.id);
      if (!gfx) continue;

      gfx.clear();
      const isContainer = !!node.isContainerNode;
      const isGroup = !!node.isGroupNode;
      const r = nodeRadius(node.displaySize ?? node.size, isGroup, node.childCount, isContainer);
      const isHovered = node.id === hovered;
      const isConnected = connected.has(node.id);
      const isDimmed = hasHover && !isHovered && !isConnected;
      const isFocused = node.id === this.focusedNodeId;
      const isScoped = this._scopeNodeIds.has(node.id);
      const indicator = this._fileIndicators.get(node.id);
      const hasIndicator = indicator && (now - indicator.timestamp < 4000);

      // Container node: render as rounded rectangle (C4-style)
      if (isContainer) {
        const boxW = r * 2.4;
        const boxH = r * 1.6;
        const borderColor = node.modified ? COLOR_MODIFIED : getGroupColor(node.path || node.id);
        const borderAlpha = isDimmed ? 0.1 : (isHovered ? 0.9 : 0.6);

        // Heat glow around container
        if (node.heat > 0.05 && !isDimmed) {
          const glowColor = getGlowColor(node);
          gfx.roundRect(-boxW / 2 - 4, -boxH / 2 - 4, boxW + 8, boxH + 8, 14)
            .fill({ color: glowColor, alpha: node.heat * 0.15 });
        }

        // Hover ring
        if (isHovered) {
          gfx.roundRect(-boxW / 2 - 3, -boxH / 2 - 3, boxW + 6, boxH + 6, 12)
            .fill({ color: COLOR_HIGHLIGHT, alpha: 0.08 });
        }

        // Background fill
        gfx.roundRect(-boxW / 2, -boxH / 2, boxW, boxH, 10)
          .fill({ color: COLOR_CONTAINER_BG, alpha: isDimmed ? 0.3 : 0.9 });

        // Border
        gfx.roundRect(-boxW / 2, -boxH / 2, boxW, boxH, 10)
          .stroke({ width: 2, color: borderColor, alpha: borderAlpha });

        // Activity ring segments on the border bottom
        const actCounts = this._activityCounts.get(node.id);
        if (actCounts && !isDimmed) {
          const total = actCounts.reads + actCounts.edits + actCounts.shells + actCounts.searches;
          if (total > 0) {
            const barY = boxH / 2 - 6;
            const barW = boxW - 20;
            const segments = [
              { count: actCounts.reads, color: hex(colors.accent.primary) },
              { count: actCounts.edits, color: hex(colors.accent.muted) },
              { count: actCounts.shells, color: hex(colors.action.bash) },
              { count: actCounts.searches, color: hex(colors.action.search) },
            ];
            let xOff = -barW / 2;
            for (const seg of segments) {
              if (seg.count === 0) continue;
              const segW = (seg.count / total) * barW;
              gfx.rect(xOff, barY, segW, 3)
                .fill({ color: seg.color, alpha: 0.7 });
              xOff += segW;
            }
          }
        }

        // Spotlight indicator
        if (this._spotlightNodeId === node.id) {
          const pulse = 0.5 + 0.5 * Math.sin(this.spotlightPhase);
          gfx.roundRect(-boxW / 2 - 6, -boxH / 2 - 6, boxW + 12, boxH + 12, 14)
            .stroke({ width: 2, color: COLOR_SPOTLIGHT, alpha: 0.3 + pulse * 0.3 });
        }

        gfx.position.set(node.x, node.y);

        // Position label centered in the box (upper area)
        const lbl = this.labelGfx.get(node.id);
        if (lbl) {
          lbl.position.set(node.x, node.y - boxH * 0.15);
          lbl.alpha = isDimmed ? 0.1 : 0.95;
        }

        // Tech label below main label
        const techLbl = this.containerTechLabels.get(node.id);
        if (techLbl) {
          techLbl.position.set(node.x, node.y + 4);
          techLbl.alpha = isDimmed ? 0.05 : 0.6;
        }

        // Stats label
        const statLbl = this.containerStatLabels.get(node.id);
        if (statLbl) {
          const modCount = node.modified ? ' modified' : '';
          statLbl.text = `${node.childCount ?? 0} files${modCount}`;
          statLbl.position.set(node.x, node.y + boxH * 0.2);
          statLbl.alpha = isDimmed ? 0.05 : 0.45;
        }

        continue; // Skip regular node rendering
      }

      // Heat glow — more prominent
      if (node.heat > 0.05 && !isDimmed) {
        const glowColor = getGlowColor(node);
        const glowR = r + 6 + node.heat * 12;
        gfx.circle(0, 0, glowR).fill({ color: glowColor, alpha: node.heat * 0.25 });
        // Inner pulse for hot nodes
        if (node.heat > 0.3) {
          gfx.circle(0, 0, r + 3 + node.heat * 4).fill({ color: glowColor, alpha: node.heat * 0.12 });
        }
      }

      // Hover highlight ring
      if (isHovered) {
        gfx.circle(0, 0, r + 3).fill({ color: COLOR_HIGHLIGHT, alpha: 0.15 });
      }

      // Focus ring
      if (isFocused) {
        gfx.circle(0, 0, r + 6).stroke({ width: 2, color: COLOR_FOCUS_RING, alpha: 0.9 });
        gfx.circle(0, 0, r + 10).stroke({ width: 1, color: COLOR_FOCUS_RING, alpha: 0.3 });
        if (this.focusLabel) {
          this.focusLabel.visible = true;
          this.focusLabel.position.set(node.x, node.y - r - 16);
        }
      }

      // Scope selection ring
      if (isScoped) {
        gfx.circle(0, 0, r + 5).stroke({ width: 2, color: COLOR_SCOPE_RING, alpha: 0.8 });
      }

      // Activity ring — segmented arc showing cumulative reads/edits/shells/searches
      const actCounts = this._activityCounts.get(node.id);
      if (actCounts && !isDimmed) {
        const total = actCounts.reads + actCounts.edits + actCounts.shells + actCounts.searches;
        if (total > 0) {
          const ringR = r + 3;
          const ringWidth = Math.min(4, 1 + Math.log2(total + 1));
          const segments: { count: number; color: number }[] = [
            { count: actCounts.reads, color: hex(colors.accent.primary) },
            { count: actCounts.edits, color: hex(colors.accent.muted) },
            { count: actCounts.shells, color: hex(colors.action.bash) },
            { count: actCounts.searches, color: hex(colors.action.search) },
          ];
          let startAngle = -Math.PI / 2;
          for (const seg of segments) {
            if (seg.count === 0) continue;
            const sweep = (seg.count / total) * Math.PI * 2;
            const endAngle = startAngle + sweep;
            gfx.arc(0, 0, ringR, startAngle, endAngle)
              .stroke({ width: ringWidth, color: seg.color, alpha: 0.7 });
            startAngle = endAngle;
          }

          // Cumulative glow: brighter for heavily-touched nodes
          if (total >= 3) {
            const glowAlpha = Math.min(0.2, 0.05 + total * 0.01);
            gfx.circle(0, 0, ringR + 4).fill({ color: hex(colors.accent.light), alpha: glowAlpha });
          }
        }
      }

      // Main shape
      const color = getNodeColor(node);
      let alpha = node.visited ? 0.9 : 0.3;
      if (isDimmed) alpha *= 0.15;
      if (isConnected) alpha = Math.max(alpha, 0.8);
      if (isHovered) alpha = 1;
      if (isFocused) alpha = 1;
      if (hasIndicator) alpha = Math.max(alpha, 0.95);

      const drawR = isHovered ? r * 1.2 : r;

      if (isGroup && node.isExpanded) {
        gfx.circle(0, 0, drawR).fill({ color, alpha: alpha * 0.15 });
        gfx.circle(0, 0, drawR).stroke({ width: 2, color, alpha: alpha * 0.6 });
      } else if (isGroup) {
        gfx.circle(0, 0, drawR).fill({ color, alpha: alpha * 0.5 });
        gfx.circle(0, 0, drawR).stroke({ width: 1.5, color, alpha: alpha * 0.8 });
      } else {
        gfx.circle(0, 0, drawR).fill({ color, alpha });
      }

      // File indicator badge — small colored dot with letter at top-right of node
      if (hasIndicator && indicator) {
        const indColor = INDICATOR_COLORS[indicator.kind] ?? 0xffffff;
        const indAlpha = Math.max(0.3, 1 - (now - indicator.timestamp) / 4000);
        const badgeX = drawR * 0.7;
        const badgeY = -drawR * 0.7;
        const badgeR = 5;

        // Badge background
        gfx.circle(badgeX, badgeY, badgeR + 2).fill({ color: hex(colors.bg.primary), alpha: 0.8 });
        gfx.circle(badgeX, badgeY, badgeR).fill({ color: indColor, alpha: indAlpha });

        // Indicator ring on the node itself
        gfx.circle(0, 0, drawR + 2).stroke({ width: 1.5, color: indColor, alpha: indAlpha * 0.6 });

        // Diff annotation for edits: +N/-N text below node
        if (indicator.kind === 'edit' && (indicator.additions || indicator.deletions)) {
          let diffLabel = this.diffLabels.get(node.id);
          if (!diffLabel) {
            diffLabel = new Text({
              text: '',
              style: new TextStyle({
                fontFamily: 'Courier New, monospace',
                fontSize: 7,
                fill: hex(colors.text.primary),
              }),
            });
            diffLabel.anchor.set(0.5, 0);
            this.world.addChild(diffLabel);
            this.diffLabels.set(node.id, diffLabel);
          }
          diffLabel.text = `+${indicator.additions ?? 0}/-${indicator.deletions ?? 0}`;
          diffLabel.position.set(node.x, node.y + drawR + 4);
          diffLabel.alpha = indAlpha * 0.9;
          diffLabel.visible = true;
        }
      } else {
        // Hide diff label if no indicator
        const diffLabel = this.diffLabels.get(node.id);
        if (diffLabel) diffLabel.visible = false;
      }

      gfx.position.set(node.x, node.y);

      // Update label position for group nodes
      const lbl = this.labelGfx.get(node.id);
      if (lbl) {
        lbl.position.set(node.x, node.y);
        lbl.alpha = isDimmed ? 0.1 : 0.8;
      }
    }

    this.world.scale.set(this.scale);
    this.world.position.set(this.offset.x, this.offset.y);
  }

  private renderSpotlight() {
    // Note: spotlightGfx is cleared by the ticker before calling this
    if (!this._spotlightNodeId) return;

    const node = this.currentNodeById.get(this._spotlightNodeId);
    if (!node) return;

    const r = nodeRadius(node.displaySize ?? node.size, node.isGroupNode, node.childCount);
    const pulse = 0.5 + 0.5 * Math.sin(this.spotlightPhase);
    const outerR = r + 12 + pulse * 8;

    this.spotlightGfx.circle(node.x, node.y, outerR)
      .fill({ color: COLOR_SPOTLIGHT, alpha: 0.06 + pulse * 0.04 });
    this.spotlightGfx.circle(node.x, node.y, r + 8 + pulse * 4)
      .fill({ color: COLOR_SPOTLIGHT, alpha: 0.1 + pulse * 0.05 });

    // Agent dot
    this.spotlightGfx.circle(node.x, node.y - r - 6, 3)
      .fill({ color: COLOR_SPOTLIGHT, alpha: 0.8 + pulse * 0.2 });
    this.spotlightGfx.circle(node.x, node.y - r - 6, 5)
      .fill({ color: COLOR_SPOTLIGHT, alpha: 0.2 + pulse * 0.1 });
  }

  private renderTrail() {
    this.trailGfx.clear();
    if (this._trailNodeIds.length < 2) return;

    // Resolve positions
    const points: { x: number; y: number }[] = [];
    for (const id of this._trailNodeIds) {
      const node = this.currentNodeById.get(id);
      if (node) points.push({ x: node.x, y: node.y });
    }

    // Also add current spotlight node at the end
    if (this._spotlightNodeId) {
      const current = this.currentNodeById.get(this._spotlightNodeId);
      if (current) points.push({ x: current.x, y: current.y });
    }

    if (points.length < 2) return;

    // Draw fading segments from oldest to newest
    for (let i = 0; i < points.length - 1; i++) {
      const alpha = 0.05 + (i / (points.length - 1)) * 0.25;
      const width = 1 + (i / (points.length - 1)) * 1.5;
      this.trailGfx
        .moveTo(points[i].x, points[i].y)
        .lineTo(points[i + 1].x, points[i + 1].y)
        .stroke({ width, color: COLOR_SPOTLIGHT, alpha });
    }
  }

  private renderFailingFiles() {
    // Render red pulsing rings on failing file nodes
    // Called from the spotlight ticker so it pulses together
    if (this._failingFiles.size === 0) return;

    const pulse = 0.5 + 0.5 * Math.sin(this.spotlightPhase * 1.5);

    for (const fileId of this._failingFiles) {
      const node = this.currentNodeById.get(fileId);
      if (!node) continue;
      const r = nodeRadius(node.displaySize ?? node.size, node.isGroupNode, node.childCount);
      this.spotlightGfx
        .circle(node.x, node.y, r + 4)
        .stroke({ width: 2, color: hex(colors.status.errorLight), alpha: 0.6 + pulse * 0.4 });
      this.spotlightGfx
        .circle(node.x, node.y, r + 8)
        .stroke({ width: 1, color: hex(colors.status.errorLight), alpha: 0.2 + pulse * 0.2 });
    }
  }

  hitTest(clientX: number, clientY: number): SimNode | null {
    if (!this.canvas) return null;
    const rect = this.canvas.getBoundingClientRect();
    const wx = (clientX - rect.left - this.offset.x) / this.scale;
    const wy = (clientY - rect.top - this.offset.y) / this.scale;

    let closest: SimNode | null = null;
    let closestDist = Infinity;

    for (const node of this.currentNodes) {
      const r = nodeRadius(node.displaySize ?? node.size, node.isGroupNode, node.childCount, node.isContainerNode);

      if (node.isContainerNode) {
        // Rectangular hit test for containers
        const boxW = r * 2.4;
        const boxH = r * 1.6;
        const dx = Math.abs(node.x - wx);
        const dy = Math.abs(node.y - wy);
        if (dx < boxW / 2 + 4 && dy < boxH / 2 + 4) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < closestDist) {
            closest = node;
            closestDist = dist;
          }
        }
      } else {
        const dx = node.x - wx;
        const dy = node.y - wy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const hitR = r + 4;
        if (dist < hitR && dist < closestDist) {
          closest = node;
          closestDist = dist;
        }
      }
    }
    return closest;
  }

  /** Update activity nodes using pooled graphics (no destroy/recreate) */
  updateActivityNodes(activities: PositionedActivity[]) {
    this.activityData = activities;

    // Grow pool if needed
    while (this.activityPool.length < activities.length) {
      const gfx = new Graphics();
      const lbl = new Text({
        text: '',
        style: new TextStyle({
          fontFamily: 'Courier New, monospace',
          fontSize: 8,
          fill: hex(colors.text.primary),
          letterSpacing: 0.3,
        }),
      });
      lbl.anchor.set(0.5, 0);
      this.activityContainer.addChild(gfx);
      this.activityContainer.addChild(lbl);
      this.activityPool.push({ gfx, lbl });
    }

    // Update active entries
    for (let i = 0; i < this.activityPool.length; i++) {
      const { gfx, lbl } = this.activityPool[i];

      if (i >= activities.length) {
        // Hide unused pool entries
        gfx.clear();
        gfx.visible = false;
        lbl.visible = false;
        continue;
      }

      const a = activities[i];
      const color = ACTIVITY_COLORS[a.kind] ?? 0xffffff;
      const r = 6;
      const alpha = Math.max(0.1, a.heat);

      gfx.clear();
      gfx.visible = true;
      lbl.visible = true;

      // Glow ring
      if (a.heat > 0.2) {
        const glowR = r + 3 + a.heat * 6;
        gfx.circle(0, 0, glowR).fill({ color, alpha: a.heat * 0.15 });
      }

      // Draw shape based on kind
      switch (a.kind) {
        case 'web':
        case 'search':
          gfx.moveTo(0, -r).lineTo(r, 0).lineTo(0, r).lineTo(-r, 0).closePath()
            .fill({ color, alpha });
          break;
        case 'error':
        case 'prompt':
          gfx.moveTo(0, -r).lineTo(r, r * 0.7).lineTo(-r, r * 0.7).closePath()
            .fill({ color, alpha });
          break;
        case 'thinking':
          gfx.circle(0, 0, r * 0.6).fill({ color, alpha: alpha * 0.4 });
          gfx.circle(0, 0, r).stroke({ width: 1.5, color, alpha });
          break;
        default:
          gfx.circle(0, 0, r).fill({ color, alpha });
          break;
      }

      gfx.position.set(a.x, a.y);
      lbl.text = a.label;
      lbl.position.set(a.x, a.y + r + 3);
      lbl.alpha = alpha * 0.8;
    }
  }

  resize(width: number, height: number) {
    this.app.renderer.resize(width, height);
  }

  destroy() {
    for (const { gfx, lbl } of this.activityPool) {
      gfx.destroy();
      lbl.destroy();
    }
    for (const lbl of this.indicatorLabels.values()) lbl.destroy();
    for (const lbl of this.diffLabels.values()) lbl.destroy();
    for (const lbl of this.containerTechLabels.values()) lbl.destroy();
    for (const lbl of this.containerStatLabels.values()) lbl.destroy();
    for (const lbl of this.relationshipLabels.values()) lbl.destroy();
    if (this.spotlightTicker) clearInterval(this.spotlightTicker);
    if (this.focusTimeout) clearTimeout(this.focusTimeout);
    if (this.canvas) {
      this.canvas.removeEventListener('wheel', this.onWheel);
      this.canvas.removeEventListener('pointerdown', this.onPointerDown);
      this.canvas.removeEventListener('pointermove', this.onPointerMove);
      this.canvas.removeEventListener('pointerup', this.onPointerUp);
      this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
      this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    }
    try {
      this.app.destroy(true);
    } catch {
      // Pixi ResizePlugin may crash if WebGL context was already lost
    }
  }

  // --- Event handlers ---

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(5, this.scale * factor));

    const rect = this.canvas!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    this.offset.x = mx - (mx - this.offset.x) * (newScale / this.scale);
    this.offset.y = my - (my - this.offset.y) * (newScale / this.scale);
    this.scale = newScale;
    if (this.onZoomChange) this.onZoomChange(newScale);
  };

  private onPointerDown = (e: PointerEvent) => {
    // Only handle left mouse button (0) — right-click is handled by onContextMenu
    if (e.button !== 0) return;
    const hit = this.hitTest(e.clientX, e.clientY);
    const now = Date.now();

    if (hit && hit.id === this.lastClickNodeId && now - this.lastClickTime < 350) {
      if (hit.isGroupNode) {
        // Groups: expand/collapse on double-click
        if (this.onNodeDoubleClick) {
          this.onNodeDoubleClick(hit);
        }
      }
      this.lastClickTime = 0;
      this.lastClickNodeId = null;
      return;
    }
    this.lastClickTime = now;
    this.lastClickNodeId = hit?.id ?? null;

    this.dragging = true;
    this.dragMoved = false;
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
    this.dragStart = { x: e.clientX - this.offset.x, y: e.clientY - this.offset.y };
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.dragging) {
      // Require at least 5px of movement before treating as a drag
      // This prevents micro-movements during clicks from suppressing click logic
      if (!this.dragMoved) {
        const dx = e.clientX - this.pointerDownPos.x;
        const dy = e.clientY - this.pointerDownPos.y;
        if (dx * dx + dy * dy < 25) return;
      }
      this.dragMoved = true;
      this.offset.x = e.clientX - this.dragStart.x;
      this.offset.y = e.clientY - this.dragStart.y;
      return;
    }

    const hit = this.hitTest(e.clientX, e.clientY);
    const newId = hit?.id ?? null;

    if (newId !== this.hoveredNodeId) {
      this.hoveredNodeId = newId;
      this.connectedNodeIds.clear();

      if (newId) {
        const neighbors = this.adjacency.get(newId);
        if (neighbors) {
          for (const n of neighbors) this.connectedNodeIds.add(n);
        }
      }

      if (this.tooltip) {
        if (hit) {
          const rect = this.canvas!.getBoundingClientRect();
          const groupPath = hit.id.replace('__group__', '');
          const indicator = this._fileIndicators.get(hit.id);
          const indicatorInfo = indicator ? ` [${indicator.kind}]` : '';
          const label = hit.isGroupNode
            ? hit.isExpanded
              ? `${groupPath}/ (${hit.childCount} files) — double-click to collapse`
              : `${groupPath}/ (${hit.childCount} files) — double-click to expand`
            : `${hit.id}${indicatorInfo} — double-click to analyze`;
          this.tooltip.text = label;
          this.tooltip.position.set(e.clientX - rect.left + 12, e.clientY - rect.top - 8);
          this.tooltip.visible = true;
        } else {
          this.tooltip.visible = false;
        }
      }

      this.render();
    } else if (hit && this.tooltip) {
      const rect = this.canvas!.getBoundingClientRect();
      this.tooltip.position.set(e.clientX - rect.left + 12, e.clientY - rect.top - 8);
    }

    this.canvas!.style.cursor = hit ? 'pointer' : 'grab';
  };

  private onPointerUp = (e: PointerEvent) => {
    // Only handle left mouse button (0) — right-click is handled by onContextMenu
    if (e.button !== 0) return;
    const wasDragging = this.dragging && this.dragMoved;
    this.dragging = false;
    this.dragMoved = false;

    if (!wasDragging) {
      const hit = this.hitTest(e.clientX, e.clientY);
      if (hit && this.onNodeClick) {
        const rect = this.canvas?.getBoundingClientRect();
        const sx = rect ? e.clientX - rect.left : e.clientX;
        const sy = rect ? e.clientY - rect.top : e.clientY;
        this.onNodeClick(hit, e.shiftKey, sx, sy);
      } else if (!hit && this.onBackgroundClick) {
        this.onBackgroundClick();
      }
    }
  };

  private onPointerLeave = () => {
    this.dragging = false;
    this.dragMoved = false;
    if (this.hoveredNodeId) {
      this.hoveredNodeId = null;
      this.connectedNodeIds.clear();
      if (this.tooltip) this.tooltip.visible = false;
      this.render();
    }
  };

  private onContextMenu = (e: MouseEvent) => {
    // Always prevent the browser context menu on the map canvas
    e.preventDefault();
    // Reset pointer state — right-click can leave drag state inconsistent
    this.dragging = false;
    this.dragMoved = false;
    const hit = this.hitTest(e.clientX, e.clientY);
    if (hit && this.onNodeRightClick) {
      const rect = this.canvas!.getBoundingClientRect();
      this.onNodeRightClick(hit, e.clientX - rect.left, e.clientY - rect.top);
    }
  };
}
