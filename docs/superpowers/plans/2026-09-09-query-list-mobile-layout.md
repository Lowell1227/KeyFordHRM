# Query List and Mobile Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove redundant filter chrome, standardize bottom pagination, and provide true mobile card layouts for HRM query results while reorganizing performance calibration.

**Architecture:** Add three presentation-only shared components: `QueryFilterPanel` for an always-visible filter surface, `ListPagination` for desktop/mobile pagination variants, and `MobileResultCard` for page-owned business content. Existing pages retain their API calls, permissions, formatters, and actions; each page renders its current page of data as a desktop table or mobile cards. Workbench endpoints that already return a complete collection use client-side slicing, while existing paginated endpoints remain server-driven.

**Tech Stack:** Vue 3, TypeScript, Element Plus, existing `usePagination`, Playwright, Vite.

**Spec:** `docs/superpowers/specs/2026-09-09-query-list-mobile-layout-design.md`

## Global Constraints

- Work directly on the current leading `main`; the user explicitly approved continuing implementation and production release.
- Do not modify API permissions, data scope, workflow state, production business data, or database schema.
- Keep PC tables and mobile cards backed by the same current-page array and the same permission predicates.
- At widths `<= 768px`, independent query results use cards and must not create page-level horizontal overflow.
- Detail, evidence, editing, dashboard summary, and finite analysis tables are outside the pagination conversion.
- Use test-first red/green cycles, then run `npm run type-check`, `npm run build`, focused Playwright tests, candidate-image checks, and Web-only production verification.

---

### Task 1: Shared query-list presentation primitives

**Files:**
- Create: `web/src/components/common/QueryFilterPanel.vue`
- Create: `web/src/components/common/ListPagination.vue`
- Create: `web/src/components/common/MobileResultCard.vue`
- Modify: `web/src/styles/theme.css`
- Modify: `web/e2e/specs/21-unified-list-workspace.spec.ts`

**Interfaces:**
- Produces: `QueryFilterPanel` with a default slot and no visible title or collapse action.
- Produces: `ListPagination` props `currentPage`, `pageSize`, `total`, `pageSizes`; emits `update:currentPage`, `update:pageSize`, and `change`.
- Produces: `MobileResultCard` slots `title`, `status`, `default`, and `actions`.
- Produces: global classes `desktop-result-table` and `mobile-result-list` with a `768px` switch.

- [ ] **Step 1: Rewrite the unified-list Playwright contract to describe the new behavior**

Replace the collapsible assertion with literal user-visible expectations:

```ts
await expect(page.getByText('筛选条件', { exact: true })).toHaveCount(0);
await expect(page.getByRole('button', { name: '收起筛选' })).toHaveCount(0);
await expect(page.getByPlaceholder('请输入姓名或工号')).toBeVisible();

await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await expect(page.locator('.desktop-result-table')).toBeHidden();
await expect(page.locator('.mobile-result-list')).toBeVisible();
await expect(page.locator('.app-pager')).toBeVisible();
expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:e2e -- e2e/specs/21-unified-list-workspace.spec.ts`

Expected: FAIL because the page still renders “收起筛选” and has no mobile card list.

- [ ] **Step 3: Implement the three shared components and responsive classes**

`QueryFilterPanel.vue` renders:

```vue
<template>
  <section class="query-filter-panel" aria-label="查询条件"><slot /></section>
</template>
```

`ListPagination.vue` renders two Element Plus pagers inside `.app-pager`, with desktop layout `total, sizes, prev, pager, next` and mobile layout `total, prev, pager, next`; both bind the same props and emit the same updates.

`MobileResultCard.vue` renders an `<article class="mobile-result-card">` with header, body, and action regions driven only by slots.

Add CSS so `.desktop-result-table` is visible and `.mobile-result-list` hidden by default, then reverse them at `max-width: 768px`. Mobile filter controls and `.el-form-item` elements use full width; mobile pagination does not overflow.

