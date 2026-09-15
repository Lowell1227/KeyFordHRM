# HRM Business List Full Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete stages 2–4 of the approved HRM business-list migration so every in-scope active list uses the shared page shell and every in-scope standalone workflow detail opens in a routed drawer.

**Architecture:** Reuse `BusinessListPage`, `BusinessDetailDrawer`, `SplitListLayout`, existing mobile cards, pagination, APIs, permission predicates, and business components. Apply two minimal transformations: legacy list roots become a typed shared shell; standalone workflow detail routes become children of their list route while the same detail component remains available through its legacy direct route.

**Tech Stack:** Vue 3, TypeScript, Vue Router, Element Plus, Playwright, Vite.

**Spec:** `docs/superpowers/specs/2026-09-15-business-list-page-templates-and-skill-design.md`

## Global Constraints

- Do not change API calls, request parameters, data scope, permissions, workflow statuses, button predicates, or production data.
- Keep Dashboard, Reports, CycleWorkspace, the team-performance workspace, and other dense non-list workspaces outside this migration.
- Use one `BusinessListPage` per migrated page surface; do not build a JSON/config-driven page engine.
- Keep confirmation/rejection and small-input interactions as dialogs; do not nest drawers.
- Desktop uses the existing table, mobile uses the existing `MobileResultCard` data and action predicates.
- Workflow detail URLs remain stable, and legacy direct-detail URLs remain readable.
- Each batch follows red → green → focused regression → commit.

## Migration Matrix

| Stage | Page | Variant | Required change |
|---|---|---|---|
| 2 | `InterviewListView.vue` | `record` | Shared page shell; replace its custom record drawer with `BusinessDetailDrawer` |
| 2 | `IndicatorLibraryView.vue` | `record` | Shared page shell; main create/edit form uses `BusinessDetailDrawer`; import dialog stays a dialog; route remains unchanged/absent |
| 2 | `TemplateManageView.vue` | `record` | Shared page shell; main create/edit/view form uses a wide business drawer; confirmations stay dialogs |
| 2 | `PositionDirectoryView.vue` | `record` | Shared page shell; create/edit form uses a standard business drawer |
| 3 | `ConfirmationApprovalView.vue` | `workflow` | Shared page shell plus routed detail drawer under `/confirmation-applications/approvals/:id` |
| 3 | `ConfirmationMineView.vue` | `workflow` | Shared page shell plus routed detail drawer under `/confirmation-applications/mine/:id` |
| 3 | shared `ProbationList.vue` | `workflow` | Shared page shell plus mode-specific routed detail drawers for manage/manager/mine |
| 3 | `ImprovementPlanListView.vue` | `workflow` | Shared page shell plus routed wide detail drawer under `/improvement-plans/:id` |
| 3 | `DepartmentReviewListView.vue` | `workflow` | Shared page shell plus routed detail drawer under `/department-review/:id`; preserve `/tasks/:id` |
| 3 | `ApprovalView.vue` | `workflow` | Shared page shell; preserve existing result drawer and approval predicates |
| 3 | `PublishView.vue` | `workflow` | Shared page shell; preserve existing result drawer and publish predicates |
| 3 | `CalibrationView.vue` | `workflow` | Shared page shell around the existing calibration list; do not turn the dense calibration workspace into a generic form |
| 4 | `UserManageView.vue` | `split-master` | Keep the existing shared split shell; verify organization, roster, archive, and draft-review regions remain inside it |
| 4 | `PersonnelReviewView.vue` | `workflow` | Add the shared page shell around `PersonnelPendingReviews`; keep its three existing review queues and dialogs |

---

### Task 1: Define the full migration contracts

**Files:**
- Create: `web/e2e/specs/57-business-list-full-migration.spec.ts`
- Modify: `web/e2e/specs/52-improvement-plan-workflow.spec.ts`

**Interfaces:**
- Consumes: `data-testid="business-list-page"`, `data-list-variant`, `data-testid="business-detail-drawer"`, stable Vue Router paths.
- Produces: browser contracts that fail when a migrated page loses its shell, mobile layout, or routed drawer behavior.

- [ ] **Step 1: Write the failing list-shell test**

