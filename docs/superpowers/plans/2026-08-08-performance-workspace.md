# Performance Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose the existing target tracking, objective map, and performance task pages into one compact, responsive performance workspace based on the approved reference structure.

**Architecture:** Add a route-aware full-height workspace mode to `DefaultLayout` and two presentational performance components. Each existing page keeps ownership of its API calls, forms, permissions, and dialogs, while supplying page-specific toolbar, context, and content to the shared shell.

**Tech Stack:** Vue 3 Composition API, TypeScript, Vue Router, Element Plus, Playwright, existing REST API clients.

## Global Constraints

- Do not add or change backend APIs, Prisma models, or task workflow states.
- Keep existing `canManage` role checks and role-scoped user/department loading.
- Do not render team tasks or another employee's performance data from invented client data.
- Reuse the existing `EmptyState`, `StatusBadge`, Element Plus controls, icons, and color tokens.
- Keep cards at `8px` radius or less and avoid nested cards, marketing composition, decorative gradients, and third-party DingTalk chrome.
- Desktop target viewport is `1440x900`; mobile target viewport is `390x844` with no incoherent overlap or document-level horizontal overflow.

---

### Task 1: Shared performance workspace shell and navigation

**Files:**
- Create: `web/src/components/performance/PerformanceWorkspace.vue`
- Create: `web/src/components/performance/PerformanceContextPanel.vue`
- Modify: `web/src/layouts/DefaultLayout.vue`
- Modify: `web/src/components/layout/AppSidebar.vue`
- Modify: `web/src/router/index.ts`
- Create: `web/e2e/specs/09-performance-workspace.spec.ts`

**Interfaces:**
- Consumes: Vue Router routes `/action-items`, `/objectives`, and `/tasks`.
- Produces: `PerformanceWorkspace` props `title`, `activeSection`, `showContext`, and slots `toolbar`, `context`, default.
- Produces: `PerformanceContextPanel` props `title`, `collapsible`, and default slot.

- [ ] **Step 1: Write the failing shared navigation test**

```ts
import { expect, test } from '@playwright/test';

test.describe('09-performance-workspace manager shell', () => {
  test.use({ storageState: 'e2e/auth-state/manager.json' });

  for (const entry of [
    { path: '/action-items', current: '目标跟进' },
    { path: '/objectives', current: '目标地图' },
    { path: '/tasks', current: '绩效待办' },
  ]) {
    test(`${entry.current} uses shared performance navigation`, async ({ page }) => {
      await page.goto(entry.path);
      const nav = page.getByTestId('performance-secondary-nav');
      await expect(nav).toBeVisible();
      await expect(nav.getByRole('link', { name: '目标跟进' })).toBeVisible();
      await expect(nav.getByRole('link', { name: '目标地图' })).toBeVisible();
      await expect(nav.getByRole('link', { name: '绩效待办' })).toBeVisible();
      await expect(nav.getByRole('link', { name: entry.current })).toHaveAttribute('aria-current', 'page');
    });
  }
});
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run: `cd web && npx playwright test e2e/specs/09-performance-workspace.spec.ts --project=chromium`

Expected: FAIL because `[data-testid="performance-secondary-nav"]` does not exist.

- [ ] **Step 3: Implement the shared workspace components**

`PerformanceWorkspace.vue` must use this navigation contract:

```ts
type PerformanceSection = 'tracking' | 'map' | 'tasks';

const props = withDefaults(defineProps<{
  title: string;
  activeSection: PerformanceSection;
  showContext?: boolean;
}>(), {
  showContext: true,
});

const sections = [
  { key: 'tracking', label: '目标跟进', to: '/action-items' },
  { key: 'map', label: '目标地图', to: '/objectives' },
  { key: 'tasks', label: '绩效待办', to: '/tasks' },
] as const;
```

The template must render a stable header, a `<nav data-testid="performance-secondary-nav">`, optional context slot, and main content slot. Each router link sets `aria-current="page"` only when `section.key === activeSection`.

`PerformanceContextPanel.vue` must expose a compact header and a scrollable body without fetching data or knowing routes.

- [ ] **Step 4: Enable full-height workspace mode and update labels**

In `DefaultLayout.vue`, compute the three workspace routes and add a modifier class:

```ts
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const workspacePaths = new Set(['/action-items', '/objectives', '/tasks']);
const isPerformanceWorkspace = computed(() => workspacePaths.has(route.path));
```

Bind `app-main--workspace` on `el-main`; set that modifier to `padding: 0; overflow: hidden;`. On mobile, keep the workspace itself scrollable instead of restoring outer padding.

Change visible labels only:

```ts
// AppSidebar.vue
{ path: '/tasks', title: '绩效待办', ... }
{ path: '/action-items', title: '目标跟进', ... }

