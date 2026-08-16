# Cycle-First Performance Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every cycle-first performance module select one deterministic assessment cycle and prevent business requests from silently querying across cycles.

**Architecture:** Add one pure cycle-selection utility that preserves a valid requested cycle and otherwise chooses an in-progress, most-recently-ended, or earliest-upcoming cycle. Keep page-specific URL synchronization local to each existing view so permissions and status-specific candidate lists remain unchanged; every view waits for cycle resolution before loading business data.

**Tech Stack:** Vue 3 Composition API, Vue Router 4, TypeScript 5.6, Element Plus, Playwright contract/E2E tests, Vite.

## Global Constraints

- Work directly on `main`; do not create a branch or worktree.
- Preserve all unrelated dirty files, especially `README.md`, `web/components.d.ts`, `docs/acceptance/`, `docs/operations/`, and `tmp/`.
- Do not change backend APIs, database data, permissions, lifecycle transitions, or visible-cycle authorization.
- Default-cycle priority is exactly: in progress (`startDate <= today <= endDate`), then most recently ended, then earliest upcoming.
- Date comparisons use the user's local calendar date, not `Date.prototype.toISOString()` UTC output.
- A valid URL `cycleId` always wins over the default; an invalid URL value is replaced without adding browser history.
- Pages with a cycle selector must write `cycleId` to the URL and must never issue an unfiltered business request while cycle resolution is pending or empty.
- Task, objective, report, calibration, approval, and publish selectors contain only real cycles; no “all cycles” or pseudo-cycle options.
- 申诉处理（appeals）、绩效面谈（interviews）和改进计划（improvement plans）保持跨周期列表，不纳入强制周期改造。
- Run `npm run type-check` and `npm run build` serially on Windows because both can write generated declaration files.
- Add no new dependency and no persistent browser preference.

---

## File Structure

### Create

- `web/src/utils/performance-cycle.ts` — pure local-date, ordering, and requested/default cycle resolution.
- `web/e2e/specs/13-cycle-first-performance-context.spec.ts` — pure resolver tests and route-mocked cycle-first page contracts.

### Modify

- `web/playwright.contract.config.ts` — include the new focused contract file.
- `web/src/views/task/TaskListView.vue` — require one shared cycle for personal and team work.
- `web/src/views/objectives/goal-tracking.ts` — delegate goal-tracking default selection to the shared resolver.
- `web/src/views/objectives/use-goal-tracking.ts` — keep deep links while using the shared default.
- `web/src/views/objectives/ObjectiveMapView.vue` — require a URL-backed cycle before loading the tree.
- `web/src/views/objectives/components/ObjectiveMapFilters.vue` — remove the all-cycle/clearable selector behavior.
- `web/src/views/reports/ReportsView.vue` — use a URL-backed required cycle for every report tab and export.
- `web/src/views/dashboard/DashboardView.vue` — choose the nearest eligible result cycle deterministically.
- `web/src/views/calibration/CalibrationView.vue` — normalize and retain one eligible calibration cycle.
- `web/src/views/approval/ApprovalView.vue` — normalize and retain one eligible approval cycle.
- `web/src/views/publish/PublishView.vue` — normalize and retain one eligible publication cycle.
- `web/e2e/specs/10-team-performance-contract.spec.ts` — lock task-cycle URL, request, reset, and empty-state behavior.
- `web/e2e/specs/12-goal-tracking-model.spec.ts` — replace the independent status-based default expectation with date-priority expectations.
- `web/e2e/specs/09-performance-workspace.spec.ts` — cover objective-map and goal-tracking URL behavior.
- `web/e2e/specs/11-navigation-entrypoints.spec.ts` — cover management-dashboard result-cycle selection.

---

### Task 1: Shared deterministic cycle resolver

**Files:**
- Create: `web/src/utils/performance-cycle.ts`
- Create: `web/e2e/specs/13-cycle-first-performance-context.spec.ts`
- Modify: `web/playwright.contract.config.ts`

**Interfaces:**
- Consumes: `AssessmentCycle` from `@/types/api.types`.
- Produces:
  - `localDateKey(now?: Date): string`
  - `orderPerformanceCycles(cycles: AssessmentCycle[], today?: string): AssessmentCycle[]`
  - `resolvePerformanceCycle(cycles: AssessmentCycle[], requestedCycleId?: string, today?: string): { orderedCycles: AssessmentCycle[]; selectedCycle: AssessmentCycle | null; requestedCycleIsValid: boolean }`

