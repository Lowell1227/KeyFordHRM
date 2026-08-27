# Cycle Scope Exclusions and Draft Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. In this session, use `superpowers:executing-plans` unless the user explicitly requests delegated or parallel agent work.

**Goal:** Add department-based exclusions to performance-cycle scope, correct department headcount summaries, and make draft-cycle editing and deletion directly accessible from both the list and detail view.

**Architecture:** Extend the existing cycle participant snapshot with an additive PostgreSQL UUID-array field named `explicitExemptDeptIds`. The API persists and hashes that array and the launch service resolves department exemptions before automatic exemption rules. The Vue scope picker keeps included and excluded department selections distinct, derives estimated headcount from active organization nodes, and sends the complete snapshot through the existing create/update-draft flow. Draft actions remain routed through the existing edit dialog and guarded delete flow.

**Tech Stack:** Vue 3, TypeScript, Element Plus, Pinia/API client, Playwright, NestJS, Prisma, PostgreSQL, Jest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-27-cycle-scope-exclusions-and-draft-editing-design.md`

**Global Constraints:**

- Use the roster-backed HRM organization as the department/person source; do not introduce DingTalk organization synchronization.
- Parent-department selection covers every checked descendant department using the existing cascading tree behavior.
- Included and excluded department IDs must not overlap after any drawer confirmation.
- Existing cycle records remain valid; `explicitExemptDeptIds` defaults to an empty JSON array.
- Keep the controlled test-account quick-login switch enabled throughout the current acceptance period.
- Do not launch, delete, or mutate real production cycles during automated or smoke verification.
- Preserve the newest live Git/image baseline and retain rollback tags before release.

---

## Task 1: Persist department exclusions on cycle drafts

**Files:**

- Modify: `api/prisma/schema.prisma`
- Create: `api/prisma/migrations/20260827143000_add_cycle_exempt_departments/migration.sql`
- Modify: `api/src/cycles/dto/create-cycle.dto.ts`
- Modify: `api/src/cycles/cycles.service.ts`
- Test: `api/src/cycles/cycles.service.spec.ts`

### Step 1: Write failing create and update assertions

Add a stable department UUID fixture to `cycles.service.spec.ts` and extend the service tests with these assertions:

```ts
const exemptDeptId = 'c134b614-5d97-4f1c-a72e-0afc6d12eb99';

expect(prisma.assessmentCycle.create).toHaveBeenCalledWith(
  expect.objectContaining({
    data: expect.objectContaining({
      explicitExemptDeptIds: [exemptDeptId],
    }),
  }),
);