// router/index.ts
meta: { requiresAuth: true, title: '绩效待办' }
meta: { requiresAuth: true, title: '目标跟进', roles: [...] }
```

- [ ] **Step 5: Run the shared navigation test and type check**

Run: `cd web && npx playwright test e2e/specs/09-performance-workspace.spec.ts --project=chromium`

Expected: PASS for all three route navigation cases.

Run: `cd web && npm run type-check`

Expected: exit code `0`.

- [ ] **Step 6: Commit the shared shell**

```bash
git add web/src/components/performance web/src/layouts/DefaultLayout.vue web/src/components/layout/AppSidebar.vue web/src/router/index.ts web/e2e/specs/09-performance-workspace.spec.ts
git commit -m "feat(web): add shared performance workspace"
```

---

### Task 2: Objective map workspace adaptation

**Files:**
- Modify: `web/src/views/objectives/ObjectiveMapView.vue`
- Modify: `web/e2e/specs/09-performance-workspace.spec.ts`

**Interfaces:**
- Consumes: `PerformanceWorkspace`, existing `filters.cycleId`, `filters.level`, `loadTree`, and `canManage`.
- Produces: `[data-testid="objective-map-toolbar"]` and `[data-testid="objective-map-surface"]`.

- [ ] **Step 1: Add the failing objective map structure test**

```ts
test('objective map exposes compact filters and one continuous data surface', async ({ page }) => {
  await page.goto('/objectives');
  await expect(page.getByTestId('objective-map-toolbar')).toBeVisible();
  await expect(page.getByTestId('objective-level-filter')).toBeVisible();
  await expect(page.getByTestId('objective-map-surface')).toBeVisible();
  await expect(page.getByTestId('objective-create')).toBeVisible();
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `cd web && npx playwright test e2e/specs/09-performance-workspace.spec.ts -g "objective map exposes" --project=chromium`

Expected: FAIL because `objective-map-toolbar` is missing.

- [ ] **Step 3: Recompose the objective map template**

Import `PerformanceWorkspace` and replace the two outer `ChartCard` wrappers with:

```vue
<PerformanceWorkspace title="目标地图" active-section="map" :show-context="false">
  <template #toolbar>
    <el-button v-if="canManage" data-testid="objective-create" type="primary" :icon="Plus" @click="openCreate">
      新建目标
    </el-button>
  </template>

  <div data-testid="objective-map-toolbar" class="objective-map__toolbar">
    <el-select v-model="filters.cycleId" aria-label="考核周期" placeholder="全部周期" clearable>
      <el-option v-for="c in cycles" :key="c.id" :label="c.name" :value="c.id" />
    </el-select>
    <el-radio-group v-model="filters.level" data-testid="objective-level-filter">
      <el-radio-button value="">全部目标</el-radio-button>
      <el-radio-button value="company">公司目标</el-radio-button>
      <el-radio-button value="department">部门目标</el-radio-button>
      <el-radio-button value="individual">个人目标</el-radio-button>
    </el-radio-group>
    <el-button :icon="RefreshRight" @click="loadTree">刷新</el-button>
  </div>

  <section data-testid="objective-map-surface" class="performance-surface">
    <!-- existing objective el-table and EmptyState -->
  </section>

  <!-- existing dialogs remain children of PerformanceWorkspace -->
</PerformanceWorkspace>
```

Remove `ChartCard` imports and add local styles for a wrapping toolbar, continuous white surface, stable minimum content height, and mobile horizontal filter scrolling.

- [ ] **Step 4: Run the objective map test and type check**

Run: `cd web && npx playwright test e2e/specs/09-performance-workspace.spec.ts -g "objective map exposes" --project=chromium`

Expected: PASS.

Run: `cd web && npm run type-check`

Expected: exit code `0`.

- [ ] **Step 5: Commit the objective map adaptation**

```bash
git add web/src/views/objectives/ObjectiveMapView.vue web/e2e/specs/09-performance-workspace.spec.ts
git commit -m "feat(web): adapt objective map workspace"
```

---

### Task 3: Target tracking context and action-item workspace

**Files:**
- Modify: `web/src/views/objectives/ActionItemsView.vue`
- Modify: `web/e2e/specs/09-performance-workspace.spec.ts`

**Interfaces:**
- Consumes: `PerformanceWorkspace`, `PerformanceContextPanel`, existing objective list and action-item CRUD.
- Produces: `chooseObjective(objectiveId: string): void`, `filteredObjectives: ComputedRef<Objective[]>`, and tracking context test IDs.

- [ ] **Step 1: Add the failing target tracking context test**

```ts
test('target tracking exposes objective context and action workspace', async ({ page }) => {
  await page.goto('/action-items');
  await expect(page.getByTestId('tracking-context')).toBeVisible();
  await expect(page.getByTestId('tracking-objective-search')).toBeVisible();
  await expect(page.getByTestId('tracking-surface')).toBeVisible();
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `cd web && npx playwright test e2e/specs/09-performance-workspace.spec.ts -g "target tracking exposes" --project=chromium`

Expected: FAIL because `tracking-context` is missing.

- [ ] **Step 3: Add objective context state and URL synchronization**

Extend the script with:

```ts
import { useRoute, useRouter } from 'vue-router';

const router = useRouter();
const objectiveKeyword = ref('');
const filteredObjectives = computed(() => {
  const keyword = objectiveKeyword.value.trim().toLowerCase();
  if (!keyword) return objectives.value;
  return objectives.value.filter((objective) =>
    [objective.title, objective.ownerName, objective.deptName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword)),
  );
});

function chooseObjective(objectiveId: string) {
  filters.objectiveId = objectiveId;
  router.replace({ query: { ...route.query, objectiveId: objectiveId || undefined } });
}
```

After `loadObjectives()`, select the first objective only when the query did not provide an objective and the list is non-empty:

```ts
if (!filters.objectiveId && objectives.value.length > 0) {
  chooseObjective(objectives.value[0].id);
}
```

- [ ] **Step 4: Recompose action items into context and main surface**

Use this structure while retaining the existing table, kanban, dialogs, and permission-bound actions:

```vue
<PerformanceWorkspace title="目标跟进" active-section="tracking">
  <template #toolbar>
    <el-button v-if="canManage" :disabled="!filters.objectiveId" type="primary" :icon="Plus" @click="openCreate()">
      新建行动项
    </el-button>
  </template>
  <template #context>
    <PerformanceContextPanel title="目标列表">
      <div data-testid="tracking-context">
        <el-input v-model="objectiveKeyword" data-testid="tracking-objective-search" placeholder="搜索目标" clearable />
        <button
          v-for="objective in filteredObjectives"
          :key="objective.id"
          type="button"
          :class="['objective-context-item', { 'is-active': objective.id === filters.objectiveId }]"
          @click="chooseObjective(objective.id)"
        >
          <span>{{ objective.title }}</span>
          <small>{{ objective.ownerName || objective.deptName || '未指定负责人' }} · {{ objective.progress }}%</small>
        </button>
      </div>
    </PerformanceContextPanel>
  </template>
  <section data-testid="tracking-surface" class="performance-surface">
    <!-- selected objective summary, status/assignee filters, list/kanban switch, existing content -->
  </section>
  <!-- existing dialogs -->
</PerformanceWorkspace>
```

Use semantic `<button>` elements for objective choices, `aria-pressed` for the selected item, and responsive styles that turn the context list into a horizontal strip below `768px`.

- [ ] **Step 5: Run the tracking test and type check**

Run: `cd web && npx playwright test e2e/specs/09-performance-workspace.spec.ts -g "target tracking exposes" --project=chromium`

Expected: PASS.

Run: `cd web && npm run type-check`

Expected: exit code `0`.

- [ ] **Step 6: Commit target tracking**

```bash
git add web/src/views/objectives/ActionItemsView.vue web/e2e/specs/09-performance-workspace.spec.ts
git commit -m "feat(web): add target tracking workspace"
```

---

### Task 4: Performance task stage navigation

**Files:**
- Modify: `web/src/views/task/TaskListView.vue`
- Modify: `web/e2e/specs/09-performance-workspace.spec.ts`

**Interfaces:**
- Consumes: `PerformanceWorkspace`, `PerformanceContextPanel`, `tasksApi.findMine`, current task status labels, and `/tasks/:id`.
- Produces: `TaskStageKey`, `taskStages`, `selectedStage`, `stageForStatus(status)`, and `visibleTasks`.

- [ ] **Step 1: Add the failing performance task context test**

```ts
test.describe('09-performance-workspace employee tasks', () => {
  test.use({ storageState: 'e2e/auth-state/employee.json' });

  test('performance tasks expose cycle and stage navigation', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('task-context')).toBeVisible();
    await expect(page.getByTestId('task-cycle-filter')).toBeVisible();
    const stage = page.getByTestId('task-stage-self-eval');
    await expect(stage).toBeVisible();
    await stage.click();
    await expect(stage).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('task-surface')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `cd web && npx playwright test e2e/specs/09-performance-workspace.spec.ts -g "performance tasks expose" --project=chromium`

Expected: FAIL because `task-context` is missing.

- [ ] **Step 3: Add real-status stage mapping and filtering**

Add this client-only view model without creating task data:

```ts
type TaskStageKey = 'all' | 'goal-setting' | 'goal-confirmation' | 'self-eval' | 'result';

const selectedStage = ref<TaskStageKey>('all');
const taskStages = [
  { key: 'goal-setting', label: '目标制定' },
  { key: 'goal-confirmation', label: '目标确认' },
  { key: 'self-eval', label: '自评' },
  { key: 'result', label: '结果确认' },
] as const;

function stageForStatus(status: TaskStatus): Exclude<TaskStageKey, 'all'> {
  if (['indicator_drafting', 'indicator_reviewing', 'indicator_setting'].includes(status)) return 'goal-setting';
  if (status === 'indicator_confirming') return 'goal-confirmation';
  if (['self_eval', 'manager_scoring', 'dept_review', 'hr_calibration', 'approval'].includes(status)) return 'self-eval';
  return 'result';
}

const visibleTasks = computed(() => {
  if (selectedStage.value === 'all') return list.value;
  return list.value.filter((task) => stageForStatus(task.status) === selectedStage.value);
});
```

Derive each stage's visual state from matching real tasks: `待处理` when a matching task has a pending status, `处理中` when matching tasks exist but are not closed, `已完成` for only `confirmed` or `closed`, and `未开始` when no matching task exists.

- [ ] **Step 4: Recompose task list into context and main surface**

Use `PerformanceWorkspace title="绩效待办" active-section="tasks"`. Put the existing cycle selector in the context slot with `data-testid="task-cycle-filter"`, render the four stage buttons with `data-testid="task-stage-${stage.key}"`, and render the existing table against `visibleTasks` in `<section data-testid="task-surface">`.

Keep row navigation and action buttons unchanged. When the stage filter changes, reset pagination and use `aria-pressed` to expose selection.

- [ ] **Step 5: Run the task test and type check**

Run: `cd web && npx playwright test e2e/specs/09-performance-workspace.spec.ts -g "performance tasks expose" --project=chromium`

Expected: PASS.

Run: `cd web && npm run type-check`

Expected: exit code `0`.

- [ ] **Step 6: Commit performance task navigation**

```bash
git add web/src/views/task/TaskListView.vue web/e2e/specs/09-performance-workspace.spec.ts
git commit -m "feat(web): add performance task stages"
```

---

### Task 5: Responsive, visual, and regression verification

**Files:**
- Modify: `web/e2e/specs/09-performance-workspace.spec.ts`
- Modify only if verification finds layout defects: performance workspace component or one of the three adapted views.

**Interfaces:**
- Consumes: completed performance workspace routes and test IDs.
- Produces: desktop/mobile overflow regression coverage and verified screenshots.

- [ ] **Step 1: Add the failing responsive contract test before final CSS adjustments**

```ts
test('performance workspace is usable at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/objectives');
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  await expect(page.getByTestId('performance-secondary-nav')).toBeVisible();
  expect(overflow).toBeLessThanOrEqual(8);
});
```

- [ ] **Step 2: Run the responsive test and record the actual result**

Run: `cd web && npx playwright test e2e/specs/09-performance-workspace.spec.ts -g "mobile width" --project=chromium`

Expected before final responsive adjustments: FAIL when the desktop context or filter toolbar creates document-level overflow. If it passes, inspect the screenshot and add a tighter assertion against any overflowing workspace child before proceeding.

- [ ] **Step 3: Apply minimal responsive fixes**

Use `min-width: 0` on all flex/grid children, `overflow: auto` only on the local table/surface, horizontal navigation scrolling on mobile, and fixed control dimensions with responsive wrapping. Do not hide business commands merely to satisfy width.

- [ ] **Step 4: Run full frontend verification**

Run: `cd web && npm run type-check`

Expected: exit code `0`.

Run: `cd web && npm run build`

Expected: exit code `0`; the existing Vite chunk-size warning is informational.

Run: `cd web && npx playwright test e2e/specs/09-performance-workspace.spec.ts --project=chromium`

Expected: all tests in the file pass.

Run: `cd web && npx playwright test e2e/specs/02-role-menu-visibility.spec.ts e2e/specs/06-role-page-smoke.spec.ts e2e/specs/08-rbac-responsive.spec.ts --project=chromium`

Expected: existing menu, page health, RBAC, and responsive tests pass.

- [ ] **Step 5: Inspect desktop and mobile screenshots**

Use the in-app browser at `1440x900` and `390x844` for `/action-items`, `/objectives`, and `/tasks`. Verify current navigation, stable work area, no nested cards, readable controls, local table scrolling, and no text/button overlap.

- [ ] **Step 6: Commit responsive verification changes**

```bash
git add web/e2e/specs/09-performance-workspace.spec.ts web/src/components/performance web/src/views/objectives web/src/views/task/TaskListView.vue
git commit -m "test(web): verify performance workspace layouts"
```
