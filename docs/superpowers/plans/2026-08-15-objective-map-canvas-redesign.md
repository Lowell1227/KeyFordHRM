# Objective Map Canvas Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/objectives` tree table with a reference-matched, pannable and zoomable company-to-department-to-person objective canvas while preserving KeyFord navigation, permissions, CRUD, and target-tracking behavior.

**Architecture:** Keep `ObjectiveMapView.vue` as the page-level data and mutation owner. Add pure TypeScript modules for scope selection, tree layout, and display-setting persistence, then render their output through focused filter, card, settings, and canvas components. Reuse the current objective APIs and permission-filtered data; do not add a backend endpoint or graph dependency.

**Tech Stack:** Vue 3 Composition API, TypeScript 5.6, Element Plus, native SVG/CSS transforms, Playwright.

## Global Constraints

- Keep the KeyFord top bar, blue primary navigation, `PerformanceWorkspace`, `/objectives` route, page title, and “新建目标” action.
- Do not change Prisma, objective APIs, backend authorization, role visibility, target-tracking, or task pages.
- Use only objectives returned by the existing permission-filtered API; never fabricate or fetch hidden ancestors.
- Use the real `parentId` for every company/superior → department → individual connection.
- Use these scope labels exactly: “我的目标”, “我团队成员的目标”, “我负责组织的目标”, “其他目标”.
- Default a manager with direct reports to “我团队成员的目标”; otherwise choose the first non-empty scope.
- Zoom range is exactly 50%–150%; the initial displayed value is 100%.
- Store display settings under `kayford.objectiveMap.display.v1`; invalid values fall back to defaults.
- Do not add Vue Flow or another runtime dependency.
- Acceptance viewports are `1440x900` and `390x844`.
- Every production behavior begins with a failing Playwright test.

## File Map

- Create `web/src/views/objectives/objective-map-layout.ts`: flattening, scope selection, ancestor completion, stable ordering, coordinates, and edges.
- Create `web/src/views/objectives/objective-map-settings.ts`: validated display-setting persistence.
- Create `web/src/views/objectives/components/ObjectiveMapFilters.vue`: cycle and four-scope floating controls.
- Create `web/src/views/objectives/components/ObjectiveMapDisplaySettings.vue`: sort label and display popover.
- Create `web/src/views/objectives/components/ObjectiveMapCard.vue`: accessible objective card and action menu.
- Create `web/src/views/objectives/components/ObjectiveMapCanvas.vue`: SVG edges, card world, pan/zoom/fit, and states.
- Modify `web/src/views/objectives/ObjectiveMapView.vue`: integrate data, controls, canvas, drawer, and current mutations.
- Modify `web/e2e/specs/09-performance-workspace.spec.ts`: model, behavior, role, persistence, and responsive coverage.
- Modify `web/e2e/specs/07-peripheral-actions.spec.ts`: keep objective CRUD acceptance aligned with cards.

---

### Task 1: Objective Scope and Layout Engine

**Files:**
- Create: `web/src/views/objectives/objective-map-layout.ts`
- Modify: `web/e2e/specs/09-performance-workspace.spec.ts`

**Interfaces:**

```ts
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
export function flattenObjectives(roots: readonly Objective[]): Objective[];
export function selectObjectiveScope(
  roots: readonly Objective[], scope: ObjectiveMapScope, actor: ObjectiveMapActorContext,
): Objective[];
export function countObjectivesByScope(
  roots: readonly Objective[], actor: ObjectiveMapActorContext,
): Record<ObjectiveMapScope, number>;
export function layoutObjectives(
  objectives: readonly Objective[], visibility: ObjectiveMapVisibility,
): ObjectiveMapLayout;
```

- [ ] **Step 1: Write failing model tests**

Import the missing module in `09-performance-workspace.spec.ts` and add a typed company → department → two-person fixture. Assert:

