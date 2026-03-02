import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import type { FileNode, DependencyEdge, ArchitectureLayer } from '@hudai/shared';
import type { SemanticZoomTier } from '../../stores/graph-store.js';

export interface SimNode extends FileNode, SimulationNodeDatum {
  x: number;
  y: number;
  vx: number;
  vy: number;
  isGroupNode?: boolean;
  isContainerNode?: boolean; // C4-style architectural container
  containerTech?: string;    // technology badge text
  isExpanded?: boolean;      // group node that is currently expanded (shows children)
  childCount?: number;
  parentGroupId?: string;    // id of the mother group node this child belongs to
  containerId?: string;      // which container this group/file belongs to
  connectivity?: number;
  displaySize?: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: SimNode;
  target: SimNode;
}

export function nodeRadius(displaySize: number, isGroup?: boolean, childCount?: number, isContainer?: boolean): number {
  if (isContainer && childCount) {
    // Containers are larger: 40-80px depending on file count
    return Math.max(40, Math.min(80, 30 + Math.sqrt(childCount) * 6));
  }
  if (isGroup && childCount) {
    return Math.max(12, Math.min(30, 8 + Math.sqrt(childCount) * 4));
  }
  // displaySize is pre-computed based on the active mode
  return Math.max(4, Math.min(20, displaySize));
}

export function computeDisplaySize(fileSize: number, connectivity: number, mode: 'filesize' | 'connectivity'): number {
  if (mode === 'connectivity') {
    // 0 edges → 4, 1 → 6, 3 → 10, 8 → 14, 15+ → 20
    return 4 + Math.sqrt(connectivity) * 4;
  }
  // filesize: log scale
  return 2 + Math.log2(Math.max(fileSize, 1)) * 1.2;
}

/**
 * Find the deepest expanded ancestor for a file.
 * Returns the group path where this file should collapse into,
 * or null if the file itself should be shown.
 *
 * Logic: Walk down from root. The file is a direct child of its group.
 * At each level, if the group is expanded, we go deeper. If not, the file
 * collapses into that group node.
 *
 * The "mother stays" rule: an expanded group always shows as a node.
 * Its direct children (files + sub-dir groups) orbit around it.
 */
function findCollapseTarget(group: string, expandedGroups: Set<string>): string | null {
  if (group === '.') {
    // Root-level file: always visible (root is always shown)
    return null;
  }

  const parts = group.split('/');

  // Walk down the hierarchy
  let current = '';
  for (let i = 0; i < parts.length; i++) {
    current = i === 0 ? parts[i] : current + '/' + parts[i];
    if (!expandedGroups.has(current)) {
      // This level is collapsed — file folds into it
      return current;
    }
  }

  // All ancestors expanded — file is visible as a direct child of its group
  return null;
}

/**
 * Build display graph with "mother + children" expand model.
 *
 * - Every group that contains files always appears as a group node (mother).
 * - When collapsed: only the mother is shown, children are hidden inside it.
 * - When expanded: mother stays, children appear as separate nodes with
 *   edges connecting them to the mother.
 * - Sub-directories of an expanded group appear as collapsed group nodes
 *   (which can be expanded further).
 */