Create route cases with literal expected variants and matching role state:

```ts
const cases = [
  ['manager', '/interviews', 'record'],
  ['hr', '/templates', 'record'],
  ['admin', '/positions', 'record'],
  ['approver', '/approval', 'workflow'],
  ['hr', '/calibration', 'workflow'],
  ['hr', '/publish', 'workflow'],
  ['hr', '/personnel-change-reviews', 'workflow'],
  ['hr', '/probation-reviews/manage', 'workflow'],
  ['manager', '/probation-reviews/manager', 'workflow'],
  ['employee', '/probation-reviews/mine', 'workflow'],
  ['approver', '/confirmation-applications/approvals', 'workflow'],
  ['employee', '/confirmation-applications/mine', 'workflow'],
  ['employee', '/improvement-plans', 'workflow'],
] as const;
```

For each case, open a browser context from `e2e/auth-state/<role>.json`, navigate, and assert the real `BusinessListPage` has the literal variant. At 390×844 assert no document/body horizontal overflow.

- [ ] **Step 2: Write the failing improvement routed-drawer test**

Extend the existing complete improvement-plan fixtures. Navigate to `/improvement-plans`, click the first visible `查看`, then assert:

```ts
await expect(page).toHaveURL(/\/improvement-plans\/[^/]+$/);
await expect(page.getByTestId('business-detail-drawer')).toHaveAttribute('data-drawer-variant', 'workflow');
await page.goBack();
await expect(page.getByTestId('business-detail-drawer')).toBeHidden();
await expect(page.getByTestId('business-list-page')).toBeVisible();
```

- [ ] **Step 3: Run the tests and verify RED**

Run:

```powershell
$env:CI='1'
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5175'
$env:PLAYWRIGHT_API_BASE_URL='http://127.0.0.1:3000/api/v1'
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npm run test:e2e -- 57-business-list-full-migration.spec.ts 52-improvement-plan-workflow.spec.ts
```

Expected: the new shell cases fail because the target pages have no `business-list-page`, and the improvement detail fails because the list unmounts into a standalone page.

- [ ] **Step 4: Commit the red contracts**

```powershell
git add web/e2e/specs/57-business-list-full-migration.spec.ts web/e2e/specs/52-improvement-plan-workflow.spec.ts
git commit -m "test(web): define full business list migration"
```

### Task 2: Migrate stage 2 record pages

**Files:**
- Modify: `web/src/views/interview/InterviewListView.vue`
- Modify: `web/src/views/admin/IndicatorLibraryView.vue`
- Modify: `web/src/views/admin/TemplateManageView.vue`
- Modify: `web/src/views/admin/PositionDirectoryView.vue`

**Interfaces:**
- Consumes: `BusinessListPage` with `variant="record"`; `BusinessDetailDrawer` with `standard` or `wide`.
- Produces: the same filters, table rows, mobile cards, pagination, list actions, request parameters, and mutations inside the shared visual contract.

- [ ] **Step 1: Wrap each page with `BusinessListPage`**

Import the shared shell and replace only the outer root:

```vue
<BusinessListPage variant="record" :loading="loading">
  <template #workspace>
    <!-- existing header, filters, table/mobile list, pagination, and overlays unchanged -->
  </template>
</BusinessListPage>
```

Use each page's existing loading ref (`loading` or `listLoading`). Do not duplicate the page title or result card.

- [ ] **Step 2: Replace primary create/edit overlays**

- Interview: replace the outer `el-drawer` with `BusinessDetailDrawer variant="standard"`; keep `InterviewDrawer` as the form body.
- Indicator library: replace the main create/edit `el-dialog` with `BusinessDetailDrawer variant="wide"`; keep the import dialog unchanged.
- Template management: replace the main create/edit/view `el-dialog` with `BusinessDetailDrawer variant="wide"`; keep deletion confirmations unchanged.
- Position directory: replace its create/edit `el-dialog` with `BusinessDetailDrawer variant="standard"`.

Keep each existing `v-model`, save/loading flag, field validation, and footer buttons.

- [ ] **Step 3: Run the record-page cases**