expect(prisma.assessmentCycle.update).toHaveBeenCalledWith(
  expect.objectContaining({
    data: expect.objectContaining({
      explicitExemptDeptIds: [exemptDeptId],
    }),
  }),
);
```

Call `create()` and `updateDraft()` with `explicitExemptDeptIds: [exemptDeptId]` so the tests exercise both persistence paths.

### Step 2: Run the focused test and confirm the failure

Run from `api`:

```powershell
npm test -- cycles/cycles.service.spec.ts --runInBand
```

Expected: the new assertions fail because `explicitExemptDeptIds` is absent from the Prisma create/update data.

### Step 3: Add the database field and migration

Add this field beside the existing participant/exemption arrays in `AssessmentCycle`:

```prisma
explicitExemptDeptIds String[] @default([]) @map("explicit_exempt_dept_ids") @db.Uuid
```

Create the additive migration:

```sql
ALTER TABLE "assessment_cycles"
ADD COLUMN "explicit_exempt_dept_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
```

The existing Prisma model and prior cycle migrations map this model to the exact table name `assessment_cycles` used above.

### Step 4: Extend the DTO and persistence mapping

Add to `CreateCycleDto`:

```ts
@IsOptional()
@IsArray()
@IsUUID('4', { each: true })
explicitExemptDeptIds?: string[];
```

In `CyclesService.create`, persist an empty array when omitted:

```ts
explicitExemptDeptIds: dto.explicitExemptDeptIds ?? [],
```

In `CyclesService.updateDraft`, update only when the request defines the field, matching the existing participant array behavior:

```ts
...(dto.explicitExemptDeptIds !== undefined && {
  explicitExemptDeptIds: dto.explicitExemptDeptIds,
}),
```

### Step 5: Regenerate Prisma types and pass the focused checks

Run from `api`:

```powershell
npx prisma validate
npx prisma generate
npm test -- cycles/cycles.service.spec.ts --runInBand
npm run build
```

Expected: schema validation, Prisma generation, the focused suite, and API build all pass.

### Step 6: Commit the persistence slice

```powershell
git add api/prisma/schema.prisma api/prisma/migrations/20260827143000_add_cycle_exempt_departments/migration.sql api/src/cycles/dto/create-cycle.dto.ts api/src/cycles/cycles.service.ts api/src/cycles/cycles.service.spec.ts
git commit -m "feat(cycles): persist exempt departments"
```

---

## Task 2: Apply department exclusions during preflight and launch

**Files:**

- Modify: `api/src/cycles/launch.service.ts`
- Test: `api/src/cycles/launch.service.spec.ts`

### Step 1: Write failing department-exemption tests

Add `explicitExemptDeptIds: []` to the shared cycle fixture so every test uses the full persisted contract. Add a test that sets:

```ts
cycle.explicitExemptDeptIds = [candidate.deptId];
```

Run preflight or build the launch plan and assert that the matching candidate is exempt with this explicit business reason:

```ts
expect(plan.exemptions).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      userId: candidate.id,
      reason: 'HR 按部门设置为本周期豁免',
    }),
  ]),
);
```

Add a custom-scope query test proving excluded departments are included in the candidate query even when they are not participant departments:

```ts
expect(prisma.user.findMany).toHaveBeenCalledWith(
  expect.objectContaining({
    where: expect.objectContaining({
      OR: expect.arrayContaining([
        { deptId: { in: [candidate.deptId] } },
      ]),
    }),
  }),
);
```

Add a plan-hash test that changes only `explicitExemptDeptIds` and expects a different hash. This protects idempotency and auditability.

### Step 2: Run the focused launch suite and confirm the failures

Run from `api`:

```powershell
npm test -- cycles/launch.service.spec.ts --runInBand
```

Expected: the new reason/query/hash assertions fail because the launch snapshot does not yet read department exclusions.

### Step 3: Extend launch types and candidate discovery

Add `explicitExemptDeptIds: string[]` to every local cycle shape used by `findCandidates`, `buildLaunchPlan`, and `resolveExemption`.

For custom scope, include excluded departments in the candidate `OR` list:

```ts
...(cycle.explicitExemptDeptIds.length > 0
  ? [{ deptId: { in: cycle.explicitExemptDeptIds } }]
  : []),
