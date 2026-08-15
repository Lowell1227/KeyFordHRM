# Manager Task Filter Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the redundant team-search button and present search, department, employee, and reset controls as a compact responsive toolbar visually connected to the task list.

**Architecture:** Keep the existing `TaskListView` handlers and URL query contract. Change only the team filter markup and scoped CSS, then protect the behavior and geometry with the existing Playwright specs.

**Tech Stack:** Vue 3, Element Plus, scoped CSS, Playwright, TypeScript.

## Global Constraints

- Work directly on `main`; do not create a branch or worktree.
- Do not run a broad pre-implementation audit; use focused red-green checks.
- Enter submits search, clearing submits the empty keyword, and ordinary typing makes no request.
- Department and employee changes retain the current URL and selection-clearing behavior.
- No backend, database, authorization, or task-state changes.
- Preserve the stacked manager navigation implemented in `3e32800`.

---

### Task 1: Compact team filter toolbar

**Files:**
- Modify: `web/e2e/specs/10-team-performance-contract.spec.ts:598-650`
- Modify: `web/e2e/specs/11-navigation-entrypoints.spec.ts:663-721`
- Modify: `web/src/views/task/TaskListView.vue:1266-1351,1736-1808,1899-1995`
- Create: `docs/superpowers/plans/2026-08-15-manager-task-filter-layout.md`

**Interfaces:**
- Consumes: `teamKeyword`, `applyTeamSearch()`, `setTeamDepartment()`, `setTeamEmployee()`, `resetTeamFilters()`.
- Produces: the existing `team-workspace-filters`, `team-keyword-filter`, `team-department-filter`, and `team-employee-filter` test boundaries with no separate submit button.

- [x] **Step 1: Write failing behavior and layout assertions**

In the first team-workspace contract, assert the toolbar owns only the input, selects, and reset action:

```ts
await expect(filters.getByRole('button', { name: '搜索', exact: true })).toHaveCount(0);
await expect(filters.locator('.team-search-control > span')).toHaveCount(0);
await expect(filters.locator('.team-filter-control > span')).toHaveCount(0);
```

Keep the existing real Enter-search assertion:

```ts
await page.getByTestId('team-keyword-filter').fill('Ada');
await page.getByTestId('team-keyword-filter').press('Enter');
await expect(page).toHaveURL(/keyword=Ada/);
```

Extend the 390px layout assertion to require the search and both selects to occupy the available toolbar width without document overflow.

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
Set-Location web
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test --config playwright.contract.config.ts e2e/specs/10-team-performance-contract.spec.ts --grep "team list exposes filters"
npx playwright test e2e/specs/11-navigation-entrypoints.spec.ts --grep "manager task navigation stays stacked"
```

Expected: the first command fails because the visible labels and search button still exist; the responsive assertion fails against the old flex layout if it does not fill the row consistently.

- [x] **Step 3: Implement the minimal template change**

In `TaskListView.vue`:

- remove the visible `<span>` labels from the search, department, and employee controls;
- remove the standalone primary search button;
- retain `aria-label`, placeholders, `@keyup.enter="applyTeamSearch"`, and `@clear="applyTeamSearch"`;
- retain the current select `@change` handlers and reset icon button.

- [x] **Step 4: Implement the compact responsive layout**

Use a grid toolbar with these behaviors:

```css
.team-toolbar {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(150px, 180px) minmax(170px, 200px) 32px;
  gap: 8px;
}
```

- regular width: all four controls share one row;
- container width at or below 760px: search spans the first row, selects share the next row, reset remains compact;
- container width at or below 520px: search and selects each span the full row and reset aligns right;
- reduce the gap between filters and `TeamTaskList`, align their horizontal edges, and keep document overflow at zero.

- [x] **Step 5: Run focused tests and verify GREEN**

Run the commands from Step 2 and confirm both pass.

- [x] **Step 6: Run focused completion checks**

Run:

```powershell
Set-Location web
npm run test:contracts
npm run type-check
npm run build
```

Do not run the complete 199-test E2E suite unless a focused failure requires it.

- [x] **Step 7: Verify the real Zhou Qiang page**

At desktop and 390px widths, verify:

- no standalone search button or visible field labels;
- Enter and clear update the list;
- filters align and wrap as designed;
- the filter panel and member list form a coherent work area;
- Zhang Chen's pending review remains openable and actionable;
- no new console errors.

- [x] **Step 8: Commit the focused implementation on `main`**

```powershell
git add -- web/src/views/task/TaskListView.vue web/e2e/specs/10-team-performance-contract.spec.ts web/e2e/specs/11-navigation-entrypoints.spec.ts docs/superpowers/plans/2026-08-15-manager-task-filter-layout.md
git commit -m "fix(web): simplify manager task filters"
```