- [ ] **Step 1: Register the new contract file**

Update `web/playwright.contract.config.ts`:

```ts
testMatch: [
  '10-team-performance-contract.spec.ts',
  '12-goal-tracking-model.spec.ts',
  '13-cycle-first-performance-context.spec.ts',
],
```

- [ ] **Step 2: Write failing resolver tests**

Create `web/e2e/specs/13-cycle-first-performance-context.spec.ts` with a complete cycle fixture and these assertions:

```ts
import { expect, test } from '@playwright/test';
import type { AssessmentCycle } from '../../src/types/api.types';
import {
  localDateKey,
  orderPerformanceCycles,
  resolvePerformanceCycle,
} from '../../src/utils/performance-cycle';

function cycle(id: string, startDate: string, endDate: string): AssessmentCycle {
  return {
    id,
    name: id,
    type: 'quarterly',
    startDate,
    endDate,
    status: 'self_eval',
    publishVisibleFields: {
      totalScore: true,
      grade: true,
      indicatorScores: true,
      managerComment: true,
      coefficient: false,
    },
    gradeAMaxRatio: 0.2,
    gradeBMaxRatio: 0.4,
    gradeCMaxRatio: 0.3,
    gradeDMaxRatio: 0.1,
  };
}

test('preserves a valid requested historical cycle', () => {
  const result = resolvePerformanceCycle([
    cycle('past', '2026-01-01', '2026-03-31'),
    cycle('current', '2026-07-01', '2026-09-30'),
  ], 'past', '2026-08-16');
  expect(result.selectedCycle?.id).toBe('past');
  expect(result.requestedCycleIsValid).toBe(true);
});

test('defaults to the latest-starting in-progress cycle', () => {
  const result = resolvePerformanceCycle([
    cycle('current-old', '2026-01-01', '2026-12-31'),
    cycle('current-new', '2026-07-01', '2026-09-30'),
    cycle('future', '2026-10-01', '2026-12-31'),
  ], undefined, '2026-08-16');
  expect(result.selectedCycle?.id).toBe('current-new');
});

test('falls back to the most recently ended cycle', () => {
  expect(resolvePerformanceCycle([
    cycle('old', '2025-10-01', '2025-12-31'),
    cycle('recent', '2026-04-01', '2026-06-30'),
  ], undefined, '2026-08-16').selectedCycle?.id).toBe('recent');
});

test('uses the earliest upcoming cycle when no cycle has started', () => {
  expect(resolvePerformanceCycle([
    cycle('later', '2027-01-01', '2027-03-31'),
    cycle('next', '2026-10-01', '2026-12-31'),
  ], undefined, '2026-08-16').selectedCycle?.id).toBe('next');
});

test('handles inclusive boundaries, invalid dates, empty candidates, and local dates', () => {
  expect(resolvePerformanceCycle([
    cycle('boundary', '2026-08-16', '2026-08-16'),
    cycle('invalid', 'invalid', 'invalid'),
  ], undefined, '2026-08-16').selectedCycle?.id).toBe('boundary');
  expect(resolvePerformanceCycle([], 'missing', '2026-08-16').selectedCycle).toBeNull();
  expect(localDateKey(new Date(2026, 7, 16, 0, 30))).toBe('2026-08-16');
  expect(orderPerformanceCycles([
    cycle('invalid-first', 'invalid', 'invalid'),
  ], '2026-08-16')[0]?.id).toBe('invalid-first');
});
```

- [ ] **Step 3: Run the resolver tests and verify RED**

Run:

```powershell
cd web
npm run test:contracts -- e2e/specs/13-cycle-first-performance-context.spec.ts
```

Expected: TypeScript fails because `../../src/utils/performance-cycle` does not exist.

- [ ] **Step 4: Implement the minimal pure resolver**

Create `web/src/utils/performance-cycle.ts`:

```ts
import type { AssessmentCycle } from '@/types/api.types';

export function localDateKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year
    && parsed.getMonth() === month - 1
    && parsed.getDate() === day
    ? value
    : null;
}

export function orderPerformanceCycles(
  cycles: AssessmentCycle[],
  today = localDateKey(),
): AssessmentCycle[] {
  const originalIndex = new Map(cycles.map((item, index) => [item.id, index]));
  return [...cycles].sort((left, right) => {
    const leftStart = validDate(left.startDate);
    const leftEnd = validDate(left.endDate);
    const rightStart = validDate(right.startDate);
    const rightEnd = validDate(right.endDate);
    const group = (start: string | null, end: string | null) => {
      if (start && end && start <= today && today <= end) return 0;
      if (end && end < today) return 1;
      if (start && start > today) return 2;
      return 3;
    };
    const leftGroup = group(leftStart, leftEnd);
    const rightGroup = group(rightStart, rightEnd);
    if (leftGroup !== rightGroup) return leftGroup - rightGroup;
    if (leftGroup === 0) {
      return String(rightStart).localeCompare(String(leftStart))
        || String(rightEnd).localeCompare(String(leftEnd));
    }
    if (leftGroup === 1) return String(rightEnd).localeCompare(String(leftEnd));
    if (leftGroup === 2) return String(leftStart).localeCompare(String(rightStart));
    return (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0);
  });
}

export function resolvePerformanceCycle(
  cycles: AssessmentCycle[],
  requestedCycleId?: string,
  today = localDateKey(),
) {
  const orderedCycles = orderPerformanceCycles(cycles, today);
  const requested = requestedCycleId
    ? cycles.find((item) => item.id === requestedCycleId) ?? null
    : null;
  return {
    orderedCycles,
    selectedCycle: requested ?? orderedCycles[0] ?? null,
    requestedCycleIsValid: Boolean(requested),
  };
}
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
npm run test:contracts -- e2e/specs/13-cycle-first-performance-context.spec.ts
```

Expected: all resolver tests pass.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- web/src/utils/performance-cycle.ts web/e2e/specs/13-cycle-first-performance-context.spec.ts web/playwright.contract.config.ts
git diff --cached --check
git commit -m "feat(web): add deterministic performance cycle resolver"
```

---

### Task 2: Require a cycle in personal and team performance tasks

**Files:**
- Modify: `web/src/views/task/TaskListView.vue`
- Modify: `web/e2e/specs/10-team-performance-contract.spec.ts`
- Modify: `web/e2e/specs/13-cycle-first-performance-context.spec.ts`

**Interfaces:**
- Consumes: `resolvePerformanceCycle()` and `workspaceQuery.update()`.
- Produces: one URL-backed `selectedCycleId` shared by personal list, team list, team summaries, employee workspace, and reset behavior.

- [ ] **Step 1: Write failing task-cycle contracts**

Add route-mocked tests that return three cycles around `2026-08-16` and capture every `/tasks` and `/tasks/team` request:

```ts
test('performance tasks canonicalize the nearest current cycle before loading data', async ({ page }) => {
  const taskRequests: URL[] = [];
  await mockTaskCycleShell(page, {
    cycles: [pastCycle, currentCycle, futureCycle],
    onTaskRequest: (url) => taskRequests.push(url),
  });
  await page.goto('/tasks?scope=team&stage=goal-review&employeeId=old&taskId=old&page=3');
  await expect(page).toHaveURL(/cycleId=current/);
  await expect(page).not.toHaveURL(/employeeId=|taskId=|page=/);
  expect(taskRequests.length).toBeGreaterThan(0);
  expect(taskRequests.every((url) => url.searchParams.get('cycleId') === 'current')).toBe(true);
});

test('performance tasks preserve a valid historical cycle and reset keeps it', async ({ page }) => {
  await mockTaskCycleShell(page, { cycles: [pastCycle, currentCycle] });
  await page.goto('/tasks?scope=team&stage=goal-review&cycleId=past&deptId=dept-1');
  await expect(page.getByRole('combobox', { name: '考核周期' })).toHaveValue('past');
  await page.getByRole('button', { name: '重置筛选' }).click();
  await expect(page).toHaveURL(/cycleId=past/);
  await expect(page).not.toHaveURL(/deptId=/);
});

test('task cycle selector contains only real cycles', async ({ page }) => {
  await mockTaskCycleShell(page, { cycles: [pastCycle, currentCycle] });
  await page.goto('/tasks');
  await page.getByRole('combobox', { name: '考核周期' }).click();
  await expect(page.getByRole('option', { name: '全部考核周期' })).toHaveCount(0);
  await expect(page.getByRole('option', { name: '仅看待办任务' })).toHaveCount(0);
});