```ts
expect(selectObjectiveScope(roots, 'mine', actor).map((item) => item.id).sort())
  .toEqual(['company', 'department', 'mine']);
expect(selectObjectiveScope(roots, 'team', actor).map((item) => item.id).sort())
  .toEqual(['company', 'department', 'teammate']);
expect(countObjectivesByScope(roots, actor).team).toBe(1);

const layout = layoutObjectives([company, department, mine, teammate], {
  showCompany: true,
  showDepartment: true,
});
expect(layout.edges.map((edge) => edge.id).sort()).toEqual([
  'company->department', 'department->mine', 'department->teammate',
]);
const byId = new Map(layout.nodes.map((node) => [node.objective.id, node]));
expect(byId.get('company')!.y).toBeLessThan(byId.get('department')!.y);
expect(byId.get('department')!.y).toBeLessThan(byId.get('mine')!.y);
expect(byId.get('mine')!.x).not.toBe(byId.get('teammate')!.x);

const orphan = { ...teammate, parentId: 'hidden-department' };
expect(layoutObjectives([orphan], { showCompany: true, showDepartment: true }).edges)
  .toEqual([]);
expect(layoutObjectives([company, department, mine], {
  showCompany: false, showDepartment: false,
}).nodes.map((node) => node.objective.id)).toEqual(['mine']);
```

- [ ] **Step 2: Verify RED**

```powershell
cd web
npx playwright test e2e/specs/09-performance-workspace.spec.ts --grep "objective map layout model"
```

Expected: compilation fails because `objective-map-layout.ts` is missing.

- [ ] **Step 3: Implement the pure model**

Use `292×88` cards, `52px` horizontal gap, `72px` vertical gap, and `120px` canvas padding. Implement these exact rules:

1. Flatten `children` recursively and de-duplicate by ID.
2. `mine` selects the actor's individual objectives.
3. `team` selects individual objectives owned by `teamOwnerIds`.
4. `organization` selects department objectives owned by the actor or in `managedDeptIds`, plus their visible descendants.
5. `other` selects visible business nodes not belonging to the previous three scopes.
6. Add only ancestors already present in the returned tree; stop at a missing parent.
7. Sort by level, descending visible descendant count, descending priority, `createdAt`, then ID.
8. Assign leaf slots left-to-right and center each visible parent over its children; give separate roots non-overlapping spans.
9. Remove disabled company/department levels before layout and connect only endpoints that remain.
10. Return finite dimensions based on maximum card bounds plus padding.

- [ ] **Step 4: Verify GREEN**

```powershell
cd web
npx playwright test e2e/specs/09-performance-workspace.spec.ts --grep "objective map layout model|stage semantics"
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- web/src/views/objectives/objective-map-layout.ts web/e2e/specs/09-performance-workspace.spec.ts
git commit -m "feat(web): add objective map layout model"
```

---

### Task 2: Display Settings and Floating Filters

**Files:**
- Create: `web/src/views/objectives/objective-map-settings.ts`
- Create: `web/src/views/objectives/components/ObjectiveMapFilters.vue`
- Create: `web/src/views/objectives/components/ObjectiveMapDisplaySettings.vue`
- Modify: `web/src/views/objectives/ObjectiveMapView.vue`
- Modify: `web/e2e/specs/09-performance-workspace.spec.ts`

**Interfaces:**

```ts
export interface ObjectiveMapDisplayOptions {
  showCompany: boolean;
  showDepartment: boolean;
  showOwner: boolean;
  showProgress: boolean;
  showConnections: boolean;
}
export const OBJECTIVE_MAP_DISPLAY_STORAGE_KEY = 'kayford.objectiveMap.display.v1';
export const DEFAULT_OBJECTIVE_MAP_DISPLAY: Readonly<ObjectiveMapDisplayOptions>;
export function parseObjectiveMapDisplay(raw: string | null): ObjectiveMapDisplayOptions;
export function saveObjectiveMapDisplay(
  value: ObjectiveMapDisplayOptions, storage?: Pick<Storage, 'setItem'>,
): void;
```

