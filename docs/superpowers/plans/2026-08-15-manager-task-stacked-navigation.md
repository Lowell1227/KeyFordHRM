# Manager Task Stacked Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manager-only “my/team” scope filter with a persistent stacked navigation that shows personal and team performance stages together and keeps team business filters in the content area.

**Architecture:** Keep the existing `TaskListView` data sources, URL query contract, and manager authorization. Reshape only the manager presentation: stage rows become the range entry points, the common cycle selector stays in the context rail, and team status/department/employee filters move into the team workspace toolbar. Employee presentation remains on the existing personal-only branch.

**Tech Stack:** Vue 3, Vue Router 4, Pinia, Element Plus, TypeScript, Playwright.

## Global Constraints

- Manager context must always show “我的绩效待办” above “我团队的绩效待办”.
- Manager page must not render the “我的任务 / 团队绩效” scope filter.
- Personal stages are 目标制定、目标确认、自评、结果确认.
- Team stages are 指标审核、主管评分.
- Team department, employee, and processing-state filters belong to the content area.
- Bare manager `/tasks` continues to canonicalize to `scope=team&stage=goal-review&stageState=pending`.
- Employee task navigation and all backend/API/authorization contracts remain unchanged.
- No database, API, or task state-machine changes.

---

### Task 1: Manager stacked stage navigation

**Files:**
- Modify: `web/e2e/specs/11-navigation-entrypoints.spec.ts:172-195`
- Modify: `web/src/views/task/TaskListView.vue:1-1120`

**Interfaces:**
- Consumes: `activeScope`, `selectedStage`, `taskStages`, `teamStageTabs`, `stageState()`, `workspaceQuery.update()`.
- Produces: manager-only test ids `manager-task-navigation`, `manager-personal-task-group`, `manager-team-task-group`, and `manager-team-stage-<stage>`.

- [x] **Step 1: Replace the manager scope-filter assertion with a failing stacked-navigation test**

Use this behavior in `11-navigation-entrypoints.spec.ts`:

```ts
test('manager performance entry exposes stacked personal and team stages without a scope filter', async ({ page }) => {
  await page.goto('/tasks');

  await expect(page).toHaveURL(/scope=team.*stage=goal-review.*stageState=pending/);
  const navigation = page.getByTestId('manager-task-navigation');
  const personal = page.getByTestId('manager-personal-task-group');
  const team = page.getByTestId('manager-team-task-group');
  await expect(navigation.getByLabel('任务范围')).toHaveCount(0);
  await expect(personal).toContainText('我的绩效待办');
  await expect(team).toContainText('我团队的绩效待办');
  expect(await personal.evaluate((node) => node.compareDocumentPosition(team) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await expect(page.getByTestId('task-scope-mine')).toHaveCount(0);
  await expect(page.getByTestId('task-scope-team')).toHaveCount(0);

  await page.getByTestId('task-stage-self-eval').click();
  await expect(page).toHaveURL(/scope=mine/);
  await page.getByTestId('manager-team-stage-manager-eval').click();
  await expect(page).toHaveURL(/scope=team.*stage=manager-eval/);
});
```

- [x] **Step 2: Run the targeted test and verify RED**

Run:

```powershell
Set-Location web
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test 11-navigation-entrypoints.spec.ts --grep "stacked personal and team stages"
```

Expected: FAIL because `manager-task-navigation` and the two simultaneous groups do not exist.

- [x] **Step 3: Implement the manager-only combined context branch**

In `TaskListView.vue`:

- remove the manager scope switch from the toolbar;
- keep the selected-cycle tag only where it still adds context;
- render one `PerformanceContextPanel` for managers;
- render the common cycle selector followed by the two fixed stage groups;
- keep the current employee-only personal context as the non-manager branch.

Add these handlers:

```ts
function selectManagerPersonalStage(stage: Exclude<TaskStageKey, 'all'>) {
  selectStage(stage);
  if (activeScope.value !== 'mine') {
    void updateTeamContext({ scope: 'mine', taskId: undefined, employeeId: undefined });
  }
}

function selectManagerTeamStage(stage: TeamTaskStage) {
  void updateTeamContext({
    scope: 'team',
    stage,
    stageState: stage === workspaceQuery.state.value.stage
      ? workspaceQuery.state.value.stageState
      : 'pending',
    taskId: undefined,
  });
}
```

When a manager opens an explicit personal route and no personal stage has been chosen yet, initialize `selectedStage` to `goal-setting`. Employees continue to initialize at `all`.

- [x] **Step 4: Run the targeted test and verify GREEN**

Run the Step 2 command again.

Expected: PASS with both groups visible and URL changes driven by stage rows.

---

### Task 2: Team summaries and content-area filters

**Files:**
- Modify: `web/e2e/specs/10-team-performance-contract.spec.ts:598-705`
- Modify: `web/src/views/task/TaskListView.vue:1-1900`

**Interfaces:**
- Consumes: `tasksApi.findTeam()`, `teamPage.counts`, `teamCountTabs`, `teamEmployeeOptions`, existing filter handlers.
- Produces: `teamStagePendingCounts: Record<TeamTaskStage, number | undefined>` and content region `team-workspace-filters`.