test('does not request task data when no cycle is available', async ({ page }) => {
  let taskRequestCount = 0;
  await mockTaskCycleShell(page, {
    cycles: [],
    onTaskRequest: () => { taskRequestCount += 1; },
  });
  await page.goto('/tasks');
  await expect(page.getByText('暂无考核周期')).toBeVisible();
  expect(taskRequestCount).toBe(0);
});
```

Update the existing manager contracts that assumed an empty cycle so their expected URLs include the fixture cycle.

- [ ] **Step 2: Run task-cycle tests and verify RED**

Run:

```powershell
npm run test:contracts -- e2e/specs/13-cycle-first-performance-context.spec.ts --grep "performance tasks|task cycle"
```

Expected: URL lacks `cycleId`, requests are unfiltered, and pseudo-cycle options are still visible.

- [ ] **Step 3: Normalize the cycle before any task request**

In `TaskListView.vue`, replace `quickFilter`/pseudo-cycle initialization with a normalization helper:

```ts
import { resolvePerformanceCycle } from '@/utils/performance-cycle';

async function normalizeTaskCycle(): Promise<string> {
  const resolved = resolvePerformanceCycle(cycles.value, workspaceQuery.state.value.cycleId);
  cycles.value = resolved.orderedCycles;
  const cycleId = resolved.selectedCycle?.id ?? '';
  selectedCycleId.value = cycleId;

  if (cycleId && workspaceQuery.state.value.cycleId !== cycleId) {
    await workspaceQuery.update({
      cycleId,
      employeeId: undefined,
      taskId: undefined,
      page: undefined,
    });
  }
  return cycleId;
}
```

After `loadCycles()`, call `normalizeTaskCycle()` before `loadList()`, `loadTeam()`, or `loadTeamStageSummaries()`. If it returns an empty string, clear the local pages and do not call the task APIs.

- [ ] **Step 4: Make every task query explicitly cycle-scoped**

Use the selected cycle in every path:

```ts
const baseParams = { cycleId: selectedCycleId.value } satisfies Omit<
  TaskQuery,
  'employeeId' | 'page' | 'pageSize'
>;

if (!baseParams.cycleId) {
  list.value = [];
  return;
}
```

Guard `loadTeam()` and `loadTeamStageSummaries()` the same way, and use `selectedCycleId.value` rather than an optional `workspaceQuery.state.value.cycleId` when building API parameters.

- [ ] **Step 5: Make cycle changes URL-backed and preserve them on reset**

Replace separate personal/team handlers with:

```ts
async function changeTaskCycle(cycleId: string) {
  if (!cycleId || cycleId === selectedCycleId.value) return;
  selectedCycleId.value = cycleId;
  await updateTeamContext({
    cycleId,
    deptId: undefined,
    employeeId: undefined,
    taskId: undefined,
    keyword: undefined,
  });
}
```

`resetTeamFilters()` must pass the existing cycle instead of `undefined`. Remove `showAllCycles()`, `showPendingTasks()`, `__pending__`, and both pseudo `<el-option>` nodes. When there are no cycles, render one disabled `暂无考核周期` option and disable the selector.

- [ ] **Step 6: Run the task contracts and verify GREEN**

Run:

```powershell
npm run test:contracts -- e2e/specs/10-team-performance-contract.spec.ts e2e/specs/13-cycle-first-performance-context.spec.ts
```

Expected: all task workspace and new cycle-first tests pass.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- web/src/views/task/TaskListView.vue web/e2e/specs/10-team-performance-contract.spec.ts web/e2e/specs/13-cycle-first-performance-context.spec.ts
git diff --cached --check
git commit -m "fix(web): require a cycle for performance tasks"
```

---

### Task 3: Align objective map and goal tracking

**Files:**
- Modify: `web/src/views/objectives/goal-tracking.ts`
- Modify: `web/src/views/objectives/use-goal-tracking.ts`
- Modify: `web/src/views/objectives/ObjectiveMapView.vue`
- Modify: `web/src/views/objectives/components/ObjectiveMapFilters.vue`
- Modify: `web/e2e/specs/09-performance-workspace.spec.ts`
- Modify: `web/e2e/specs/12-goal-tracking-model.spec.ts`
- Modify: `web/e2e/specs/13-cycle-first-performance-context.spec.ts`