`ObjectiveMapFilters.vue` accepts `cycles`, `cycleId`, `scope`, and `scopeCounts`, then emits `update:cycleId` and `update:scope`. `ObjectiveMapDisplaySettings.vue` accepts `modelValue` and emits `update:modelValue`.

- [ ] **Step 1: Write failing tests**

```ts
expect(parseObjectiveMapDisplay(JSON.stringify({
  showCompany: false,
  showDepartment: true,
  showOwner: false,
  showProgress: true,
  showConnections: false,
})).showCompany).toBe(false);
expect(parseObjectiveMapDisplay('{bad json')).toEqual(DEFAULT_OBJECTIVE_MAP_DISPLAY);
expect(parseObjectiveMapDisplay(JSON.stringify({ showCompany: false })))
  .toEqual(DEFAULT_OBJECTIVE_MAP_DISPLAY);
```

Add page assertions for `objective-map-filters`, all four exact scope names, `objective-map-display-settings`, and “排序：按对齐数量”.

- [ ] **Step 2: Verify RED**

```powershell
cd web
npx playwright test e2e/specs/09-performance-workspace.spec.ts --grep "display settings model|floating controls"
```

Expected: missing module and missing controls.

- [ ] **Step 3: Implement settings validation**

`parseObjectiveMapDisplay` must catch invalid JSON, reject arrays/missing keys/non-booleans, and return a new default object. `saveObjectiveMapDisplay` serializes only the five fields and defaults to `window.localStorage` only in a browser.

- [ ] **Step 4: Implement filter and display components**

`ObjectiveMapFilters.vue` renders a calendar icon, “周期：” select, and four native scope buttons with `aria-pressed` and `data-testid="objective-map-scope-${scope}"`. A zero-count inactive scope is disabled. Below 768px the row scrolls horizontally.

`ObjectiveMapDisplaySettings.vue` renders “排序：按对齐数量” and a “显示设置” popover containing checkboxes labeled “显示公司或上级目标”, “显示部门目标”, “显示负责人”, “显示进度”, and “显示连接线”. Emit immutable copies.

- [ ] **Step 5: Integrate the controls into the current surface**

In `ObjectiveMapView.vue`, replace the old level radio group with `ObjectiveMapFilters`, place `ObjectiveMapDisplaySettings` at the right of the existing surface, and add `selectedScope`, `scopeCounts`, and validated `display` refs. At this intermediate checkpoint the current table may remain beneath the controls; do not change its rows yet. Watch display changes and call `saveObjectiveMapDisplay`.

- [ ] **Step 6: Verify GREEN**

```powershell
cd web
npx playwright test e2e/specs/09-performance-workspace.spec.ts --grep "display settings model|floating controls"
npm run type-check
```

Expected: the model test, floating-control test, and type-check pass.

- [ ] **Step 7: Commit**

```powershell
git add -- web/src/views/objectives/objective-map-settings.ts web/src/views/objectives/components/ObjectiveMapFilters.vue web/src/views/objectives/components/ObjectiveMapDisplaySettings.vue web/src/views/objectives/ObjectiveMapView.vue web/e2e/specs/09-performance-workspace.spec.ts
git commit -m "feat(web): add objective map controls"
```

---

### Task 3: Objective Cards and Interactive SVG Canvas

**Files:**
- Create: `web/src/views/objectives/components/ObjectiveMapCard.vue`
- Create: `web/src/views/objectives/components/ObjectiveMapCanvas.vue`
- Modify: `web/src/views/objectives/ObjectiveMapView.vue`
- Modify: `web/e2e/specs/09-performance-workspace.spec.ts`

**Interfaces:**

`ObjectiveMapCard.vue`:

```ts
defineProps<{
  objective: Objective;
  display: ObjectiveMapDisplayOptions;
  canManage: boolean;
}>();
defineEmits<{
  open: [objective: Objective];
  edit: [objective: Objective];
  progress: [objective: Objective];
  track: [objective: Objective];
  remove: [objective: Objective];
}>();
```

`ObjectiveMapCanvas.vue`:

```ts
defineProps<{
  layout: ObjectiveMapLayout;
  display: ObjectiveMapDisplayOptions;
  loading: boolean;
  error: string;
  canManage: boolean;
}>();
// Re-emit open/edit/progress/track/remove, plus retry: [].
defineExpose<{ fitToView: () => void }>();
```

- [ ] **Step 1: Write failing card and canvas tests**

Route a deterministic tree and assert an individual card contains “个人”, “刘伟”, “用户问题支持”, and “30%”; it is focusable; Enter opens `objective-map-detail`; a manager sees “更多操作” with all four actions, while a VP does not. Assert `objective-map-canvas`, two SVG paths in `objective-map-edges`, and `objective-map-zoom-value` at `100%`. Click “放大目标地图” and expect `110%`; click “缩小目标地图” and expect `100%`. Drag the background and assert the `objective-map-world` transform changes. Click “定位全部目标” and assert the company card is in viewport.

- [ ] **Step 2: Verify RED**

```powershell
cd web
npx playwright test e2e/specs/09-performance-workspace.spec.ts --grep "objective card|canvas interaction|read-only leadership"
```

Expected: card, canvas, edges, and controls are absent.

- [ ] **Step 3: Implement the card**

Use an `<article tabindex="0" role="button">` with `data-testid="objective-map-card-${objective.id}"`, Enter/Space handlers, and an aria label containing level/title/progress. Render a Chinese level chip, owner fallback (`ownerName` → `deptName` → “未指定负责人”), department name, clamped title, and warm-yellow progress badge. Use deep blue for company, indigo for department, and cyan for individual while retaining text labels.

Only `canManage` sees the “更多操作” dropdown. Menu items are exactly “编辑目标”, “更新进度”, “目标跟进”, and “删除目标”. Stop propagation from the dropdown. Add hover and `:focus-visible` states and exact `292×88` dimensions.

- [ ] **Step 4: Render the world and SVG edges**

Create a clipped viewport containing one transformed world layer. Render an absolute SVG below absolute `ObjectiveMapCard` elements. Use this path shape:

```ts
function edgePath(edge: ObjectiveMapEdge): string {
  const middleY = edge.fromY + (edge.toY - edge.fromY) / 2;
  return `M ${edge.fromX} ${edge.fromY} V ${middleY} H ${edge.toX} V ${edge.toY}`;
}
```

Hide the SVG when `showConnections` is false and mark it `aria-hidden="true"`.

- [ ] **Step 5: Implement viewport interaction**

Start `scale` at `1`; clamp to `0.5…1.5`; buttons use `0.1` steps. Wheel zoom keeps the world coordinate under the pointer stable and uses a non-passive listener. Background pointer drag uses pointer capture; cards never start a pan. `fitToView` uses `min(1, viewportWidth/layout.width, viewportHeight/layout.height)`, clamps it, and centers the world. Watch layout and fit after `nextTick`; use `ResizeObserver` before manual transforms.

Add bottom-left buttons named “定位全部目标”, “缩小目标地图”, and “放大目标地图”, plus the visible percentage. Loading keeps controls mounted; errors show a Chinese message and “重新加载”; no nodes shows “暂无目标”. Disable transitions under `prefers-reduced-motion`.

- [ ] **Step 6: Integrate the canvas and verify GREEN**

In `ObjectiveMapView.vue`, compute `scopedObjectives` with `selectObjectiveScope` and `canvasLayout` with `layoutObjectives`. Replace the remaining table with `ObjectiveMapCanvas` and keep the floating Task 2 controls above it. Add `selectedObjective`, `detailVisible`, and a minimal read-only `el-drawer data-testid="objective-map-detail"` showing title, owner, and progress; Task 4 expands it to every specified field and action. Wire edit/progress/track/remove to the existing methods.

```powershell
cd web
npx playwright test e2e/specs/09-performance-workspace.spec.ts --grep "objective card|canvas interaction|read-only leadership"
npm run type-check
```