```

Do not treat department exclusions as positive participant scope when deciding whether the cycle is custom; `hasScopedParticipants` continues to depend only on included departments/users.

### Step 4: Resolve explicit department exemptions

Before the explicit-person and automatic exemption checks, add:

```ts
if (
  candidate.deptId &&
  cycle.explicitExemptDeptIds.includes(candidate.deptId)
) {
  return {
    isExempt: true,
    reason: 'HR 按部门设置为本周期豁免',
  };
}
```

The explicit person check remains in place so a user exclusion works independently of department membership.

### Step 5: Include exclusions in the canonical launch plan

Add the sorted array to the plan payload before hashing:

```ts
explicitExemptDeptIds: [...cycle.explicitExemptDeptIds].sort(),
```

This ensures replay detection changes when HR changes the department exclusions.

### Step 6: Pass launch and regression checks

Run from `api`:

```powershell
npm test -- cycles/launch.service.spec.ts cycles/cycles.service.spec.ts --runInBand
npm run build
```

Expected: both suites and the API build pass.

### Step 7: Commit the launch slice

```powershell
git add api/src/cycles/launch.service.ts api/src/cycles/launch.service.spec.ts
git commit -m "feat(cycles): apply department exclusions at launch"
```

---

## Task 3: Add department exclusion selection and accurate headcount summaries

**Files:**

- Modify: `web/src/types/api.types.ts`
- Modify: `web/src/views/admin/components/CycleParticipantScopePicker.vue`
- Modify: `web/src/views/admin/CycleManageView.vue`
- Test: `web/e2e/specs/17-cycle-launch-entry-ux.spec.ts`

### Step 1: Update mocked contracts and write failing browser assertions

Extend the mocked cycle/API bodies with:

```ts
explicitExemptDeptIds: [],
```

Replace the all-company expectation that only people can be excluded with acceptance coverage for both tabs:

```ts
await expect(scopeDrawer.getByRole('tab', { name: '排除部门' })).toBeVisible();
await expect(scopeDrawer.getByRole('tab', { name: '排除人员' })).toBeVisible();
```

Select a parent organization and assert its checked descendants appear in the submitted `explicitExemptDeptIds`. Assert the visible all-company summary follows this shape:

```ts
await expect(scopeSummary).toContainText('全公司');
await expect(scopeSummary).toContainText('排除 2 个部门');
await expect(scopeSummary).toContainText('预计');
```

For custom scope, select the fixture department whose `directMemberCount` is nonzero and assert that the summary no longer reports zero employees:

```ts
await expect(scopeSummary).toContainText('1 个部门（预计 8 人）');
await expect(scopeSummary).toContainText('另选 0 人');
```

Also cover reopening an existing draft and verifying both excluded department/person selections are restored.

### Step 2: Run the focused browser spec and confirm the failures

Start the isolated web development server using the existing test command convention, then run:

```powershell
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test e2e/specs/17-cycle-launch-entry-ux.spec.ts
```

Expected: the new tab, payload, persisted-selection, and estimated-headcount assertions fail.

### Step 3: Extend TypeScript API contracts

Add to both `AssessmentCycle` and `CreateCycleBody` in `api.types.ts`:

```ts
explicitExemptDeptIds: string[];
```

If `CreateCycleBody` keeps optional fields, make this field optional there while keeping the persisted cycle response non-optional.

### Step 4: Extend the scope-picker contract

Add this prop and emit:

```ts
excludedDepartmentIds: string[];

(event: 'update:excludedDepartmentIds', value: string[]): void;
```

Use four explicit tab keys so included/excluded trees never share draft state:

```ts
type ScopeTab =
  | 'includedDepartments'
  | 'includedUsers'
  | 'excludedDepartments'
  | 'excludedUsers';
```

In all-company mode render `排除部门` and `排除人员`. In custom mode render `按部门`、`按人员`、`排除部门`、`排除人员`.

Use distinct `includedDepartmentTreeRef` and `excludedDepartmentTreeRef`. On drawer open, seed each tree from its own prop. On confirmation, use `getCheckedKeys(false)` so the existing cascading tree records the parent and checked descendants.

### Step 5: Prevent included/excluded overlap

When confirming included departments, remove those checked IDs from the excluded draft. When confirming excluded departments, remove those checked IDs from the included draft. Apply the same protection when initial props contain an overlap, preferring the most recently confirmed user choice.

The emitted arrays must be unique and stable:

```ts
const uniqueIds = (ids: string[]) => [...new Set(ids)];
```

### Step 6: Compute estimated department headcount

Flatten the active organization tree into an ID map and sum `directMemberCount` only for checked IDs:

```ts
const departmentById = computed(() => {
  const result = new Map<string, Department>();
  const visit = (items: Department[]) => {
    for (const item of items) {
      result.set(item.id, item);
      visit(item.children ?? []);
    }
  };
  visit(props.departments);
  return result;
});

const countDirectMembers = (ids: string[]) =>
  ids.reduce(
    (total, id) => total + (departmentById.value.get(id)?.directMemberCount ?? 0),
    0,
  );