**Interfaces:**
- Consumes: `resolvePerformanceCycle()`.
- Produces: URL-backed cycle selection for objective map and the existing person/cycle/objective deep-link contract for goal tracking.

- [ ] **Step 1: Write failing objective-cycle tests**

Add tests for default, history, invalid, and empty-cycle behavior:

```ts
test('objective map writes the current cycle before requesting the tree', async ({ page }) => {
  const treeCycles: Array<string | null> = [];
  await mockObjectiveCycleShell(page, (url) => treeCycles.push(url.searchParams.get('cycleId')));
  await page.goto('/objectives');
  await expect(page).toHaveURL(/cycleId=current/);
  expect(treeCycles).toEqual(['current']);
});

test('objective map preserves a valid historical cycle and offers no all-cycle option', async ({ page }) => {
  await mockObjectiveCycleShell(page);
  await page.goto('/objectives?cycleId=past');
  await expect(page.getByTestId('objective-map-cycle')).toHaveValue('past');
  await expect(page.getByTestId('objective-map-cycle').getByRole('option', { name: '全部周期' })).toHaveCount(0);
});

test('goal tracking delegates its default to date-priority selection', () => {
  expect(selectDefaultTrackingCycle([
    pastCycle,
    currentCycle,
    futureCycle,
  ], '2026-08-16')?.id).toBe('current');
});
```

Extend the existing invalid-deep-link test to assert that the first tracking request contains the canonical cycle.

- [ ] **Step 2: Run objective tests and verify RED**

Run:

```powershell
npm run test:contracts -- e2e/specs/12-goal-tracking-model.spec.ts e2e/specs/13-cycle-first-performance-context.spec.ts --grep "objective|goal tracking"
```

Expected: objective map initially requests without a cycle and the old goal-tracking selector uses status priority.

- [ ] **Step 3: Delegate goal tracking to the shared resolver**

Keep the public function for existing callers, but change it to:

```ts
import { resolvePerformanceCycle } from '@/utils/performance-cycle';

export function selectDefaultTrackingCycle(
  cycles: AssessmentCycle[],
  today?: string,
) {
  return resolvePerformanceCycle(cycles, undefined, today).selectedCycle;
}
```

`normalizeSelectionAndLoad()` continues to preserve a valid route cycle and objective deep link before using this default.

- [ ] **Step 4: Require a cycle in objective map**

Add `useRoute()` and `useRouter()`. After cycles load:

```ts
async function normalizeObjectiveCycle() {
  const requested = typeof route.query.cycleId === 'string' ? route.query.cycleId : undefined;
  const resolved = resolvePerformanceCycle(cycles.value, requested);
  cycles.value = resolved.orderedCycles;
  filters.cycleId = resolved.selectedCycle?.id ?? '';
  if (filters.cycleId && requested !== filters.cycleId) {
    await router.replace({ query: { ...route.query, cycleId: filters.cycleId } });
  }
}
```

Only call `loadTree()` when `filters.cycleId` exists. User changes use `router.push`, and the route watcher restores cycle selection on browser history. Remove `filters.cycleId || undefined` from the tree API call.

- [ ] **Step 5: Remove all-cycle UI semantics**

In `ObjectiveMapFilters.vue`, remove `clearable`, change the placeholder to `暂无考核周期`, add `data-testid="objective-map-cycle"`, disable when `cycles.length === 0`, and render only real cycle options.

- [ ] **Step 6: Run objective tests and verify GREEN**

Run:

```powershell
npm run test:contracts -- e2e/specs/12-goal-tracking-model.spec.ts e2e/specs/13-cycle-first-performance-context.spec.ts
npm run test:e2e -- e2e/specs/09-performance-workspace.spec.ts
```

Expected: resolver/model contracts and objective workspace E2E pass.

- [ ] **Step 7: Commit Task 3**

```powershell
git add -- web/src/views/objectives/goal-tracking.ts web/src/views/objectives/use-goal-tracking.ts web/src/views/objectives/ObjectiveMapView.vue web/src/views/objectives/components/ObjectiveMapFilters.vue web/e2e/specs/09-performance-workspace.spec.ts web/e2e/specs/12-goal-tracking-model.spec.ts web/e2e/specs/13-cycle-first-performance-context.spec.ts
git diff --cached --check
git commit -m "fix(web): require cycles in performance objectives"
```