- [ ] **Step 4: Keep the test RED until InterviewListView migrates in Task 2**

Run the same command and confirm the shared components compile but the behavior test still fails on the unmigrated page.

- [ ] **Step 5: Commit the shared primitives with their still-failing consumer test**

Do not commit a known-red intermediate state. Fold this commit into Task 2 after InterviewListView passes.

---

### Task 2: Remove redundant filter headers and migrate already-paginated lifecycle lists

**Files:**
- Modify: `web/src/views/interview/InterviewListView.vue`
- Modify: `web/src/views/improvement-plans/ImprovementPlanListView.vue`
- Modify: `web/src/views/appeals/AppealsView.vue`
- Modify: `web/src/views/probation/components/ProbationList.vue`
- Modify: `web/src/views/confirmation/ConfirmationManageView.vue`
- Modify: `web/src/views/confirmation/ConfirmationApprovalView.vue`
- Modify: `web/src/views/confirmation/ConfirmationMineView.vue`
- Delete: `web/src/components/common/CollapsibleFilterPanel.vue` after every consumer is migrated in Tasks 2 and 3.
- Test: `web/e2e/specs/21-unified-list-workspace.spec.ts`

**Interfaces:**
- Consumes: all shared components from Task 1.
- Preserves: existing API pagination, filters, action handlers, routing, and permission checks.

- [ ] **Step 1: Migrate InterviewListView first**

Replace `CollapsibleFilterPanel` with `QueryFilterPanel`; wrap the existing table in `.desktop-result-table`; render `.mobile-result-list` over `list` with employee/cycle/status/deadline fields and the existing fill/view action; replace the raw pager with `ListPagination`.

- [ ] **Step 2: Run the unified-list test and verify GREEN**

Run: `npm run test:e2e -- e2e/specs/21-unified-list-workspace.spec.ts`

Expected: PASS with no redundant filter labels, a desktop table, mobile cards, bottom pagination, and no 390px page overflow.

- [ ] **Step 3: Migrate the remaining lifecycle pages**

Use these mobile card fields and preserve each page's existing action slot:

| Page | Card title | Key fields |
| --- | --- | --- |
| 改进计划 | employeeName | 周期、状态、计划周期、制定人 |
| 申诉管理 | employeeName | 周期、申诉状态、提交时间、处理人 |
| 试用期考核 | employee.name | 主管、HR、状态、计划转正日期、签字状态 |
| 转正申请管理 | employee.name | 状态、主管、HR、拟转正日期、表决结果 |
| 转正审批台 | employee.name | 当前待审节点、状态、表决结果、实际转正日期 |
| 我的转正申请 | 当前申请 | 状态、主管、HR、公司审批人、实际转正日期 |

Every page replaces its raw `<el-pagination>` with `ListPagination` directly after the desktop/mobile result pair.

- [ ] **Step 4: Run the focused lifecycle smoke set**

Run: `npm run test:e2e -- e2e/specs/06-role-page-smoke.spec.ts e2e/specs/21-unified-list-workspace.spec.ts`

Expected: all selected tests PASS.

- [ ] **Step 5: Commit the shared and lifecycle batch**

```powershell
git add -- web/src/components/common/QueryFilterPanel.vue web/src/components/common/ListPagination.vue web/src/components/common/MobileResultCard.vue web/src/styles/theme.css web/src/views/interview/InterviewListView.vue web/src/views/improvement-plans/ImprovementPlanListView.vue web/src/views/appeals/AppealsView.vue web/src/views/probation/components/ProbationList.vue web/src/views/confirmation/ConfirmationManageView.vue web/src/views/confirmation/ConfirmationApprovalView.vue web/src/views/confirmation/ConfirmationMineView.vue web/e2e/specs/21-unified-list-workspace.spec.ts
git diff --cached --check
git commit -m "style(web): add responsive query result layouts"
```

---

### Task 3: Migrate administration lists and add missing pagination