```

This deliberately avoids summing `memberCount`, which would double-count descendants when the tree records both parent and child IDs.

Render the confirmed summaries as:

```text
自定义 · 1 个部门（预计 8 人） · 另选 0 人
全公司 · 排除 2 个部门（预计 18 人） · 另排除 1 人
```

Counts are estimates from the currently active roster organization and do not replace launch-time eligibility checks.

### Step 7: Wire create, reopen, update, and reset

In `CycleManageView.vue`:

- add `explicitExemptDeptIds: []` to `createForm`;
- clear it in reset;
- copy it in `openEditCycle`;
- send it in `buildCreateBody`;
- bind it to the picker with `v-model:excluded-department-ids`.

Use `cycle.explicitExemptDeptIds ?? []` while reading older mocked or cached records.

### Step 8: Pass focused UI checks

Run from `web`:

```powershell
npm run type-check
npm run build
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test e2e/specs/17-cycle-launch-entry-ux.spec.ts
```

Expected: type-check, build, and the complete focused scope spec pass.

### Step 9: Commit the picker slice

```powershell
git add web/src/types/api.types.ts web/src/views/admin/components/CycleParticipantScopePicker.vue web/src/views/admin/CycleManageView.vue web/e2e/specs/17-cycle-launch-entry-ux.spec.ts
git commit -m "feat(cycles): support department scope exclusions"
```

---

## Task 4: Expose direct draft edit and delete actions

**Files:**

- Modify: `web/src/views/admin/components/CycleCompactTable.vue`
- Modify: `web/src/views/admin/components/CycleWorkspaceShell.vue`
- Modify: `web/src/views/admin/CycleManageView.vue`
- Test: `web/e2e/specs/14-cycle-management-compact.spec.ts`

### Step 1: Write failing list and detail acceptance tests

For a draft row, assert two direct buttons are visible without opening the overflow menu:

```ts
const draftRow = page.getByRole('row').filter({ hasText: draftCycle.name });
await expect(draftRow.getByRole('button', { name: '编辑', exact: true })).toBeVisible();
await expect(draftRow.getByRole('button', { name: '删除', exact: true })).toBeVisible();
```

Click `编辑` and assert the existing cycle dialog opens with the saved values. Click `删除` in a separate mocked test and assert the existing confirmation dialog appears before the DELETE request.

Open the draft detail/workspace, assert a header button named `编辑`, click it, and assert the same edit dialog opens. Confirm a non-draft fixture still exposes its existing stage-specific actions rather than draft deletion.

### Step 2: Run the compact-management spec and confirm the failures

Run from `web`:

```powershell
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test e2e/specs/14-cycle-management-compact.spec.ts
```

Expected: direct list actions and the detail-header edit assertion fail.

### Step 3: Simplify draft list actions

In `CycleCompactTable.vue`, render the draft branch directly for desktop and mobile:

```vue
<template v-if="cycle.status === 'draft'">
  <el-button link type="primary" @click.stop="emit('edit-cycle', cycle)">
    编辑
  </el-button>
  <el-button link type="danger" @click.stop="emit('delete-cycle', cycle)">
    删除
  </el-button>
