import { useEffect, useRef, useMemo, useCallback, type RefObject } from 'react';
import { useGraphStore, type ActivityNode } from '../../stores/graph-store.js';
import { useSessionStore } from '../../stores/session-store.js';
import { wsClient } from '../../ws/ws-client.js';
import { MapRenderer } from './MapRenderer.js';
import { createForceLayout, buildDisplayGraph, type SimNode } from './ForceLayout.js';
import type { Simulation, SimulationLinkDatum } from 'd3-force';
import type { FileNode } from '@hudai/shared';

/** Resolve a file path to the deepest visible node on the map (file or group). */
function resolveToVisibleNode(
  filePath: string,
  allNodes: FileNode[],
  nodeById: Map<string, SimNode>,
): string | null {
  const fileNode = allNodes.find((n) => n.id === filePath);
  if (!fileNode) return null;
  const parts = fileNode.group.split('/');
  let current = '';
  let visibleGroupId: string | null = null;
  for (let i = 0; i < parts.length; i++) {
    current = i === 0 ? parts[i] : current + '/' + parts[i];
    const groupNodeId = `__group__${current}`;
    if (nodeById.has(groupNodeId)) {
      visibleGroupId = groupNodeId;
    }
  }
  return visibleGroupId;
}

export function useForceGraph(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  containerRef: RefObject<HTMLDivElement | null>,
  onScopeChange?: (nodeIds: string[]) => void,
  onNodeRightClick?: (nodeId: string, isGroup: boolean, screenX: number, screenY: number) => void,
  onNodeClick?: (nodeId: string, isGroup: boolean, screenX: number, screenY: number) => void,
  onBackgroundClick?: () => void,
) {
  const graph = useGraphStore((s) => s.graph);
  const expandedGroups = useGraphStore((s) => s.expandedGroups);
  const nodeSizeMode = useGraphStore((s) => s.nodeSizeMode);
  const mapMode = useGraphStore((s) => s.mapMode);
  const sessionTouchedFiles = useGraphStore((s) => s.sessionTouchedFiles);
  const heatTick = useGraphStore((s) => s.heatTick);
  const toggleGroup = useGraphStore((s) => s.toggleGroup);
  const architecture = useGraphStore((s) => s.architecture);
  const semanticZoom = useGraphStore((s) => s.semanticZoom);
  const setZoomLevel = useGraphStore((s) => s.setZoomLevel);
  const agentCurrentFile = useSessionStore((s) => s.session.agentCurrentFile);
  const rendererRef = useRef<MapRenderer | null>(null);
  const simRef = useRef<{
    sim: Simulation<SimNode, SimulationLinkDatum<SimNode>>;
    simNodes: SimNode[];
    nodeById: Map<string, SimNode>;
  } | null>(null);
  // Cache node positions across layout rebuilds for stability
  const positionCacheRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Track structural identity of the graph (node count + edge count)
  // Only rebuild force layout when structure actually changes
  const sessionFilterKey = mapMode === 'session' ? sessionTouchedFiles.size : 0;
  const isArchMode = mapMode === 'architecture';
  const archContainerCount = architecture?.containers.length ?? 0;
  const structureKey = useMemo(() => {
    if (!graph) return '';
    return `${graph.nodes.length}:${graph.edges.length}:${expandedGroups.size}:${[...expandedGroups].join(',')}:${nodeSizeMode}:${mapMode}:${sessionFilterKey}:${isArchMode ? semanticZoom : ''}:${archContainerCount}`;
  }, [graph, expandedGroups, nodeSizeMode, mapMode, sessionFilterKey, isArchMode, semanticZoom, archContainerCount]);

  // Compute display graph — only recalculates on structural changes
  const displayGraph = useMemo(() => {
    if (!graph) return null;
    const sessionFilter = mapMode === 'session' ? sessionTouchedFiles : undefined;
    return buildDisplayGraph(
      graph.nodes,
      graph.edges,
      expandedGroups,
      sessionFilter,
      isArchMode ? architecture : null,
      isArchMode ? semanticZoom : undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey]);

  // Init renderer once
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const renderer = new MapRenderer();
    const { width, height } = containerRef.current.getBoundingClientRect();
    renderer.init(canvasRef.current, width, height);
    rendererRef.current = renderer;

    // Handle double-click: only group nodes expand/collapse
    renderer.onNodeDoubleClick = (node: SimNode) => {
      if (node.isGroupNode) {
        const group = node.id.replace('__group__', '');
        toggleGroup(group);
      }
    };

    // Zoom tracking — feed zoom level back to store for semantic zoom tier
    renderer.setOnZoomChange((zoom: number) => {
      const { mapMode: currentMode } = useGraphStore.getState();
      if (currentMode === 'architecture') {
        setZoomLevel(zoom);
      }
    });

    // Handle right-click: open analyze chat box for any node
    renderer.onNodeRightClick = (node, screenX, screenY) => {
      if (onNodeRightClick) {
        onNodeRightClick(node.id, !!node.isGroupNode, screenX, screenY);
      }
    };

    // Handle background click: dismiss overlays
    renderer.onBackgroundClick = () => {
      if (onBackgroundClick) onBackgroundClick();
    };

    // Handle single click: visual highlight or scope selection
    // Single click = open info panel (no agent command)
    // Shift+click = add to scope selection
    renderer.onNodeClick = (node: SimNode, shiftKey: boolean, screenX?: number, screenY?: number) => {
      if (shiftKey) {
        if (!node.isGroupNode) {
          renderer.toggleScopeNode(node.id);
          const scopeIds = Array.from(renderer.scopeNodeIds);
          if (onScopeChange) onScopeChange(scopeIds);
        }
      } else {
        renderer.showFocusRing(node.id);
        if (onNodeClick && screenX !== undefined && screenY !== undefined) {
          onNodeClick(node.id, !!node.isGroupNode, screenX, screenY);
        }
      }
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) {
          renderer.resize(w, h);
        }
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  // Rebuild layout ONLY when structure changes (not on heat updates)
  useEffect(() => {
    if (!displayGraph || !rendererRef.current || !containerRef.current) return;

    const renderer = rendererRef.current;
    const { width, height } = containerRef.current.getBoundingClientRect();

    // Snapshot current positions before rebuilding for stability
    if (simRef.current) {
      for (const node of simRef.current.simNodes) {
        if (node.x !== undefined && node.y !== undefined) {
          positionCacheRef.current.set(node.id, { x: node.x, y: node.y });
        }
      }
      simRef.current.sim.stop();
    }

    const { displayNodes, displayEdges } = displayGraph;

    const { sim, simNodes, nodeById } = createForceLayout(
      displayNodes,
      displayEdges,
      width,
      height,
      (nodes) => {
        renderer.updatePositions(nodes, nodeById, displayEdges as any);
      },
      nodeSizeMode,
      positionCacheRef.current,
    );

    renderer.createNodes(simNodes);
    simRef.current = { sim, simNodes, nodeById };

    return () => {
      sim.stop();
    };
  }, [displayGraph]);

  // Sync architecture mode to renderer
  useEffect(() => {
    if (!rendererRef.current) return;
    const renderer = rendererRef.current;
    renderer.setArchitectureMode(isArchMode);
    renderer.setSemanticZoom(semanticZoom);
    if (architecture) {
      renderer.setContainerRelationships(architecture.relationships);
    }
  }, [isArchMode, semanticZoom, architecture]);

  // Sync heat/state updates to sim nodes — runs on heatTick (every 500ms)
  // Does NOT rebuild force layout — just updates visual properties and re-renders
  // Also bubbles indicators + heat to visible group nodes when files are collapsed
  useEffect(() => {
    if (!graph || !simRef.current || !rendererRef.current || !displayGraph) return;

    const { simNodes, nodeById } = simRef.current;
    const fileIndicators = useGraphStore.getState().fileIndicators;

    // Update individual file nodes that are visible on the map
    for (const node of graph.nodes) {
      const simNode = nodeById.get(node.id);
      if (simNode) {
        simNode.heat = node.heat;
        simNode.visited = node.visited;
        simNode.modified = node.modified;
      }
    }

    // Update group nodes: aggregate heat from ALL descendant files (not just direct children)
    for (const simNode of simNodes) {
      if (!simNode.isGroupNode && !simNode.isContainerNode) continue;

      if (simNode.isContainerNode && architecture) {
        // Container: aggregate from all files in container's groups
        const container = architecture.containers.find(c => `__container__${c.id}` === simNode.id);
        if (!container) continue;
        let maxHeat = 0;
        let anyVisited = false;
        let anyModified = false;
        for (const node of graph.nodes) {
          const parts = node.group.split('/');
          let belongs = false;
          for (let i = parts.length; i >= 1; i--) {
            if (container.groups.includes(parts.slice(0, i).join('/'))) { belongs = true; break; }
          }
          if (node.group === '.' && container.id === '__root__') belongs = true;
          if (belongs) {
            maxHeat = Math.max(maxHeat, node.heat);
            if (node.visited) anyVisited = true;
            if (node.modified) anyModified = true;
          }
        }
        simNode.heat = maxHeat;
        simNode.visited = anyVisited;
        simNode.modified = anyModified;
      } else if (simNode.isGroupNode) {
        const group = simNode.id.replace('__group__', '');
        let maxHeat = 0;
        let anyVisited = false;
        let anyModified = false;
        for (const node of graph.nodes) {
          if (node.group === group || node.group.startsWith(group + '/')) {
            maxHeat = Math.max(maxHeat, node.heat);
            if (node.visited) anyVisited = true;
            if (node.modified) anyModified = true;
          }
        }
        simNode.heat = maxHeat;
        simNode.visited = anyVisited;
        simNode.modified = anyModified;
      }
    }

    // Bubble file indicators to visible nodes:
    // If a file has an indicator but isn't visible (collapsed into a group),
    // remap the indicator to the visible ancestor group node
    const visibleIndicators = new Map(fileIndicators);
    for (const [filePath, indicator] of fileIndicators) {
      if (nodeById.has(filePath)) continue; // file node is visible, no remapping needed

      // Find the visible ancestor group node for this file
      const fileNode = graph.nodes.find((n) => n.id === filePath);
      if (!fileNode) continue;

      // Walk up the group hierarchy to find a visible group
      const parts = fileNode.group.split('/');
      let current = '';
      let visibleGroupId: string | null = null;
      for (let i = 0; i < parts.length; i++) {
        current = i === 0 ? parts[i] : current + '/' + parts[i];
        const groupNodeId = `__group__${current}`;
        if (nodeById.has(groupNodeId)) {
          visibleGroupId = groupNodeId; // keep searching deeper — we want the deepest visible one
        }
      }

      if (visibleGroupId) {
        // Only override if this indicator is more recent than existing one on the group
        const existing = visibleIndicators.get(visibleGroupId);
        if (!existing || indicator.timestamp > existing.timestamp) {
          visibleIndicators.set(visibleGroupId, indicator);
        }
        // Remove the original (invisible) entry so renderer doesn't try to find it
        visibleIndicators.delete(filePath);
      }
    }

    rendererRef.current.setFileIndicators(visibleIndicators);

    // Pass cumulative activity counts to renderer for activity rings
    // Bubble counts to visible nodes (same as indicators)
    const activityCounts = useGraphStore.getState().fileActivityCounts;
    const visibleCounts = new Map(activityCounts);
    for (const [filePath, counts] of activityCounts) {
      if (nodeById.has(filePath)) continue;
      const resolved = resolveToVisibleNode(filePath, graph.nodes, nodeById);
      if (resolved) {
        const existing = visibleCounts.get(resolved) ?? { reads: 0, edits: 0, shells: 0, searches: 0 };
        visibleCounts.set(resolved, {
          reads: existing.reads + counts.reads,
          edits: existing.edits + counts.edits,
          shells: existing.shells + counts.shells,
          searches: existing.searches + counts.searches,
        });
        visibleCounts.delete(filePath);
      }
    }
    rendererRef.current.setActivityCounts(visibleCounts);

    rendererRef.current.updatePositions(simNodes, nodeById, displayGraph.displayEdges as any);
  }, [heatTick, graph]);

  // Agent spotlight — track current file, bubble up to visible group/container if collapsed
  useEffect(() => {
    if (!rendererRef.current) return;
    if (!agentCurrentFile || !simRef.current || !graph) {
      rendererRef.current.setSpotlight(agentCurrentFile);
      return;
    }

    const { nodeById } = simRef.current;
    // If the file node is directly visible, use it
    if (nodeById.has(agentCurrentFile)) {
      rendererRef.current.setSpotlight(agentCurrentFile);
      return;
    }

    // Find the visible ancestor group node
    const fileNode = graph.nodes.find((n) => n.id === agentCurrentFile);
    if (fileNode) {
      // First try group resolution
      const resolved = resolveToVisibleNode(agentCurrentFile, graph.nodes, nodeById);
      if (resolved) {
        rendererRef.current.setSpotlight(resolved);
        return;
      }
      // Try container resolution (architecture mode)
      if (architecture) {
        for (const c of architecture.containers) {
          const parts = fileNode.group.split('/');
          for (let i = parts.length; i >= 1; i--) {
            if (c.groups.includes(parts.slice(0, i).join('/'))) {
              const containerId = `__container__${c.id}`;
              if (nodeById.has(containerId)) {
                rendererRef.current.setSpotlight(containerId);
                return;
              }
            }
          }
        }
      }
      rendererRef.current.setSpotlight(null);
    } else {
      rendererRef.current.setSpotlight(agentCurrentFile);
    }
  }, [agentCurrentFile, graph, architecture]);

  // Movement trail — resolve to visible nodes
  const movementTrail = useSessionStore((s) => s.movementTrail);
  useEffect(() => {
    if (!rendererRef.current) return;
    if (!simRef.current || !graph) {
      rendererRef.current.setTrail(movementTrail);
      return;
    }
    const { nodeById } = simRef.current;
    const resolvedTrail = movementTrail
      .map((f) => nodeById.has(f) ? f : resolveToVisibleNode(f, graph.nodes, nodeById))
      .filter((f): f is string => f !== null);
    rendererRef.current.setTrail(resolvedTrail);
  }, [movementTrail, graph]);

  // Failing files — bubble up to visible group nodes when collapsed
  const failingFiles = useGraphStore((s) => s.failingFiles);
  useEffect(() => {
    if (!rendererRef.current) return;
    if (!simRef.current || !graph || failingFiles.size === 0) {
      rendererRef.current.setFailingFiles(failingFiles);
      return;
    }
    const { nodeById } = simRef.current;
    const visibleFailing = new Set<string>();
    for (const filePath of failingFiles) {
      if (nodeById.has(filePath)) {
        visibleFailing.add(filePath);
      } else {
        const resolved = resolveToVisibleNode(filePath, graph.nodes, nodeById);
        if (resolved) visibleFailing.add(resolved);
      }
    }
    rendererRef.current.setFailingFiles(visibleFailing);
  }, [failingFiles, graph]);

  // Sync activity nodes to renderer — stable positioning
  const activityNodes = useGraphStore((s) => s.activityNodes);
  const activityPositions = useRef(new Map<string, { x: number; y: number }>());

  useEffect(() => {
    if (!rendererRef.current || !simRef.current) return;
    const renderer = rendererRef.current;
    const { nodeById } = simRef.current;
    const positions = activityPositions.current;

    const positioned = activityNodes.map((a) => {
      // Reuse existing position if we already placed this activity
      const existing = positions.get(a.id);
      if (existing) {
        return { ...a, x: existing.x, y: existing.y };
      }

      // Compute new position
      let x: number | undefined;
      let y: number | undefined;

      if (a.relatedFile) {
        const fileNode = nodeById.get(a.relatedFile);
        if (fileNode) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 30 + Math.random() * 20;
          x = fileNode.x + Math.cos(angle) * dist;
          y = fileNode.y + Math.sin(angle) * dist;
        }
      }

      if (x === undefined || y === undefined) {
        const cx = (containerRef.current?.clientWidth ?? 600) / 2;
        const cy = (containerRef.current?.clientHeight ?? 400) / 2;
        const spreadR = Math.min(cx, cy) * 0.4;
        const angle = Math.random() * Math.PI * 2;
        x = cx + Math.cos(angle) * spreadR;
        y = cy + Math.sin(angle) * spreadR;
      }

      // Cache the position
      positions.set(a.id, { x, y });
      return { ...a, x, y };
    });

    // Clean up positions for dead activity nodes
    const aliveIds = new Set(activityNodes.map((a) => a.id));
    for (const id of positions.keys()) {
      if (!aliveIds.has(id)) positions.delete(id);
    }

    renderer.updateActivityNodes(positioned);
  }, [activityNodes]);

  // Heat decay interval
  useEffect(() => {
    const { decayHeat } = useGraphStore.getState();
    const interval = setInterval(decayHeat, 500);
    return () => clearInterval(interval);
  }, []);
}