export function buildDisplayGraph(
  allNodes: FileNode[],
  allEdges: DependencyEdge[],
  expandedGroups: Set<string>,
  sessionFilter?: Set<string>,
  architecture?: ArchitectureLayer | null,
  semanticZoom?: SemanticZoomTier,
): { displayNodes: FileNode[]; displayEdges: DependencyEdge[] } {
  // Session minimap: filter nodes to only those in the session set,
  // and auto-expand all their ancestor groups so they're visible
  let filteredNodes = allNodes;
  let effectiveExpanded = expandedGroups;

  if (sessionFilter && sessionFilter.size > 0) {
    filteredNodes = allNodes.filter((n) => sessionFilter.has(n.id));
    // Auto-expand all ancestor groups of session files
    effectiveExpanded = new Set<string>();
    effectiveExpanded.add('.');
    for (const node of filteredNodes) {
      const parts = node.group.split('/');
      let current = '';
      for (const part of parts) {
        current = current ? current + '/' + part : part;
        effectiveExpanded.add(current);
      }
    }
  }

  // Step 1: Collect all unique groups and figure out which are expanded
  const allGroups = new Set<string>();
  for (const node of filteredNodes) {
    allGroups.add(node.group);
    // Also register all ancestor paths
    const parts = node.group.split('/');
    let current = '';
    for (const part of parts) {
      current = current ? current + '/' + part : part;
      allGroups.add(current);
    }
  }

  // Step 2: For each file, determine where it ends up
  const displayNodes: FileNode[] = [];
  const groupSynthetic = new Map<string, FileNode & { _expanded?: boolean; _parentGroupId?: string }>();
  const nodeIdToDisplayId = new Map<string, string>();
  // Track which files belong to which group node (for child count)
  const groupChildCount = new Map<string, number>();

  // Helper: ensure a group node exists
  function ensureGroupNode(groupPath: string, parentGroupId: string | undefined) {
    if (groupSynthetic.has(groupPath)) return;
    const label = groupPath === '.' ? '/' : groupPath.split('/').pop() || groupPath;
    const parentGroup = groupPath.includes('/')
      ? groupPath.split('/').slice(0, -1).join('/')
      : '.';
    groupSynthetic.set(groupPath, {
      id: `__group__${groupPath}`,
      path: groupPath,
      label,
      group: parentGroup,
      extension: '',
      size: 0,
      heat: 0,
      visited: false,
      modified: false,
      _expanded: effectiveExpanded.has(groupPath),
      _parentGroupId: parentGroupId,
    });
  }

  // Step 3: Determine top-level groups (direct children of root)
  const topLevelGroups = new Set<string>();
  for (const node of filteredNodes) {
    if (node.group === '.') continue;
    const topLevel = node.group.split('/')[0];
    topLevelGroups.add(topLevel);
  }

  // Create top-level group nodes (always visible)
  for (const tl of topLevelGroups) {
    ensureGroupNode(tl, undefined);
  }

  // Handle root-level files (group ".")
  const rootFiles = filteredNodes.filter(n => n.group === '.');
  for (const node of rootFiles) {
    displayNodes.push(node);
    nodeIdToDisplayId.set(node.id, node.id);
  }

  // Step 4: Process each file
  for (const node of filteredNodes) {
    if (node.group === '.') continue; // already handled

    const collapseTarget = findCollapseTarget(node.group, effectiveExpanded);

    if (collapseTarget === null) {
      // File is fully visible — it's a direct child of its (expanded) group
      displayNodes.push(node);
      nodeIdToDisplayId.set(node.id, node.id);

      // Make sure the file's group exists as an expanded mother
      const motherGroupId = `__group__${node.group}`;
      ensureGroupNode(node.group, undefined);
      const motherSynth = groupSynthetic.get(node.group)!;
      motherSynth._expanded = true;
    } else {
      // File collapses into collapseTarget
      nodeIdToDisplayId.set(node.id, `__group__${collapseTarget}`);
      ensureGroupNode(collapseTarget, undefined);

      // Aggregate stats into the collapse target
      const synth = groupSynthetic.get(collapseTarget)!;
      synth.heat = Math.max(synth.heat, node.heat);
      if (node.visited) synth.visited = true;
      if (node.modified) synth.modified = true;
    }

    // Count children for the collapse target or the group itself
    const target = collapseTarget ?? node.group;
    groupChildCount.set(target, (groupChildCount.get(target) ?? 0) + 1);
  }

  // Step 5: For expanded groups, also create sub-directory group nodes
  // If "packages" is expanded, we need collapsed nodes for "packages/server", "packages/client", etc.
  for (const groupPath of effectiveExpanded) {
    // Find all direct sub-directories of this expanded group
    const prefix = groupPath + '/';
    const directSubDirs = new Set<string>();

    for (const g of allGroups) {
      if (g === groupPath) continue;
      if (!g.startsWith(prefix)) continue;
      // Get the direct child: "packages/server/src" under "packages" → "packages/server"
      const rest = g.slice(prefix.length);
      const directChild = prefix + rest.split('/')[0];
      if (directChild !== groupPath) {
        directSubDirs.add(directChild);
      }
    }

    for (const subDir of directSubDirs) {
      if (!groupSynthetic.has(subDir)) {
        ensureGroupNode(subDir, `__group__${groupPath}`);
      } else {
        // Update parent
        groupSynthetic.get(subDir)!._parentGroupId = `__group__${groupPath}`;
      }
      // Count files recursively in this subdir
      if (!groupChildCount.has(subDir)) {
        let count = 0;
        for (const node of filteredNodes) {
          if (node.group === subDir || node.group.startsWith(subDir + '/')) {
            count++;
          }
        }
        groupChildCount.set(subDir, count);
      }
    }
  }

  // Step 6: Set child counts and add group nodes to display
  for (const [groupPath, synth] of groupSynthetic) {
    synth.size = groupChildCount.get(groupPath) ?? 0;
    if (synth.size === 0) {
      // Count files in this group + subgroups
      let count = 0;
      for (const node of filteredNodes) {
        if (node.group === groupPath || node.group.startsWith(groupPath + '/')) {
          count++;
        }
      }
      synth.size = count;
    }
    displayNodes.push(synth);
  }

  // Step 6b: Architecture mode — add container nodes and collapse groups into them at container zoom
  if (architecture && semanticZoom) {
    const containerZoom = semanticZoom === 'container';

    // Build group→container lookup
    const groupToContainer = new Map<string, string>();
    for (const c of architecture.containers) {
      for (const g of c.groups) {
        groupToContainer.set(g, c.id);
      }
    }

    // Assign containerId to all existing display nodes
    for (const n of displayNodes) {
      const nodeGroup = n.id.startsWith('__group__') ? n.id.replace('__group__', '') : n.group;
      const parts = nodeGroup.split('/');
      for (let i = parts.length; i >= 1; i--) {
        const prefix = parts.slice(0, i).join('/');
        if (groupToContainer.has(prefix)) {
          (n as any).containerId = `__container__${groupToContainer.get(prefix)}`;
          break;
        }
      }
    }

    // Create container nodes
    for (const c of architecture.containers) {
      const containerId = `__container__${c.id}`;
      // Aggregate stats from all descendant files
      let maxHeat = 0;
      let totalFiles = 0;
      let anyVisited = false;
      let anyModified = false;
      for (const node of allNodes) {
        const parts = node.group.split('/');
        let belongs = false;
        for (let i = parts.length; i >= 1; i--) {
          if (c.groups.includes(parts.slice(0, i).join('/'))) { belongs = true; break; }
        }
        if (node.group === '.' && c.id === '__root__') belongs = true;
        if (belongs) {
          totalFiles++;
          maxHeat = Math.max(maxHeat, node.heat);
          if (node.visited) anyVisited = true;
          if (node.modified) anyModified = true;
        }
      }

      displayNodes.push({
        id: containerId,
        path: c.id,
        label: c.label,
        group: '.',
        extension: '',
        size: totalFiles,
        heat: maxHeat,
        visited: anyVisited,
        modified: anyModified,
        _isContainerNode: true,
        _containerTech: c.technology,
        _containerColor: c.color,
      } as any);
    }

    // At container zoom tier: remove group+file nodes, only show containers
    if (containerZoom) {
      const containerIds = new Set(architecture.containers.map(c => `__container__${c.id}`));
      const filtered = displayNodes.filter(n => containerIds.has(n.id));
      displayNodes.length = 0;
      displayNodes.push(...filtered);
      nodeIdToDisplayId.clear();
      for (const n of allNodes) {
        // Map all files to their container
        const parts = n.group.split('/');
        for (let i = parts.length; i >= 1; i--) {
          const prefix = parts.slice(0, i).join('/');
          const cid = groupToContainer.get(prefix);
          if (cid) { nodeIdToDisplayId.set(n.id, `__container__${cid}`); break; }
        }
      }
    }

    // At module zoom tier: remove individual file nodes and containers, keep only groups
    if (semanticZoom === 'module') {
      const filtered = displayNodes.filter(n =>
        n.id.startsWith('__group__')
      );
      displayNodes.length = 0;
      displayNodes.push(...filtered);
      // Remap file nodes to their group
      for (const n of allNodes) {
        if (n.group === '.') continue;
        const groupId = `__group__${n.group}`;
        if (displayNodes.some(d => d.id === groupId)) {
          nodeIdToDisplayId.set(n.id, groupId);
        } else {
          // Collapse to nearest ancestor group that exists
          const parts = n.group.split('/');
          for (let i = parts.length - 1; i >= 1; i--) {
            const ancestor = `__group__${parts.slice(0, i).join('/')}`;
            if (displayNodes.some(d => d.id === ancestor)) {
              nodeIdToDisplayId.set(n.id, ancestor);
              break;
            }
          }
        }
      }
    }

    // At file zoom tier: remove container nodes, show only groups + files
    if (semanticZoom === 'file') {
      const filtered = displayNodes.filter(n => !(n as any)._isContainerNode);
      displayNodes.length = 0;
      displayNodes.push(...filtered);
    }
  }

  // Step 7: Build edges
  const displayEdgeSet = new Set<string>();
  const displayEdges: DependencyEdge[] = [];

  // Import edges (remapped)
  for (const edge of allEdges) {
    const s = nodeIdToDisplayId.get(edge.source) ?? edge.source;
    const t = nodeIdToDisplayId.get(edge.target) ?? edge.target;
    if (s === t) continue;
    const key = `${s}|||${t}`;
    if (displayEdgeSet.has(key)) continue;
    displayEdgeSet.add(key);
    displayEdges.push({ source: s, target: t, type: edge.type });
  }

  // Mother → child edges: connect expanded group nodes to their direct children
  for (const [groupPath, synth] of groupSynthetic) {
    if (!synth._expanded) continue;
    const motherId = synth.id;

    // Connect to direct file children
    for (const node of displayNodes) {
      if (node.id.startsWith('__group__')) continue;
      if (node.group === groupPath) {
        const key = `${motherId}|||${node.id}`;
        if (!displayEdgeSet.has(key)) {
          displayEdgeSet.add(key);
          displayEdges.push({ source: motherId, target: node.id, type: 'directory' });
        }
      }
    }

    // Connect to direct sub-directory group children
    for (const [subPath, subSynth] of groupSynthetic) {
      if (subPath === groupPath) continue;
      if (subSynth._parentGroupId === motherId) {
        const key = `${motherId}|||${subSynth.id}`;
        if (!displayEdgeSet.has(key)) {
          displayEdgeSet.add(key);
          displayEdges.push({ source: motherId, target: subSynth.id, type: 'directory' });
        }
      }
    }
  }

  // Top-level groups that aren't children of an expanded group — no parent edge needed

  // Container relationship edges (cross-container imports)
  if (architecture && semanticZoom === 'container') {
    for (const rel of architecture.relationships) {
      const s = `__container__${rel.source}`;
      const t = `__container__${rel.target}`;
      const key = `${s}|||${t}`;
      if (!displayEdgeSet.has(key)) {
        displayEdgeSet.add(key);
        displayEdges.push({ source: s, target: t, type: 'import' });
      }
    }
  }

  return { displayNodes, displayEdges };
}