**Files:**
- Modify: `web/src/views/admin/CycleManageView.vue`
- Modify: `web/src/views/admin/IndicatorLibraryView.vue`
- Modify: `web/src/views/admin/TemplateManageView.vue`
- Modify: `web/src/views/admin/UserManageView.vue`
- Modify: `web/src/views/admin/PositionDirectoryView.vue`
- Modify: `web/src/views/admin/components/PersonnelPendingReviews.vue`
- Modify: `web/e2e/specs/14-cycle-management-compact.spec.ts`
- Modify: `web/e2e/specs/15-user-management-concepts.spec.ts`
- Modify: `web/e2e/specs/23-employee-data-review.spec.ts`

**Interfaces:**
- Consumes: `QueryFilterPanel`, `ListPagination`, and `MobileResultCard`.
- Adds: client-side position pagination and independent server pagination state for employee, department, and position review queues.

- [ ] **Step 1: Write failing assertions for filter chrome, mobile cards, and review pagination**

Add literal assertions that:

```ts
await expect(page.getByRole('button', { name: /展开筛选|收起筛选/ })).toHaveCount(0);
await expect(page.getByText(/周期筛选|指标筛选|筛选条件/, { exact: true })).toHaveCount(0);
await expect(resultRegion.locator('.app-pager')).toBeVisible();
await expect(resultRegion.locator('.mobile-result-card').first()).toBeVisible();
```

The personnel-review test must verify all three visible queues place a pager after their desktop/mobile results, and the current page is sent to the existing list APIs.

- [ ] **Step 2: Run the three focused specs and verify RED**

Run: `npm run test:e2e -- e2e/specs/14-cycle-management-compact.spec.ts e2e/specs/15-user-management-concepts.spec.ts e2e/specs/23-employee-data-review.spec.ts`

Expected: FAIL on visible collapse controls, missing mobile cards, or missing review pagination.

- [ ] **Step 3: Migrate existing paginated admin lists**

Replace filter shells and pagers in cycle, indicator, template, roster, and organization-member lists. Render mobile cards from the current server page with these key fields:

| Page | Card title | Key fields |
| --- | --- | --- |
| 周期 | cycle.name | 周期类型、日期、当前状态、范围 |
| 指标 | indicator.name | 编码、类型、考核维度、状态 |
| 模板 | template.name | 编辑状态、适用范围、维度数、启用状态 |
| 员工档案 | user.name | 工号、部门、岗位、系统权限、状态 |
| 组织成员 | user.name | 岗位、系统权限、业务职责、绩效直属上级、状态 |

- [ ] **Step 4: Add position and personnel-review pagination**

Position directory keeps its existing full collection but derives `pagedItems` from `page`, `pageSize`, and the existing filtered items. Personnel reviews add `employeePage`, `departmentPage`, and `positionPage`, each with page size `10`; each loader passes its page to the existing API and each queue renders its own `ListPagination` after its results.

When an approve/reject action removes the last row of a non-first page, decrement that queue's page before reloading. Reset selections after every page load.

- [ ] **Step 5: Run the three focused specs and verify GREEN**

Run the Step 2 command.

Expected: all selected tests PASS, including body-column parity and mobile overflow assertions.

- [ ] **Step 6: Remove the old collapsible component after confirming no consumers remain**

Run: `rg -n "CollapsibleFilterPanel|展开筛选|收起筛选|周期筛选|指标筛选" web/src`

Expected: no UI consumer matches. Delete `CollapsibleFilterPanel.vue` and rerun the Step 2 tests.

- [ ] **Step 7: Commit the admin batch**

Stage only Task 3 files, run `git diff --cached --check`, and commit:

```text
style(admin): unify responsive directory lists
```

---

### Task 4: Reorganize calibration and paginate performance result workspaces

