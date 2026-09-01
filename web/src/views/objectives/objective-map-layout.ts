import type { IndicatorMapResult, Objective } from '@/types/api.types';

export const OBJECTIVE_MAP_CARD_WIDTH = 292;
export const OBJECTIVE_MAP_CARD_HEIGHT = 88;

const HORIZONTAL_GAP = 52;
const VERTICAL_GAP = 72;
const CANVAS_PADDING = 120;

export type ObjectiveMapScope = 'mine' | 'team' | 'organization' | 'other';

export interface ObjectiveMapActorContext {
  userId: string;
  teamOwnerIds: readonly string[];
  managedDeptIds: readonly string[];
}

export interface ObjectiveMapVisibility {
  showCompany: boolean;
  showDepartment: boolean;
}

export interface ObjectiveMapPositionedNode {
  objective: Objective;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ObjectiveMapEdge {
  id: string;
  parentId: string;
  childId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface ObjectiveMapLayout {
  nodes: ObjectiveMapPositionedNode[];
  edges: ObjectiveMapEdge[];
  width: number;
  height: number;
}

const levelOrder: Record<Objective['level'], number> = {
  company: 0,
  department: 1,
  individual: 2,
};

export function flattenObjectives(roots: readonly Objective[]): Objective[] {
  const flattened: Objective[] = [];
  const seen = new Set<string>();

  const visit = (nodes: readonly Objective[]) => {
    for (const node of nodes) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      const { children, ...plainNode } = node;
      flattened.push(plainNode as Objective);
      if (children?.length) visit(children);
    }
  };

  visit(roots);
  return flattened;
}

function buildChildrenByParent(nodes: readonly Objective[]): Map<string, Objective[]> {
  const childrenByParent = new Map<string, Objective[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }
  return childrenByParent;
}

function collectDescendantIds(
  rootId: string,
  childrenByParent: ReadonlyMap<string, readonly Objective[]>,
  target: Set<string>,
) {
  for (const child of childrenByParent.get(rootId) ?? []) {
    if (target.has(child.id)) continue;
    target.add(child.id);
    collectDescendantIds(child.id, childrenByParent, target);
  }
}

function businessIdsByScope(
  nodes: readonly Objective[],
  scope: ObjectiveMapScope,
  actor: ObjectiveMapActorContext,
): Set<string> {
  const teamOwnerIds = new Set(actor.teamOwnerIds);
  const managedDeptIds = new Set(actor.managedDeptIds);
  const mine = new Set(
    nodes
      .filter((node) => node.level === 'individual' && node.ownerId === actor.userId)
      .map((node) => node.id),
  );
  const team = new Set(
    nodes
      .filter((node) => (
        node.level === 'individual'
        && !!node.ownerId
        && (
          teamOwnerIds.has(node.ownerId)
          || (node.ownerReportingDepth != null && node.ownerReportingDepth > 0)
        )
      ))
      .map((node) => node.id),
  );
  const organization = new Set<string>();
  const childrenByParent = buildChildrenByParent(nodes);

  for (const node of nodes) {
    if (
      node.level === 'department'
      && (node.ownerId === actor.userId || (!!node.deptId && managedDeptIds.has(node.deptId)))
    ) {
      organization.add(node.id);
      collectDescendantIds(node.id, childrenByParent, organization);
    }
  }

  if (scope === 'mine') return mine;
  if (scope === 'team') return team;
  if (scope === 'organization') return organization;

  const claimed = new Set([...mine, ...team, ...organization]);
  return new Set(nodes.filter((node) => !claimed.has(node.id)).map((node) => node.id));
}

function descendantCount(
  nodeId: string,
  childrenByParent: ReadonlyMap<string, readonly Objective[]>,
  memo: Map<string, number>,
): number {
  const cached = memo.get(nodeId);
  if (cached != null) return cached;
  const count = (childrenByParent.get(nodeId) ?? []).reduce(
    (sum, child) => sum + 1 + descendantCount(child.id, childrenByParent, memo),
    0,
  );
  memo.set(nodeId, count);
  return count;
}

function stableObjectiveSort(nodes: readonly Objective[]): Objective[] {
  const childrenByParent = buildChildrenByParent(nodes);
  const descendantMemo = new Map<string, number>();
  return [...nodes].sort((left, right) => (
    levelOrder[left.level] - levelOrder[right.level]
    || descendantCount(right.id, childrenByParent, descendantMemo)
      - descendantCount(left.id, childrenByParent, descendantMemo)
    || right.priority - left.priority
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id)
  ));
}