export function createForceLayout(
  nodes: FileNode[],
  edges: DependencyEdge[],
  width: number,
  height: number,
  onTick: (nodes: SimNode[]) => void,
  sizeMode: 'filesize' | 'connectivity' = 'filesize',
  previousPositions?: Map<string, { x: number; y: number }>,
): { sim: Simulation<SimNode, SimLink>; simNodes: SimNode[]; nodeById: Map<string, SimNode> } {
  // Compute connectivity per node
  const connectivityMap = new Map<string, number>();
  for (const e of edges) {
    connectivityMap.set(e.source, (connectivityMap.get(e.source) ?? 0) + 1);
    connectivityMap.set(e.target, (connectivityMap.get(e.target) ?? 0) + 1);
  }

  // Distribute groups in a circle
  const groups = [...new Set(nodes.map((n) => n.group))];
  const groupCenters = new Map<string, { x: number; y: number }>();
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.3;

  groups.forEach((g, i) => {
    const angle = (2 * Math.PI * i) / Math.max(groups.length, 1);
    groupCenters.set(g, {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  });

  const simNodes: SimNode[] = nodes.map((n) => {
    const isGroup = n.id.startsWith('__group__');
    const isContainer = !!(n as any)._isContainerNode;
    const conn = connectivityMap.get(n.id) ?? 0;
    const extra = n as any;
    // Reuse previous position if available for stability
    const prev = previousPositions?.get(n.id);
    const baseX = prev?.x ?? (groupCenters.get(n.group)?.x ?? cx) + (Math.random() - 0.5) * 60;
    const baseY = prev?.y ?? (groupCenters.get(n.group)?.y ?? cy) + (Math.random() - 0.5) * 60;
    return {
      ...n,
      x: baseX,
      y: baseY,
      vx: 0,
      vy: 0,
      isGroupNode: isGroup,
      isContainerNode: isContainer,
      containerTech: extra._containerTech,
      isExpanded: extra._expanded ?? false,
      childCount: (isGroup || isContainer) ? n.size : undefined,
      parentGroupId: extra._parentGroupId,
      containerId: extra.containerId,
      connectivity: conn,
      displaySize: isContainer ? n.size : isGroup ? n.size : computeDisplaySize(n.size, conn, sizeMode),
    };
  });

  const nodeById = new Map(simNodes.map((n) => [n.id, n]));

  // Build link objects
  const links: SimLink[] = [];
  for (const e of edges) {
    const s = nodeById.get(e.source);
    const t = nodeById.get(e.target);
    if (s && t) links.push({ source: s, target: t });
  }

  // Build parent position map: children pull toward their mother node
  const parentPositions = new Map<string, SimNode>();
  for (const n of simNodes) {
    if (n.isGroupNode) parentPositions.set(n.id, n);
  }

  const sim = forceSimulation<SimNode>(simNodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance((l) => {
          const s = l.source as SimNode;
          const t = l.target as SimNode;
          // Container-to-container: large distance
          if (s.isContainerNode || t.isContainerNode) return 200;
          // Mother-child links: shorter distance
          if (s.isGroupNode || t.isGroupNode) return 50;
          return 80;
        })
        .strength(0.4),
    )
    .force('charge', forceManyBody<SimNode>().strength(-40))
    .force(
      'collide',
      forceCollide<SimNode>().radius((n) => nodeRadius(n.displaySize ?? n.size, n.isGroupNode, n.childCount, n.isContainerNode) + 4),
    )
    .force(
      'x',
      forceX<SimNode>()
        .x((n) => {
          // Children pull toward their parent group node's cluster center
          if (n.parentGroupId) {
            const parent = parentPositions.get(n.parentGroupId);
            if (parent) return groupCenters.get(parent.group)?.x ?? cx;
          }
          return groupCenters.get(n.group)?.x ?? cx;
        })
        .strength(0.08),
    )
    .force(
      'y',
      forceY<SimNode>()
        .y((n) => {
          if (n.parentGroupId) {
            const parent = parentPositions.get(n.parentGroupId);
            if (parent) return groupCenters.get(parent.group)?.y ?? cy;
          }
          return groupCenters.get(n.group)?.y ?? cy;
        })
        .strength(0.08),
    )
    .on('tick', () => onTick(simNodes));

  return { sim, simNodes, nodeById };
}