**Files:**
- Modify: `web/src/views/calibration/CalibrationView.vue`
- Modify: `web/src/views/approval/ApprovalView.vue`
- Modify: `web/src/views/publish/PublishView.vue`
- Modify: `web/src/views/task/DepartmentReviewListView.vue`
- Modify: `web/src/styles/performance-results.css`
- Modify: `web/e2e/specs/35-department-review-workflow.spec.ts`
- Modify: `web/e2e/specs/40-approval-pending.spec.ts`
- Modify: `web/e2e/specs/46-cycle-owner-calibration.spec.ts`
- Modify: `web/e2e/specs/48-performance-publication.spec.ts`
- Modify: `web/e2e/specs/50-performance-result-presentation.spec.ts`

**Interfaces:**
- Adds: `page`, `pageSize`, `pagedCandidates`, and filtered `total` to calibration and approval without changing API contracts.
- Preserves: `canCalibrate`, `canOperateTask`, selection rules, drawers, actions, and result presentation helpers.

- [ ] **Step 1: Add failing performance-result layout assertions**

Assert that department review contains neither `department-review-pending-total` nor a top `review-total`; its bottom pager contains total text even for one page. Assert calibration DOM order `calibration-cycle-summary` → `calibration-analysis` → `calibration-results` → `calibration-pagination`, and at 390px the results are cards with no page overflow. Approval and publication receive equivalent desktop/mobile result checks.

- [ ] **Step 2: Run the performance-result specs and verify RED**

Run: `npm run test:e2e -- e2e/specs/35-department-review-workflow.spec.ts e2e/specs/40-approval-pending.spec.ts e2e/specs/46-cycle-owner-calibration.spec.ts e2e/specs/48-performance-publication.spec.ts e2e/specs/50-performance-result-presentation.spec.ts`

Expected: FAIL on old department totals, missing calibration/approval pagination, and absent mobile cards.

- [ ] **Step 3: Rebuild the calibration hierarchy**

Keep the first card as a compact cycle summary. Replace the two-column chart/warning row with one `calibration-analysis` card containing the distribution chart, grade ratio grid, and a single `分布提醒` region. Keep the sentence “仅作校准参考，不阻止操作” as helper copy, not a card title.

Derive:

```ts
const page = ref(1);
const pageSize = ref(10);
const pagedCandidates = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return filteredCandidates.value.slice(start, start + pageSize.value);
});
```

Reset `page` when cycle, department, status, sort field, or sort order changes. Feed both the table and mobile cards from `pagedCandidates`. Add `ListPagination` after the result lists.

- [ ] **Step 4: Standardize the other three result lists**

Department review uses its existing server page, removes both top totals, and renders `ListPagination` whenever `total > 0`. Approval slices its filtered candidate array and adds matching mobile cards. Publication preserves server pagination and migrates its table/mobile/pager shell.

- [ ] **Step 5: Verify GREEN and responsive semantics**

Run the Step 2 command. Verify each spec reports zero failures at 1440px and 390px.

- [ ] **Step 6: Commit the performance-result batch**

Stage only Task 4 files, run `git diff --cached --check`, and commit:

```text
style(performance): clarify result workspaces on mobile
```

---

### Task 5: Finish task and report query results

**Files:**
- Modify: `web/src/views/task/components/TeamTaskList.vue`
- Modify: `web/src/views/reports/ReportsView.vue`
- Modify: `web/e2e/specs/10-team-performance-contract.spec.ts`
- Modify: `web/e2e/specs/18-dashboard-report-business-clarity.spec.ts`

**Interfaces:**
- Consumes: current-page task data and existing report computed collections.
- Adds: mobile result cards and bottom pagination to report people lists without paginating finite dimension summaries.

- [ ] **Step 1: Write failing mobile assertions**

At 390px, assert the team task table is hidden, task cards expose employee/status/current action, and the bottom pager remains usable. In reports, assert the personnel detail and each non-empty people-attention list use cards plus bottom pagination, while department and overdue-node summary tables retain their complete finite sets.

- [ ] **Step 2: Run the focused task/report specs and verify RED**