Expected: all selected tests and type-check pass.

- [ ] **Step 7: Commit**

```powershell
git add -- web/src/views/objectives/components/ObjectiveMapCard.vue web/src/views/objectives/components/ObjectiveMapCanvas.vue web/src/views/objectives/ObjectiveMapView.vue web/e2e/specs/09-performance-workspace.spec.ts
git commit -m "feat(web): add interactive objective map canvas"
```

---

### Task 4: Preserve Objective Operations and Add Detail View

**Files:**
- Modify: `web/src/views/objectives/ObjectiveMapView.vue`
- Modify: `web/e2e/specs/09-performance-workspace.spec.ts`
- Modify: `web/e2e/specs/07-peripheral-actions.spec.ts`

**Interfaces:** Consumes Tasks 1–3 and produces the final `/objectives` page behavior.

- [ ] **Step 1: Complete failing integration tests**

Add a route helper for cycles, departments, subordinates, and a company → department → individual objective response. Assert:

- manager default scope is `team`;
- three cards and two edges render;
- changing to “我的目标” removes teammate-only objectives but keeps ancestors;
- card click opens `objective-map-detail` with all current fields;
- manager actions open edit/progress, navigate to target tracking, and retain delete confirmation;
- VP has detail/track but no write actions;
- valid display settings survive reload and malformed settings reset;
- `.el-table` is absent inside `objective-map-surface`.

Update the objective creation assertion in `07-peripheral-actions.spec.ts` to search for the created title inside `objective-map-canvas`.

- [ ] **Step 2: Verify RED**

```powershell
cd web
npx playwright test e2e/specs/09-performance-workspace.spec.ts e2e/specs/07-peripheral-actions.spec.ts --grep "objective map|objective creation"
```

Expected: detail, final scope fallback, mutation refresh, or persistence assertions fail against the intermediate canvas page.

- [ ] **Step 3: Complete the page data state**

Keep existing API loaders and CRUD methods. Complete the state introduced in Task 2 with:

```ts
const selectedCycleId = ref('');
const selectedScope = ref<ObjectiveMapScope>('team');
const loadError = ref('');
const display = ref(parseObjectiveMapDisplay(
  localStorage.getItem(OBJECTIVE_MAP_DISPLAY_STORAGE_KEY),
));
```

Use `objectivesApi.getTree(selectedCycleId || undefined)`, clear stale data on failure, and set a retryable Chinese error. Select the active cycle after loading. Managers load direct reports with `usersApi.getSubordinates`; flatten departments and gather IDs led by the current user. Derive actor context, scope counts, scoped objectives, and `layoutObjectives(scopedObjectives, display)` as computed values. Default to team only when its business count is positive; otherwise choose the first non-empty `mine`, `organization`, `other`, `team`. Deep-watch `display` and persist it.

Guard rapid cycle changes with a monotonically increasing request sequence: capture the sequence before awaiting `getTree`, and update `treeData`, `loadError`, and `loading` only when the response sequence is still current. This prevents stale responses from replacing the latest cycle.

- [ ] **Step 4: Finish the page composition**

Within `objective-map-surface`, ensure `ObjectiveMapFilters` is top-left, `ObjectiveMapDisplaySettings` is top-right, and `ObjectiveMapCanvas` is full-size. Remove the intermediate table, level filter, `EmptyState`, and table-only imports/styles. Expand the Task 3 minimal drawer and keep:

```ts
function openTracking(objective: Objective) {
  router.push({ path: '/action-items', query: { objectiveId: objective.id } });
}
```

- [ ] **Step 5: Add the detail drawer and retain mutations**

Add `selectedObjective` and `detailVisible`. Render `data-testid="objective-map-detail"` with title, description, level, owner, department, cycle, weight, priority, progress, status, and related indicator; use `-` for missing values. Manager actions mirror the card menu; read-only users only see view/track. Close the drawer before edit/progress/delete. Await `loadTree()` after every successful mutation.

- [ ] **Step 6: Verify GREEN**