Run the route cases for `/interviews`, `/templates`, and `/positions`, plus the existing indicator/template/position/interview focused specs found by `rg -l "IndicatorLibrary|TemplateManage|PositionDirectory|/interviews" web/e2e/specs`.

- [ ] **Step 4: Commit stage 2**

```powershell
git add web/src/views/interview/InterviewListView.vue web/src/views/admin/IndicatorLibraryView.vue web/src/views/admin/TemplateManageView.vue web/src/views/admin/PositionDirectoryView.vue
git commit -m "feat(web): migrate record list pages"
```

### Task 3: Add routed workflow drawers

**Files:**
- Modify: `web/src/router/routes.ts`
- Modify: `web/src/views/improvement-plans/ImprovementPlanListView.vue`
- Modify: `web/src/views/improvement-plans/ImprovementPlanDetailView.vue`
- Modify: `web/src/views/confirmation/ConfirmationApprovalView.vue`
- Modify: `web/src/views/confirmation/ConfirmationMineView.vue`
- Modify: `web/src/views/probation/components/ProbationList.vue`
- Modify: `web/src/views/probation/ProbationDetailView.vue`
- Modify: `web/src/views/task/DepartmentReviewListView.vue`
- Modify: `web/src/views/task/TaskDetailView.vue`

**Interfaces:**
- Consumes: `BusinessDetailDrawer`, `RouterView`, existing detail components and `route.params.id`.
- Produces: child route names `ImprovementPlanDrawerDetail`, `ConfirmationApprovalDetail`, `ConfirmationMineDetail`, `ProbationManageDetail`, `ProbationManagerDetail`, `ProbationMineDetail`, and `DepartmentReviewDetail`.

- [ ] **Step 1: Register child routes**

Move the active `/improvement-plans/:id` detail into the `/improvement-plans` children while keeping a legacy alias route if needed. Add `:id` children to confirmation approval/mine, probation manage/manager/mine, and department review. Each child imports the existing detail view, passes `props: { embedded: true }`, and sets `activeNavigationPath` to its parent list.

- [ ] **Step 2: Add the shared workflow drawer controller**

In each list or shared list component, derive `detailOpen` from the child route name, remember whether navigation started from the list, push to the child name, use `router.back()` when opened locally, and `router.replace()` to the parent when directly loaded. Render:

```vue
<BusinessDetailDrawer
  :model-value="detailOpen"
  title="业务详情"
  variant="workflow"
  @update:model-value="handleDetailVisibility"
>
  <RouterView v-slot="{ Component }">
    <component :is="Component" @changed="loadList" />
  </RouterView>
</BusinessDetailDrawer>
```

- [ ] **Step 3: Make detail pages embeddable**

Add `embedded?: boolean` props to improvement, probation, and task detail views. Hide only their standalone back-navigation/header chrome when embedded; keep all API reads, allowed-action calculations, writes, dialogs, history, and validation unchanged. Emit `changed` after existing successful writes so the parent refreshes only its current list.

- [ ] **Step 4: Run routed-drawer tests**

Run the improvement contract, existing confirmation drawer contract, probation focused specs, and department-review focused specs. Cover direct URL, row open, browser back, mobile full width, and unchanged action visibility.

- [ ] **Step 5: Commit routed drawers**

```powershell
git add web/src/router/routes.ts web/src/views/improvement-plans web/src/views/confirmation web/src/views/probation web/src/views/task/DepartmentReviewListView.vue web/src/views/task/TaskDetailView.vue web/e2e/specs
git commit -m "feat(web): open workflow details in routed drawers"
```

### Task 4: Migrate remaining stage 3 workflow list shells

**Files:**
- Modify: `web/src/views/approval/ApprovalView.vue`
- Modify: `web/src/views/publish/PublishView.vue`
- Modify: `web/src/views/calibration/CalibrationView.vue`

**Interfaces:**
- Consumes: `BusinessListPage variant="workflow"`.
- Produces: the same existing result drawers, query state, selection, role predicates, and requests inside a consistent page root.

- [ ] **Step 1: Replace only the outer page roots**

Use the `workspace` slot so dense page-specific cards and already-working result drawers stay intact:

```vue
<BusinessListPage variant="workflow" :loading="loading">
  <template #workspace>
    <!-- existing page contents -->
  </template>
</BusinessListPage>
```