---

### Task 4: Align reports and management dashboard

**Files:**
- Modify: `web/src/views/reports/ReportsView.vue`
- Modify: `web/src/views/dashboard/DashboardView.vue`
- Modify: `web/e2e/specs/11-navigation-entrypoints.spec.ts`
- Modify: `web/e2e/specs/13-cycle-first-performance-context.spec.ts`

**Interfaces:**
- Consumes: `resolvePerformanceCycle()`.
- Produces: one URL-backed report cycle and one deterministic eligible result cycle for management dashboard.

- [ ] **Step 1: Write failing report and dashboard contracts**

```ts
test('reports canonicalize one cycle before loading summary data', async ({ page }) => {
  const summaryCycles: string[] = [];
  await mockReportCycleShell(page, (cycleId) => summaryCycles.push(cycleId));
  await page.goto('/reports');
  await expect(page).toHaveURL(/cycleId=current/);
  expect(summaryCycles).toEqual(['current']);
});

test('reports preserve a valid historical cycle across department changes', async ({ page }) => {
  await mockReportCycleShell(page);
  await page.goto('/reports?cycleId=past');
  await expect(page.getByTestId('report-cycle-select')).toHaveValue('past');
  await page.getByTestId('report-department-select').click();
  await page.getByRole('option', { name: '研发部' }).click();
  await expect(page).toHaveURL(/cycleId=past/);
});

test('management dashboard uses the nearest eligible result cycle', async ({ page }) => {
  const requestedSummaryCycles: string[] = [];
  await mockDashboardCycleShell(page, requestedSummaryCycles);
  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-result-cycle')).toHaveText('Current result');
  expect(requestedSummaryCycles).toEqual(['current-result']);
});
```

Add `data-testid="dashboard-result-cycle"` to the existing cycle-name display.

- [ ] **Step 2: Run report/dashboard tests and verify RED**

Run:

```powershell
npm run test:contracts -- e2e/specs/13-cycle-first-performance-context.spec.ts --grep "reports|dashboard"
```

Expected: reports have no URL cycle and both pages select an API-order item.

- [ ] **Step 3: Make reports URL-backed and request-safe**

After `loadCycles()`, resolve `route.query.cycleId`, assign ordered candidates, replace an invalid/missing query, and only then load the active tab. Replace the independent `onMounted()` calls with:

```ts
onMounted(async () => {
  await Promise.all([loadCycles(), loadDepartments()]);
  if (!selectedCycleId.value) return;
  await loadActiveReport();
});
```

User selection pushes the new cycle query; route changes restore it. `loadSummary()`, `loadProgress()`, `loadGradeList()`, and export keep their existing explicit cycle arguments and return early when no cycle exists.

- [ ] **Step 4: Make dashboard result selection deterministic**

Replace `pickDefaultCycle()` with:

```ts
function pickDefaultCycle(items: AssessmentCycle[]): AssessmentCycle | undefined {
  const eligible = items.filter((cycle) =>
    ['published', 'appeal', 'closed'].includes(cycle.status));
  return resolvePerformanceCycle(eligible).selectedCycle ?? undefined;
}
```

Do not add a dashboard selector or URL parameter.

- [ ] **Step 5: Run report/dashboard tests and verify GREEN**

Run:

```powershell
npm run test:contracts -- e2e/specs/13-cycle-first-performance-context.spec.ts
npm run test:e2e -- e2e/specs/11-navigation-entrypoints.spec.ts
```

Expected: focused contracts and navigation/dashboard tests pass.

- [ ] **Step 6: Commit Task 4**

```powershell
git add -- web/src/views/reports/ReportsView.vue web/src/views/dashboard/DashboardView.vue web/e2e/specs/11-navigation-entrypoints.spec.ts web/e2e/specs/13-cycle-first-performance-context.spec.ts
git diff --cached --check
git commit -m "fix(web): align report cycle context"
```

---

### Task 5: Align calibration, approval, and publication workbenches

**Files:**
- Modify: `web/src/views/calibration/CalibrationView.vue`
- Modify: `web/src/views/approval/ApprovalView.vue`
- Modify: `web/src/views/publish/PublishView.vue`
- Modify: `web/e2e/specs/13-cycle-first-performance-context.spec.ts`