- [x] **Step 1: Write failing placement and stage-summary assertions**

Update the first team-list contract to assert observable layout ownership:

```ts
const navigation = page.getByTestId('manager-task-navigation');
const filters = page.getByTestId('team-workspace-filters');
await expect(navigation.getByTestId('team-department-filter')).toHaveCount(0);
await expect(navigation.getByTestId('team-employee-filter')).toHaveCount(0);
await expect(filters.getByTestId('team-department-filter')).toBeVisible();
await expect(filters.getByTestId('team-employee-filter')).toBeVisible();
await expect(filters.getByTestId('team-count-pending')).toContainText('2');
await expect(page.getByTestId('manager-team-stage-goal-review')).toContainText('2');
```

Update stage clicks from `.team-stage-tabs` to `manager-team-stage-manager-eval` and `manager-team-stage-goal-review`.

- [x] **Step 2: Run the targeted team-list tests and verify RED**

Run:

```powershell
Set-Location web
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test 10-team-performance-contract.spec.ts --grep "team list exposes filters|team list applies URL filters|selection is page-local"
```

Expected: FAIL because team filters still belong to the context rail and team stage rows have no summaries.

- [x] **Step 3: Implement summary loading without changing APIs**

Add a request-serial-protected `loadTeamStageSummaries()` that requests page 1 with page size 1 for `goal-review` and `manager-eval`, applies the current cycle/department/employee filters, and stores `response.counts.pending`. Use `Promise.allSettled` so one summary failure does not block the active list.

Call it:

- on manager mount alongside the existing active workspace load;
- after team cycle, department, or employee context changes;
- after review or manager-evaluation operations that can change pending counts.

- [x] **Step 4: Move team status and business filters into the content area**

In the team workspace:

- add a stage header;
- render `teamCountTabs` horizontally under the header;
- render search, department, employee, and reset controls inside `data-testid="team-workspace-filters"`;
- keep the cycle selector in the context rail and expose the current team binding as `team-cycle-filter`;
- remove the old team-only context sections and `.team-stage-tabs` presentation.

Keep all existing handlers and URL query keys so requests, task selection clearing, and detail deep links retain current behavior.

- [x] **Step 5: Run targeted tests and verify GREEN**

Run the Step 2 command again.

Expected: all selected tests PASS.

---

### Task 3: Responsive behavior and complete verification

**Files:**
- Modify: `web/e2e/specs/11-navigation-entrypoints.spec.ts:591-657`
- Modify: `web/src/views/task/TaskListView.vue:1354-1900`
- Modify: `docs/superpowers/plans/2026-08-15-manager-task-stacked-navigation.md`

**Interfaces:**
- Consumes: existing `PerformanceWorkspace` desktop and mobile breakpoints.
- Produces: stacked navigation and wrapping team filters with no document-level horizontal overflow at 390px.

- [x] **Step 1: Add the responsive regression assertion**

At a 390px viewport, assert both manager groups remain visible, the range switch is absent, and:

```ts
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
expect(overflow).toBeLessThanOrEqual(1);
```

- [x] **Step 2: Run the responsive test and verify RED if layout overflows**

Run:

```powershell
Set-Location web
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test 11-navigation-entrypoints.spec.ts --grep "manager task navigation stays stacked"
```

Expected before responsive CSS: FAIL on missing test ids or overflow.

- [x] **Step 3: Implement responsive CSS**

- keep the two groups vertically ordered;
- let stage rows wrap or scroll inside their group without document overflow;
- wrap team status buttons and filters;
- keep the selected-stage visual treatment consistent with the reference screenshot.

- [x] **Step 4: Run automated verification**

Run:

```powershell
Set-Location web
npm run test:contracts
npm run type-check
npm run build
npx playwright test 11-navigation-entrypoints.spec.ts
npx playwright test 05-multi-role-happy-path.spec.ts
```

Expected: every command exits 0. Also run `npm run test:e2e`; if the known shared-data organization fixture still fails before page navigation, report it separately with its exact error.

- [x] **Step 5: Verify the real Zhou Qiang flow**

With `MGR001` in the local browser:

1. Open performance tasks and confirm both groups are simultaneously visible in the stated order.
2. Confirm the scope filter is absent.
3. Click each personal and team stage and verify the right workspace and URL.
4. Open Zhang Chen's pending goal review and confirm save, approve, and reject commands are enabled without submitting them.
5. Refresh, revisit through task detail, and confirm stage/query state is preserved.
6. Inspect desktop and 390px screenshots and confirm zero console errors.

- [x] **Step 6: Commit the focused implementation**

```powershell
git add -- web/src/views/task/TaskListView.vue web/e2e/specs/10-team-performance-contract.spec.ts web/e2e/specs/11-navigation-entrypoints.spec.ts docs/superpowers/plans/2026-08-15-manager-task-stacked-navigation.md
git commit -m "fix(web): stack manager personal and team task navigation"
```
