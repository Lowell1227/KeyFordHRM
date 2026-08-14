# Manager Team Task Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a manager's bare `/tasks` entry open the actionable team goal-review queue while preserving employee and explicit deep-link behavior.

**Architecture:** Extend the existing authenticated global router guard with one narrowly-scoped canonical redirect after the current user has loaded. Protect the behavior through the real routed page contract so the test observes URL state and rendered scope rather than router internals.

**Tech Stack:** Vue 3, Vue Router 4, Pinia, TypeScript, Playwright.

## Global Constraints

- Apply the default only to `sysRole === 'manager'`.
- Apply the default only to route `MyTasks` with an empty query object.
- Canonical destination is `/tasks?scope=team&stage=goal-review&stageState=pending`.
- Preserve explicit personal/team links, employees, higher management roles, API contracts, and exact-manager authorization.
- Do not modify the database or backend.

---

### Task 1: Role-aware performance task entry

**Files:**
- Modify: `web/e2e/specs/11-navigation-entrypoints.spec.ts`
- Modify: `web/e2e/specs/05-multi-role-happy-path.spec.ts`
- Modify: `web/src/router/index.ts`

**Interfaces:**
- Consumes: authenticated `useAuthStore()` state, Vue Router `to.name` and `to.query`.
- Produces: a guard redirect to `{ name: 'MyTasks', query: { scope: 'team', stage: 'goal-review', stageState: 'pending' }, hash: to.hash, replace: true }` for the bare manager entry.

- [x] **Step 1: Write the failing routed-page regression test**

Add this manager test to `web/e2e/specs/11-navigation-entrypoints.spec.ts`:

```ts
test('bare manager performance entry opens team pending work without overriding explicit personal links', async ({ page }) => {
  await page.goto('/tasks');

  await expect(page).toHaveURL(/scope=team.*stage=goal-review.*stageState=pending/);
  await expect(page.getByTestId('task-scope-team')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('team-count-pending')).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/tasks?scope=mine');
  await expect(page).toHaveURL(/\/tasks\?scope=mine$/);
  await expect(page.getByTestId('task-scope-mine')).toHaveAttribute('aria-pressed', 'true');
});
```

This catches a missing role-aware default and an over-broad redirect that overrides explicit links.

- [x] **Step 2: Run the targeted test and verify RED**

Run:

```powershell
Set-Location web
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test 11-navigation-entrypoints.spec.ts --grep "bare manager performance entry"
```

Expected: FAIL because the first navigation remains `/tasks` with the personal scope selected.

- [x] **Step 3: Implement the minimal authenticated redirect**

In `web/src/router/index.ts`, after authentication loading/login checks and before the existing role authorization check, add:

```ts
if (
  to.name === 'MyTasks'
  && auth.user?.sysRole === 'manager'
  && Object.keys(to.query).length === 0
) {
  return {
    name: 'MyTasks',
    query: {
      scope: 'team',
      stage: 'goal-review',
      stageState: 'pending',
    },
    hash: to.hash,
    replace: true,
  };
}
```

- [x] **Step 4: Run the targeted test and verify GREEN**

Run the Step 2 command again.

Expected: PASS; the bare route is canonicalized and explicit `scope=mine` remains personal.

- [x] **Step 5: Run frontend regression verification**

Run:

```powershell
Set-Location web
npm run test:contracts
npm run type-check
npm run build
```

Expected: all contract tests pass, type-check exits 0, and the Vite production build exits 0.

- [x] **Step 6: Verify the real Zhou Qiang browser flow**

Using the running local stack, log in as `MGR001`, click the left-side “绩效” entry, and verify:

1. URL contains `scope=team`, `stage=goal-review`, and `stageState=pending`.
2. “团队绩效”“指标审核”“待处理” are selected.
3. The pending employee can be opened.
4. “保存指标修改”“通过指标审核”“驳回指标审核” are visible.
5. Refresh preserves the same route and selection without console errors.

- [x] **Step 7: Commit the focused change**

```powershell
git add -- web/src/router/index.ts web/e2e/specs/11-navigation-entrypoints.spec.ts web/e2e/specs/05-multi-role-happy-path.spec.ts docs/superpowers/plans/2026-08-15-manager-team-task-default.md
git commit -m "fix(web): open manager team pending tasks by default"
```