**Interfaces:**
- Consumes: status-filtered cycle arrays and `resolvePerformanceCycle()`.
- Produces: URL-backed required cycles scoped respectively to `hr_calibration`, `approval`, and the existing publication candidate query.

- [ ] **Step 1: Write failing lifecycle-workbench contracts**

Create a table-driven route-mocked test:

```ts
for (const entry of [
  { path: '/calibration', testId: 'calibration-cycle-select', requestPath: '/calibration/cycle/' },
  { path: '/approval', testId: 'approval-cycle-select', requestPath: '/approval/cycle/' },
  { path: '/publish', testId: 'publish-cycle-select', requestPath: '/tasks?' },
]) {
  test(`${entry.path} selects the nearest eligible cycle before loading work`, async ({ page }) => {
    const businessCycles: string[] = [];
    await mockLifecycleCycleShell(page, entry.path, businessCycles);
    await page.goto(entry.path);
    await expect(page).toHaveURL(/cycleId=current-eligible/);
    await expect(page.getByTestId(entry.testId)).toHaveValue('current-eligible');
    expect(businessCycles).toEqual(['current-eligible']);
  });
}

test('lifecycle workbenches keep an eligible historical deep link', async ({ page }) => {
  await mockLifecycleCycleShell(page, '/approval');
  await page.goto('/approval?cycleId=past-eligible');
  await expect(page.getByTestId('approval-cycle-select')).toHaveValue('past-eligible');
});

test('lifecycle workbenches do not load business data without an eligible cycle', async ({ page }) => {
  let businessRequests = 0;
  await mockLifecycleCycleShell(page, '/calibration', [], () => { businessRequests += 1; });
  await page.goto('/calibration');
  await expect(page.getByText('暂无可校准的考核周期')).toBeVisible();
  expect(businessRequests).toBe(0);
});
```

- [ ] **Step 2: Run lifecycle contracts and verify RED**

Run:

```powershell
npm run test:contracts -- e2e/specs/13-cycle-first-performance-context.spec.ts --grep "calibration|approval|publish|lifecycle"
```

Expected: cycle query is absent and default selection follows API order.

- [ ] **Step 3: Normalize each page after its status-filtered cycle request**

For each page, add route/router access and use the same local pattern:

```ts
async function normalizeCycle(candidates: AssessmentCycle[]) {
  const requested = typeof route.query.cycleId === 'string' ? route.query.cycleId : undefined;
  const resolved = resolvePerformanceCycle(candidates, requested);
  cycles.value = resolved.orderedCycles;
  selectedCycleId.value = resolved.selectedCycle?.id ?? '';
  if (selectedCycleId.value && requested !== selectedCycleId.value) {
    await router.replace({ query: { ...route.query, cycleId: selectedCycleId.value } });
  }
}
```

Keep each page's existing server-side status filter unchanged.

- [ ] **Step 4: Synchronize user changes and clear old-cycle state**

On selection, push the URL and clear page-specific state before loading:

- Calibration: `selectedTaskIds`, `edits`, `batchNote`, and summary.
- Approval: `selectedTaskIds` and reject-dialog task/comment.
- Publish: table selection, `selectedTaskIds`, and pagination.

Add stable test IDs to all three selectors. Route back/forward must reapply a still-eligible URL cycle.

- [ ] **Step 5: Distinguish empty candidates from load failure**

Each page keeps its existing error message for request failure. If the request succeeds with an empty list, render its existing empty state with page-specific wording and do not issue a business request. Do not synthesize an all-cycle option.

- [ ] **Step 6: Run lifecycle contracts and verify GREEN**

Run:

```powershell
npm run test:contracts -- e2e/specs/13-cycle-first-performance-context.spec.ts
npm run test:e2e -- e2e/specs/03-dom-redlines.spec.ts e2e/specs/06-role-page-smoke.spec.ts
```

Expected: focused cycle contracts, lifecycle redlines, and role page smoke pass.

- [ ] **Step 7: Commit Task 5**

```powershell
git add -- web/src/views/calibration/CalibrationView.vue web/src/views/approval/ApprovalView.vue web/src/views/publish/PublishView.vue web/e2e/specs/13-cycle-first-performance-context.spec.ts
git diff --cached --check
git commit -m "fix(web): require cycles in performance workbenches"
```