export function selectObjectiveScope(
  roots: readonly Objective[],
  scope: ObjectiveMapScope,
  actor: ObjectiveMapActorContext,
): Objective[] {
  const nodes = flattenObjectives(roots);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const selectedIds = businessIdsByScope(nodes, scope, actor);

  for (const selectedId of [...selectedIds]) {
    let parentId = byId.get(selectedId)?.parentId ?? null;
    const visited = new Set<string>();
    while (parentId && byId.has(parentId) && !visited.has(parentId)) {
      visited.add(parentId);
      selectedIds.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }

  return stableObjectiveSort(nodes.filter((node) => selectedIds.has(node.id)));
}

export function filterObjectivesAwaitingReview(
  roots: readonly Objective[],
): Objective[] {
  const nodes = flattenObjectives(roots);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const selectedIds = new Set(
    nodes
      .filter((node) => node.reviewStatus === 'pending' && node.canReview)
      .map((node) => node.id),
  );

  for (const selectedId of [...selectedIds]) {
    let parentId = byId.get(selectedId)?.parentId ?? null;
    const visited = new Set<string>();
    while (parentId && byId.has(parentId) && !visited.has(parentId)) {
      visited.add(parentId);
      selectedIds.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }

  return stableObjectiveSort(nodes.filter((node) => selectedIds.has(node.id)));
}

export function countObjectivesByScope(
  roots: readonly Objective[],
  actor: ObjectiveMapActorContext,
): Record<ObjectiveMapScope, number> {
  const nodes = flattenObjectives(roots);
  return {
    mine: businessIdsByScope(nodes, 'mine', actor).size,
    team: businessIdsByScope(nodes, 'team', actor).size,
    organization: businessIdsByScope(nodes, 'organization', actor).size,
    other: businessIdsByScope(nodes, 'other', actor).size,
  };
}

export function layoutObjectives(
  objectives: readonly Objective[],
  visibility: ObjectiveMapVisibility,
): ObjectiveMapLayout {
  const visible = stableObjectiveSort(flattenObjectives(objectives)).filter((node) => (
    (node.level !== 'company' || visibility.showCompany)
    && (node.level !== 'department' || visibility.showDepartment)
  ));

  if (visible.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const byId = new Map(visible.map((node) => [node.id, node]));
  const childrenByParent = buildChildrenByParent(visible);
  const descendantMemo = new Map<string, number>();
  const compare = (left: Objective, right: Objective) => (
    descendantCount(right.id, childrenByParent, descendantMemo)
      - descendantCount(left.id, childrenByParent, descendantMemo)
    || right.priority - left.priority
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id)
  );

  for (const children of childrenByParent.values()) children.sort(compare);
  const roots = visible
    .filter((node) => !node.parentId || !byId.has(node.parentId))
    .sort(compare);
  const subtreeWidth = new Map<string, number>();

  const measure = (nodeId: string): number => {
    const cached = subtreeWidth.get(nodeId);
    if (cached != null) return cached;
    const children = childrenByParent.get(nodeId) ?? [];
    const childrenWidth = children.length === 0
      ? 0
      : children.reduce((sum, child) => sum + measure(child.id), 0)
        + HORIZONTAL_GAP * (children.length - 1);
    const width = Math.max(OBJECTIVE_MAP_CARD_WIDTH, childrenWidth);
    subtreeWidth.set(nodeId, width);
    return width;
  };

  const visibleLevels = [...new Set(visible.map((node) => levelOrder[node.level]))].sort();
  const levelIndex = new Map(visibleLevels.map((level, index) => [level, index]));
  const positions = new Map<string, ObjectiveMapPositionedNode>();

  const place = (node: Objective, startX: number) => {
    const span = measure(node.id);
    const children = childrenByParent.get(node.id) ?? [];
    const childrenWidth = children.length === 0
      ? 0
      : children.reduce((sum, child) => sum + measure(child.id), 0)
        + HORIZONTAL_GAP * (children.length - 1);
    let childX = startX + Math.max(0, (span - childrenWidth) / 2);
    for (const child of children) {
      place(child, childX);
      childX += measure(child.id) + HORIZONTAL_GAP;
    }

    positions.set(node.id, {
      objective: node,
      x: startX + (span - OBJECTIVE_MAP_CARD_WIDTH) / 2,
      y: CANVAS_PADDING
        + (levelIndex.get(levelOrder[node.level]) ?? 0)
          * (OBJECTIVE_MAP_CARD_HEIGHT + VERTICAL_GAP),
      width: OBJECTIVE_MAP_CARD_WIDTH,
      height: OBJECTIVE_MAP_CARD_HEIGHT,
    });
  };

  let nextRootX = CANVAS_PADDING;
  for (const root of roots) {
    place(root, nextRootX);
    nextRootX += measure(root.id) + HORIZONTAL_GAP;
  }

  const nodes = visible.map((node) => positions.get(node.id)!).filter(Boolean);
  const edges: ObjectiveMapEdge[] = [];
  for (const node of visible) {
    if (!node.parentId) continue;
    const parent = positions.get(node.parentId);
    const child = positions.get(node.id);
    if (!parent || !child) continue;
    edges.push({
      id: `${node.parentId}->${node.id}`,
      parentId: node.parentId,
      childId: node.id,
      fromX: parent.x + parent.width / 2,
      fromY: parent.y + parent.height,
      toX: child.x + child.width / 2,
      toY: child.y,
    });
  }

  const maxRight = Math.max(...nodes.map((node) => node.x + node.width));
  const maxBottom = Math.max(...nodes.map((node) => node.y + node.height));
  return {
    nodes,
    edges,
    width: maxRight + CANVAS_PADDING,
    height: maxBottom + CANVAS_PADDING,
  };
}

export function layoutIndicatorMap(map: IndicatorMapResult): ObjectiveMapLayout {
  if (map.nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };
  const byId = new Map(map.nodes.map((node) => [node.id, node]));
  const depth = new Map(map.nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < map.nodes.length; pass += 1) {
    let changed = false;
    for (const edge of map.edges) {
      if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
      const nextDepth = (depth.get(edge.source) ?? 0) + 1;
      if (nextDepth > (depth.get(edge.target) ?? 0)) {
        depth.set(edge.target, nextDepth);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const levels = new Map<number, typeof map.nodes>();
  for (const node of map.nodes) {
    const level = Math.min(map.nodes.length - 1, depth.get(node.id) ?? 0);
    const nodes = levels.get(level) ?? [];
    nodes.push(node);
    levels.set(level, nodes);
  }
  for (const nodes of levels.values()) {
    nodes.sort((left, right) => (
      left.owner.name.localeCompare(right.owner.name, 'zh-CN')
      || left.sortOrder - right.sortOrder
      || left.id.localeCompare(right.id)
    ));
  }
  const positions = new Map<string, ObjectiveMapPositionedNode>();
  const levelEntries = [...levels.entries()].sort(([left], [right]) => left - right);
  const maxColumns = Math.max(...levelEntries.map(([, nodes]) => nodes.length));
  for (const [level, nodes] of levelEntries) {
    const rowWidth = nodes.length * OBJECTIVE_MAP_CARD_WIDTH + Math.max(0, nodes.length - 1) * HORIZONTAL_GAP;
    const fullWidth = maxColumns * OBJECTIVE_MAP_CARD_WIDTH + Math.max(0, maxColumns - 1) * HORIZONTAL_GAP;
    const startX = CANVAS_PADDING + Math.max(0, (fullWidth - rowWidth) / 2);
    nodes.forEach((node, index) => {
      const objective: Objective = {
        id: node.id,
        title: node.name,
        description: node.description,
        level: 'individual',
        deptId: node.owner.deptId,
        deptName: node.owner.deptName,
        ownerId: node.owner.id,
        ownerName: node.owner.name,
        parentId: map.edges.find((edge) => edge.target === node.id)?.source ?? null,
        cycleId: map.cycle.id,
        cycleName: map.cycle.name,
        weight: node.weight,
        priority: -node.sortOrder,
        progress: node.progress,
        status: 'active',
        reviewStatus: 'not_required',
        reviewerId: null,
        reviewerName: null,
        reviewedById: null,
        reviewedByName: null,
        reviewedAt: null,
        reviewComment: null,
        canReview: false,
        ownerReportingDepth: null,
        relatedIndicatorId: node.id,
        relatedIndicatorName: node.name,
        createdBy: null,
        creatorName: null,
        createdAt: map.cycle.startDate,
        updatedAt: map.cycle.startDate,
      };
      positions.set(node.id, {
        objective,
        x: startX + index * (OBJECTIVE_MAP_CARD_WIDTH + HORIZONTAL_GAP),
        y: CANVAS_PADDING + level * (OBJECTIVE_MAP_CARD_HEIGHT + VERTICAL_GAP),
        width: OBJECTIVE_MAP_CARD_WIDTH,
        height: OBJECTIVE_MAP_CARD_HEIGHT,
      });
    });
  }
  const edges = map.edges.flatMap((edge) => {
    const parent = positions.get(edge.source);
    const child = positions.get(edge.target);
    if (!parent || !child) return [];
    return [{
      id: edge.id,
      parentId: edge.source,
      childId: edge.target,
      fromX: parent.x + parent.width / 2,
      fromY: parent.y + parent.height,
      toX: child.x + child.width / 2,
      toY: child.y,
    }];
  });
  const nodes = map.nodes.map((node) => positions.get(node.id)!).filter(Boolean);
  return {
    nodes,
    edges,
    width: Math.max(...nodes.map((node) => node.x + node.width)) + CANVAS_PADDING,
    height: Math.max(...nodes.map((node) => node.y + node.height)) + CANVAS_PADDING,
  };
}