- [ ] **Step 2: Verify role and mobile behavior**

Run the existing approval, publish, calibration, result-retention, 1440px, 1024px, and 390px specs. Confirm selection and batch actions still use their existing permission predicates.

- [ ] **Step 3: Commit remaining workflow shells**

```powershell
git add web/src/views/approval/ApprovalView.vue web/src/views/publish/PublishView.vue web/src/views/calibration/CalibrationView.vue
git commit -m "feat(web): migrate workflow list shells"
```

### Task 5: Complete stage 4 personnel lists

**Files:**
- Modify: `web/src/views/admin/PersonnelReviewView.vue`
- Verify without restructuring: `web/src/views/admin/UserManageView.vue`
- Test: `web/e2e/specs/57-business-list-full-migration.spec.ts`

**Interfaces:**
- Consumes: existing `UserManageView` `split-master` shell and `PersonnelPendingReviews` permission props.
- Produces: one workflow shell for the personnel-review route without changing its employee/department/position review queues.

- [ ] **Step 1: Wrap personnel review**

Import `BusinessListPage` and replace `personnel-review-page` with:

```vue
<BusinessListPage variant="workflow" :loading="false" class="personnel-review-page">
  <template #workspace>
    <PersonnelPendingReviews
      :can-review-employee="canReviewEmployee"
      :can-review-department="canReviewDepartment"
      :can-review-position="canReviewPosition"
    />
  </template>
</BusinessListPage>
```

- [ ] **Step 2: Verify the existing split-master page**

Use `/organization` and `/users` at 1440×900 and 390×844. Assert the department scope remains left-side on desktop and opens as a full-width range drawer on mobile; verify roster, archived employees, and draft review tabs still render under the single existing shell.

- [ ] **Step 3: Commit stage 4**

```powershell
git add web/src/views/admin/PersonnelReviewView.vue web/e2e/specs/57-business-list-full-migration.spec.ts
git commit -m "feat(web): complete personnel list migration"
```

### Task 6: Full verification, integration, and Web-only release

**Files:**
- Modify: `docs/ui/business-list-page-standard.md`
- Create in release snapshot: `release-manifest.json`

**Interfaces:**
- Consumes: all prior commits and production Web-only release procedure.
- Produces: a clean `main`, matching `origin/main`, a revision-labelled Web image, rollback tag, and production evidence.

- [ ] **Step 1: Update the migration status**

Change the standard's representative-page wording to an explicit completed-page matrix. Keep excluded complex workspaces named so “all stages” cannot be misread as “every Vue file”.

- [ ] **Step 2: Run engineering verification**

```powershell
npm run type-check
npm run build
npm run test:e2e -- 06-role-page-smoke.spec.ts 51-performance-query-filters.spec.ts 52-improvement-plan-workflow.spec.ts 56-business-list-page-templates.spec.ts 57-business-list-full-migration.spec.ts
git diff --check main...HEAD
```

Also run focused specs discovered for confirmation, probation, department review, approval, publish, calibration, interview, templates, indicators, positions, and personnel review. Report unrelated historical failures separately; do not weaken assertions.

- [ ] **Step 3: Review and integrate**

Inspect the complete diff for API, permission, and request changes. Merge the reviewed branch into the current leading `main` only after checking `main`, `origin/main`, unmerged branches, and all worktrees. Push and verify local, tracking, and remote hashes match.

- [ ] **Step 4: Release only Web**

Create a detached release snapshot from the pushed commit, copy the formal `.env` without printing it, tag the current Web image for rollback, build a revision-labelled candidate, attach it to `kayford-deploy_external`, and smoke-test homepage, `/api/v1/health`, and all three template markers.

Replace only Web with both Compose files, the formal environment, project `kayford-deploy`, `--no-build --no-deps --force-recreate web`. Roll back immediately if external home, health, assets, or target behavior fail.

- [ ] **Step 5: Record final evidence**

The release manifest records commit, image IDs, rollback tag, unchanged API/PostgreSQL/Redis/MinIO container IDs, quick-login state, focused test counts, external health, production asset hashes, and any remaining signed-in role-acceptance limit.