---

### Task 6: Focused regression and real-role acceptance

**Files:**
- Verify only; modify a listed task file only if a focused check exposes a regression.

**Interfaces:**
- Consumes: all five implementation tasks and the existing live Docker/API environment.
- Produces: fresh automated and real-role evidence for employee, manager, HR, and approver flows.

- [ ] **Step 1: Run the full focused contract set**

```powershell
cd web
npm run test:contracts -- e2e/specs/10-team-performance-contract.spec.ts e2e/specs/12-goal-tracking-model.spec.ts e2e/specs/13-cycle-first-performance-context.spec.ts
```

Expected: all selected tests pass with zero failures.

- [ ] **Step 2: Run related browser E2E suites**

```powershell
npm run test:e2e -- e2e/specs/03-dom-redlines.spec.ts e2e/specs/06-role-page-smoke.spec.ts e2e/specs/09-performance-workspace.spec.ts e2e/specs/11-navigation-entrypoints.spec.ts
```

Expected: all selected role, objective, navigation, and lifecycle tests pass.

- [ ] **Step 3: Run type-check and production build serially**

```powershell
npm run type-check
npm run build
```

Expected: both commands exit 0. Existing Rollup chunk-size or VueUse annotation warnings are acceptable; TypeScript or build errors are not.

- [ ] **Step 4: Start current source against the live API**

If Vite runs on the Windows host, use the published API port:

```powershell
$env:VITE_DEV_PROXY_TARGET='http://127.0.0.1:3000'
npm run dev -- --host 127.0.0.1 --port 5174
```

Expected: Vite serves current source on `http://127.0.0.1:5174` and login requests reach the live API.

- [ ] **Step 5: Verify employee and manager task behavior**

Using the in-app browser:

1. Login as an employee and open `/tasks`; verify one real cycle is selected and URL contains it.
2. Refresh; verify the same cycle remains and only that cycle's tasks appear.
3. Login as 周强 and open team goal review; verify URL, list request, stage counts, member workspace, and return state all keep the same cycle.
4. Use reset; verify the cycle remains selected.

- [ ] **Step 6: Verify objective, report, and lifecycle roles**

1. Employee/manager: goal tracking and objective map select one cycle and preserve a valid historical deep link.
2. HR: reports, calibration, and publication select one eligible cycle; changing department or report tab retains it.
3. Approver/VP: approval selects one eligible cycle and displays only that cycle's tasks.
4. Confirm appeals, interviews, and improvement-plan lists still allow cross-cycle history.

- [ ] **Step 7: Verify responsive and request safety**

At 1440×900 and 390×844, verify cycle selectors are non-empty and no horizontal overflow is introduced. Inspect relevant requests and confirm no cycle-first endpoint is called without `cycleId`. If no cycles are available, verify empty state and zero business requests.

- [ ] **Step 8: Check repository scope**

```powershell
git diff --check
git status --short
git log -8 --oneline --decorate
```

Expected: no whitespace errors; only the known unrelated dirty files remain uncommitted; implementation commits are on `main`.

- [ ] **Step 9: Commit only an acceptance correction if one was necessary**

If browser acceptance required a code correction, stage only the exact task files and commit:

```powershell
git add -- web/src/utils/performance-cycle.ts web/src/views/task/TaskListView.vue web/src/views/objectives/goal-tracking.ts web/src/views/objectives/use-goal-tracking.ts web/src/views/objectives/ObjectiveMapView.vue web/src/views/objectives/components/ObjectiveMapFilters.vue web/src/views/reports/ReportsView.vue web/src/views/dashboard/DashboardView.vue web/src/views/calibration/CalibrationView.vue web/src/views/approval/ApprovalView.vue web/src/views/publish/PublishView.vue web/e2e/specs/09-performance-workspace.spec.ts web/e2e/specs/10-team-performance-contract.spec.ts web/e2e/specs/11-navigation-entrypoints.spec.ts web/e2e/specs/12-goal-tracking-model.spec.ts web/e2e/specs/13-cycle-first-performance-context.spec.ts web/playwright.contract.config.ts
git diff --cached --check
git commit -m "fix(web): finish cycle-first performance acceptance"
```

If no correction was necessary, do not create an empty commit.
