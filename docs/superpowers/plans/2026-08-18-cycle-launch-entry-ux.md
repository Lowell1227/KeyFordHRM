# Cycle Launch Entry UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cycle creation entry explain the launch sequence, provide an actionable empty state, and keep advanced configuration compact.

**Architecture:** Keep orchestration in `CycleManageView.vue` and reuse the current cycle APIs. Add one isolated Playwright contract spec for user-visible behavior; no API, state-machine, permission, or route changes are required.

**Tech Stack:** Vue 3, TypeScript, Element Plus, Playwright.

## Global Constraints

- Preserve `POST /cycles`, preflight, launch, schedule, permissions, and route behavior.
- Preserve existing unsaved-change confirmation and mobile card behavior.
- Do not overwrite unrelated dirty worktree changes.
- Use test-first red/green cycles and run web type-check and build serially on Windows.

---

### Task 1: Actionable empty state

**Files:**
- Modify: `web/src/views/admin/CycleManageView.vue`
- Create: `web/e2e/specs/17-cycle-launch-entry-ux.spec.ts`
- Modify: `web/playwright.contract.config.ts`

**Interfaces:**
- Consumes: `statusGroup`, `statusFilter`, `typeFilter`, `keyword`, `cycles`, and `listLoading`.
- Produces: computed empty-state copy and create/reset actions without changing list APIs.

- [ ] **Step 1: Write the failing empty-state test**

```ts
test('replaces an empty pending table with a launch-oriented action', async ({ page }) => {
  await mockCycleLaunchPage(page, { cycles: [] });
  await page.goto('/cycles?group=attention');
  await expect(page.getByTestId('cycle-empty-state')).toContainText('暂无待发起周期');
  await expect(page.getByTestId('cycle-empty-create')).toBeVisible();
  await expect(page.locator('.app-pager')).toHaveCount(0);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx playwright test --config playwright.contract.config.ts e2e/specs/17-cycle-launch-entry-ux.spec.ts --grep "empty pending"`

Expected: FAIL because `cycle-empty-state` does not exist.

- [ ] **Step 3: Implement the empty state**

Import `EmptyState`, change the attention label to `待发起`, render the table and pager only when data exists or is loading, and render the business empty state otherwise. When filters are active, show “没有符合筛选条件的周期” and a reset action instead of the create action.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2. Expected: PASS.

### Task 2: Clarify basic creation and scope

**Files:**
- Modify: `web/src/views/admin/CycleManageView.vue`
- Test: `web/e2e/specs/17-cycle-launch-entry-ux.spec.ts`

**Interfaces:**
- Consumes: current `createForm`, `buildCreateBody()`, and department list.
- Produces: `participantScope: 'all' | 'departments'`, explicit validation, four-node timeline, and clearer CTA copy.

- [ ] **Step 1: Write the failing creation-flow test**

```ts
test('explains the preflight step and makes company scope explicit', async ({ page }) => {
  await mockCycleLaunchPage(page, { cycles: [] });
  await page.goto('/cycles?group=attention');
  await page.getByTestId('cycle-create').click();
  await expect(page.getByRole('dialog', { name: '创建绩效周期 · 基本信息' })).toBeVisible();
  await expect(page.getByTestId('cycle-scope-all')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('cycle-plan-summary')).toContainText('周期开始');
  await expect(page.getByTestId('cycle-create-and-check')).toHaveText('下一步：开放检查');
  await expect(page.getByTestId('cycle-create-impact-hint')).toContainText('不会立即通知员工');
});
```

- [ ] **Step 2: Run the test and verify RED**

Expected: FAIL on the dialog title and scope selector.

- [ ] **Step 3: Implement explicit scope and timeline**

Add `participantScope` to the reactive form, clear department IDs when switching to all-company scope, and validate that department scope contains at least one ID. Replace the success alert with an information alert and render goal opening, period start, period end, and self-evaluation opening in the summary. Rename the CTA and add the no-notification hint.

- [ ] **Step 4: Verify GREEN and payload behavior**

Add a second assertion that selecting `指定部门`, choosing `销售部`, and saving produces `participantDeptIds: ['sales']`; run the focused spec and expect PASS.

### Task 3: Group advanced settings and preserve actions

**Files:**
- Modify: `web/src/views/admin/CycleManageView.vue`
- Test: `web/e2e/specs/17-cycle-launch-entry-ux.spec.ts`

**Interfaces:**
- Consumes: existing advanced fields and default time-generation logic.
- Produces: four collapsible groups, summaries, default-plan restoration, and sticky dialog chrome.

- [ ] **Step 1: Write the failing advanced-settings test**

```ts
test('keeps four advanced groups collapsed with useful summaries', async ({ page }) => {
  await mockCycleLaunchPage(page, { cycles: [] });
  await page.goto('/cycles?group=attention');
  await page.getByTestId('cycle-create').click();
  await page.getByTestId('cycle-create-advanced').click();
  await expect(page.getByTestId('cycle-advanced-participants')).toContainText('全公司');
  await expect(page.getByTestId('cycle-advanced-schedule')).toContainText('默认计划');
  await expect(page.getByTestId('cycle-advanced-grades')).toContainText('A 20%');
  await expect(page.getByTestId('cycle-advanced-publication')).toContainText('4 项可见');
});
```

- [ ] **Step 2: Run the test and verify RED**

Expected: FAIL because grouped headers do not exist.

- [ ] **Step 3: Implement grouped disclosure**

Use `el-collapse` with `participants`, `schedule`, `grades`, and `publication`. Keep each body unchanged where possible, add concise computed summaries, add a schedule reset action, and style the dialog body to scroll while header/footer remain visible.

- [ ] **Step 4: Run focused and existing cycle contracts**

Run:

```powershell
npx playwright test --config playwright.contract.config.ts e2e/specs/17-cycle-launch-entry-ux.spec.ts
npx playwright test --config playwright.contract.config.ts e2e/specs/14-cycle-management-compact.spec.ts e2e/specs/17-cycle-launch-entry-ux.spec.ts
```

Expected: all tests pass.

### Task 4: Final verification

**Files:**
- Verify only.

**Interfaces:**
- Consumes: complete implementation.
- Produces: build and interaction evidence.

- [ ] **Step 1: Run static checks and build serially**

```powershell
npm run type-check
npm run build
```

Expected: both exit with code 0.

- [ ] **Step 2: Run the 390px contract and inspect the page**

Run the responsive test from the focused cycle specs, then verify the empty state, basic form, and expanded advanced groups in the browser. Confirm no horizontal overflow and a visible footer.

- [ ] **Step 3: Review the diff boundary**

Run `git diff --check` and confirm only the cycle launch UX, its isolated test, the contract test registration, and these documents belong to this change.