```powershell
cd web
npx playwright test e2e/specs/09-performance-workspace.spec.ts e2e/specs/07-peripheral-actions.spec.ts --grep "objective map|objective creation|read-only leadership"
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit**

```powershell
git add -- web/src/views/objectives/ObjectiveMapView.vue web/e2e/specs/09-performance-workspace.spec.ts web/e2e/specs/07-peripheral-actions.spec.ts
git commit -m "feat(web): replace objective table with relationship canvas"
```

---

### Task 5: Responsive, Accessibility, and Visual Acceptance

**Files:**
- Modify: `web/src/views/objectives/ObjectiveMapView.vue`
- Modify: `web/src/views/objectives/components/ObjectiveMapFilters.vue`
- Modify: `web/src/views/objectives/components/ObjectiveMapDisplaySettings.vue`
- Modify: `web/src/views/objectives/components/ObjectiveMapCard.vue`
- Modify: `web/src/views/objectives/components/ObjectiveMapCanvas.vue`
- Modify: `web/e2e/specs/09-performance-workspace.spec.ts`

**Interfaces:** No new public API; this task finishes styling and verification.

- [ ] **Step 1: Write failing responsive/accessibility tests**

At `390x844`, assert filters, canvas, locate control, and a personal card are visible; the surface clips horizontal overflow. Add keyboard assertions for scope buttons, card Enter-to-detail, Escape-to-close, visible focus, and `reducedMotion: 'reduce'` producing a `0s` world transition.

- [ ] **Step 2: Verify RED**

```powershell
cd web
npx playwright test e2e/specs/09-performance-workspace.spec.ts --grep "objective map responsive|objective map accessibility"
```

Expected: overflow, focus, or reduced-motion assertions fail before final styling.

- [ ] **Step 3: Finish reference-matched styles**

Desktop: use `#f3f6fc` canvas, filters at `top:16px; left:24px`, display controls at `top:16px; right:24px`, zoom controls at `left:24px; bottom:18px`, white controls with 8px radius and `0 4px 16px rgb(35 55 88 / 10%)`, blue selected scope, white 10px-radius cards with `0 5px 18px rgb(39 55 86 / 9%)`, and `#c9d4e6` 1.5px edges.

Mobile below 768px: filters occupy left/right 10px and scroll without wrapping; display settings move below the filter strip; bottom controls remain inside the surface; canvas min-height is 420px; transformed content is clipped. Add 2px `:focus-visible` outlines and reduced-motion rules.

- [ ] **Step 4: Run complete automated verification**

```powershell
cd web
npm run type-check
npm run build
npx playwright test e2e/specs/09-performance-workspace.spec.ts e2e/specs/07-peripheral-actions.spec.ts
```

Expected: every command exits 0 and Playwright reports zero failed tests.

- [ ] **Step 5: Run real browser acceptance at 1440×900**

With the manager account and current demo data, compare the canvas color, tool positions, card density, three-level layout, edges, and zoom controls against the supplied reference. Exercise all scopes, cycle change, every display setting, 50%/150% zoom, drag, fit, detail, edit, progress, track, and delete confirmation. Refresh after changing display settings, check the console, and capture a fresh screenshot containing company, department, and personal cards.

- [ ] **Step 6: Run real browser acceptance at 390×844**

Repeat filter access, pan/zoom, detail, and action-menu checks. Capture a screenshot and confirm no overlap.

- [ ] **Step 7: Review diff and requirements**

```powershell
git diff --check HEAD~5..HEAD
git status --short
```

Re-read `docs/superpowers/specs/2026-08-15-objective-map-canvas-redesign-design.md`; confirm every requirement is implemented and unrelated user-owned files remain untouched.

- [ ] **Step 8: Commit final adjustments**

```powershell
git add -- web/src/views/objectives/ObjectiveMapView.vue web/src/views/objectives/components web/e2e/specs/09-performance-workspace.spec.ts
git commit -m "test(web): verify objective map canvas experience"
```