</template>
```

Keep row/name click behavior unchanged so users can still view the cycle. Keep existing primary/overflow actions for non-draft stages. Increase the operation column only if the two short labels clip at supported viewport widths.

### Step 4: Add the draft detail edit action

Add an `edit` event to `CycleWorkspaceShell.vue`. In the workspace header, show `编辑` when `cycle.status === 'draft'`; preserve the existing stage actions for other statuses.

In `CycleManageView.vue`, handle the event by calling the existing `openEditCycle(cycleDetail)` function. Do not create a second edit form.

### Step 5: Pass focused action checks

Run from `web`:

```powershell
npm run type-check
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test e2e/specs/14-cycle-management-compact.spec.ts
```

Expected: type-check and the focused list/detail action spec pass.

### Step 6: Commit the action slice

```powershell
git add web/src/views/admin/components/CycleCompactTable.vue web/src/views/admin/components/CycleWorkspaceShell.vue web/src/views/admin/CycleManageView.vue web/e2e/specs/14-cycle-management-compact.spec.ts
git commit -m "feat(cycles): expose draft edit and delete actions"
```

---

## Task 5: Verify the complete change set

**Files:**

- Verify all files changed in Tasks 1–4
- Update only test fixtures that fail because the additive API response field is required

### Step 1: Run database and API verification

Run from `api`:

```powershell
npx prisma validate
npx prisma generate
npm test -- cycles/cycles.service.spec.ts cycles/launch.service.spec.ts --runInBand
npm run build
```

Expected: every command exits with code 0.

### Step 2: Run web verification

Run from `web`:

```powershell
npm run type-check
npm run build
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test e2e/specs/14-cycle-management-compact.spec.ts e2e/specs/17-cycle-launch-entry-ux.spec.ts
```

Expected: type-check, production build, and both focused browser specs pass.

### Step 3: Inspect the final diff and migration

Run from the feature worktree root:

```powershell
git diff --check main...HEAD
git status --short
git log --oneline --decorate main..HEAD
git diff --stat main...HEAD
```

Manually verify:

- the migration is additive and defaults existing rows to `[]`;
- API create/update/launch use the same field name;
- the client request and response types use the same field name;
- tree counts use `directMemberCount`;
- no production credential or environment file is committed;
- quick-login configuration is not disabled.

### Step 4: Commit any necessary fixture-only adjustments

If additive contract fixtures required changes, stage only those test files and commit:

```powershell
git commit -m "test(cycles): cover scope exclusions and draft actions"
```

If no fixture-only changes remain, do not create an empty commit.

---

## Task 6: Integrate, push, and publish after implementation approval

**Files/Systems:**

- Git branch `codex/cycle-scope-exclusions-edit-actions`
- Local and remote `main`
- Production Compose project `kayford-deploy`
- Production `.env`, `docker-compose.yml`, and `docker-compose.prod.yml`

### Step 1: Reconfirm the newest integration and live baselines

Before merging or building, record:

```powershell
git fetch origin --prune
git rev-parse main
git rev-parse origin/main
git status --short
```

Also inspect the production API/Web container image IDs, Compose working directory, health status, and current Git/image labels. If `main`, `origin/main`, or production advanced during implementation, rebase or merge the feature onto that newest baseline and rerun Task 5.

### Step 2: Integrate through a narrow feature merge

Use the repository’s established non-force workflow. Merge the verified branch into `main`, rerun the focused checks from the integrated tree, and push `main` to the authorized remote. Never force-push and never discard unrelated user changes.

### Step 3: Prepare rollback and database backup

Before migration or container recreation:

- tag the current API and Web image IDs with timestamped rollback tags;
- back up the production database using the established project command;
- back up the deployment `.env` and Compose configuration;
- verify `ENABLE_TEST_QUICK_LOGIN=true` remains in the release environment for the ongoing acceptance period.

Record every backup path and rollback image tag in the release evidence.

### Step 4: Build and smoke candidate images

Build API and Web candidates from the integrated newest baseline. Start candidate containers without taking over live ports and verify:

- API health endpoint returns success;
- Web root loads the new asset hashes;
- the migration is recognized by `prisma migrate status`;
- the quick-login account endpoint remains available;
- no startup error references the new JSON field.

### Step 5: Apply the additive migration and recreate only affected services

Using the formal project `.env`, both Compose files, and explicit project name `kayford-deploy`:

1. run `prisma migrate deploy` with the release API image;
2. recreate API and Web services using the verified candidate images;
3. leave unrelated services untouched;
4. confirm container image IDs and health checks match the candidates.

### Step 6: Verify internal and external behavior

Verify both local and public HTTPS routes:

- login page retains the left/right layout and all eight test-account quick-login entries;
- first-level menus still match the accepted baseline;
- all-company drawer shows `排除部门` and `排除人员`;
- custom department selection shows a nonzero estimated headcount;
- saving and reopening a disposable draft preserves included/excluded organization and person choices;
- draft list shows direct `编辑、删除` actions;
- draft detail shows `编辑` and opens the same edit dialog;
- API health and browser console are clean.

Use only controlled/disposable acceptance data. Do not launch or delete real cycles.

### Step 7: Report evidence and retain worktree during acceptance

Report:

- integrated and remote commit IDs;
- migration name/status;
- API/Web image IDs and rollback tags;
- focused test totals;
- verified public URL and behaviors;
- any residual risk.

Keep the feature worktree and rollback assets until the user explicitly confirms all acceptance is complete. Only then disable quick login, restart the API, verify the account endpoint is closed, and remove historical worktrees as a separate approved cleanup action.