Run: `npm run test:e2e -- e2e/specs/10-team-performance-contract.spec.ts e2e/specs/18-dashboard-report-business-clarity.spec.ts`

Expected: FAIL because current mobile views still expose tables.

- [ ] **Step 3: Implement task cards and report people-list pagination**

Team cards show employee, department, cycle, current stage, and the same primary action as the table. Report personnel details keep the existing page state; A/C/D and consecutive-low-performance lists receive independent client page refs with page size `10`, page slices, mobile cards, and bottom `ListPagination`. Department-difference and overdue-node dimension tables remain unpaginated analysis summaries.

- [ ] **Step 4: Run the focused specs and verify GREEN**

Run the Step 2 command and confirm all selected tests PASS.

- [ ] **Step 5: Commit the task/report batch**

Stage only Task 5 files, run `git diff --cached --check`, and commit:

```text
style(reports): organize mobile people results
```

---

### Task 6: Full Web verification and main synchronization

**Files:**
- Verify all files changed in Tasks 1-5.

- [ ] **Step 1: Confirm scope and formatting**

Run:

```powershell
git status --short --branch
git diff --check
rg -n "CollapsibleFilterPanel|展开筛选|收起筛选|周期筛选|指标筛选" web/src
```

Expected: only intended task files are changed; the obsolete UI strings have no consumers.

- [ ] **Step 2: Run focused Playwright tests**

Run all specs named in Tasks 2-5 in one command. Expected: zero failures.

- [ ] **Step 3: Run static and production build checks**

Run:

```powershell
npm run type-check
npm run build
```

from `web`. Expected: exit code `0` for both; record non-blocking bundle warnings separately.

- [ ] **Step 4: Inspect generated-file noise and commit any final test-only adjustments**

Do not stage generated `components.d.ts` changes unless they are required by the new shared components. Run `git diff --cached --check` and verify the staged file list before each commit.

- [ ] **Step 5: Push direct-main commits**

Run `git fetch origin --prune`, confirm no remote divergence, then `git push origin main`. Verify `HEAD` equals `origin/main`.

---

### Task 7: Web-only production release

**Files:**
- Create ignored evidence under: `tmp/qa-query-list-mobile-20260909/release/`
- Do not modify tracked production configuration.

- [ ] **Step 1: Record the fresh production baseline**

Record external home and `/api/v1/health`, live Web image/revision/container, API/PostgreSQL/Redis/MinIO container IDs and images, Compose project, host `80:80`, and `ENABLE_TEST_QUICK_LOGIN=false` without printing secrets.

- [ ] **Step 2: Preserve rollback and build a candidate**

Tag the current Web image as `kayford-deploy-web:rollback-before-query-list-mobile-<timestamp>`. Build the committed `HEAD` as a candidate image labeled with its Git revision. Attach the candidate container to `kayford-deploy_external`.

- [ ] **Step 3: Run candidate UI verification**

Run focused authenticated mock-role Playwright checks against the candidate at 1440px and 390px for cycles, employees, department review, calibration, approval, publication, and one lifecycle page. Verify no redundant filter labels, mobile cards, bottom pagination, no page overflow, and the calibration analysis hierarchy.

- [ ] **Step 4: Promote and replace only Web**

Tag the verified candidate as `kayford-deploy-web:latest`, then recreate only Web using the formal `.env`, both Compose files, and project `kayford-deploy` with `--no-build --no-deps --force-recreate web`.

- [ ] **Step 5: Verify external production**

Confirm Web revision equals pushed `HEAD`, host mapping is `80:80`, external home and health succeed, JS/CSS hashes match the candidate, quick login is disabled, and API/PostgreSQL/Redis/MinIO IDs/images remain unchanged. Use an existing authenticated browser session only if available; otherwise report real-account business acceptance as unverified.

- [ ] **Step 6: Clean the temporary candidate container and retain rollback**

Validate the exact candidate name/revision before removal. Keep the rollback image and report its tag.
