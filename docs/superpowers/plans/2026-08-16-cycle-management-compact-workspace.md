# Cycle Management Compact Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“周期与计划”改为紧凑状态分组列表、默认优先短表单和横向阶段整页工作区，同时保持现有周期状态机、权限和开放流程。

**Architecture:** `GET /cycles` 增加可选状态分组筛选，现有响应不变。前端新增纯映射模块统一分组、阶段、下一节点和主操作，`CycleManageView.vue` 负责 URL 与业务动作，两个聚焦组件分别承载紧凑列表和整页详情；新建表单保留在页面内但默认折叠高级设置，以最小范围复用现有创建校验。

**Tech Stack:** NestJS 10, Prisma 5, Vue 3, Vue Router 4, Element Plus 2, Jest 29, Playwright 1.61, TypeScript 5.6.

## Global Constraints

- 保留现有周期状态机、角色权限、审计记录和写接口语义。
- 列表不得逐行调用周期详情或开放检查接口。
- 精确状态存在时优先于状态分组；切换分组时清除精确状态。
- 创建成功但自动开放检查失败时，必须保留已创建草稿并进入详情。
- 截止日继续只能向后延期并保持流程顺序。
- 保留现有 `README.md`、`web/components.d.ts`、`docs/acceptance`、`docs/operations` 和 `tmp` 用户修改。
- Windows 下 `npm run type-check` 与 `npm run build` 必须串行执行。

---

### Task 1: Cycle Status Group Query

**Files:**
- Modify: `api/src/cycles/dto/cycle-query.dto.ts`
- Modify: `api/src/cycles/cycles.service.ts`
- Modify: `api/src/cycles/cycles.service.spec.ts`
- Modify: `web/src/types/api.types.ts`

**Interfaces:**
- Consumes: existing `CycleStatus`, `CycleQueryDto`, and `CyclesService.findAll`.
- Produces: `CycleStatusGroup = 'attention' | 'active' | 'finished'` and optional `CycleQuery.group`.

- [ ] **Step 1: Write failing service tests**

Add tests that call `findAll({ group: 'attention' })` and expect both Prisma queries to receive:

```ts
status: { in: ['draft', 'launch_blocked'] }
```

Add a second test proving exact `status: 'scheduled'` overrides `group: 'attention'`.

- [ ] **Step 2: Verify the tests fail for the missing group behavior**

Run: `npm test -- --runInBand src/cycles/cycles.service.spec.ts`

Expected: the new group assertion fails because `findAll` ignores `group`.

- [ ] **Step 3: Add the DTO, type, and status mapping**

Add:

```ts
export enum CycleStatusGroup {
  attention = 'attention',
  active = 'active',
  finished = 'finished',
}
```

Map groups in `cycles.service.ts`:

```ts
const CYCLE_STATUS_GROUPS = {
  attention: ['draft', 'launch_blocked'],
  active: ['scheduled', 'indicator_setting', 'self_eval', 'manager_score', 'hr_calibration', 'approval', 'published', 'appeal'],
  finished: ['closed'],
} satisfies Record<CycleStatusGroup, CycleStatus[]>;
```

Use exact status first, otherwise group status set.

- [ ] **Step 4: Verify API tests pass**

Run: `npm test -- --runInBand src/cycles/cycles.service.spec.ts`

Expected: all cycle service tests pass.

- [ ] **Step 5: Commit the status group slice**

```powershell
git add -- api/src/cycles/dto/cycle-query.dto.ts api/src/cycles/cycles.service.ts api/src/cycles/cycles.service.spec.ts web/src/types/api.types.ts
git commit -m "feat(cycles): add compact status groups"
```

### Task 2: Compact List, URL State, and Primary Actions

**Files:**
- Create: `web/src/views/admin/cycle-management.ts`
- Create: `web/src/views/admin/components/CycleCompactTable.vue`
- Modify: `web/src/views/admin/CycleManageView.vue`
- Create: `web/e2e/specs/14-cycle-management-compact.spec.ts`
- Modify: `web/playwright.contract.config.ts`

**Interfaces:**
- Consumes: `AssessmentCycle`, `CycleStatus`, `CycleStatusGroup`, `CycleQuery`.
- Produces: `cycleStatusGroup(status)`, `cycleStageIndex(status)`, `cycleNextStep(cycle)`, `cyclePrimaryActionLabel(status)`, `CycleCompactTable` events `open`, `primary`, `edit-deadlines`, and `cancel-schedule`.

- [ ] **Step 1: Write failing pure mapping and browser contract tests**

The spec imports the pure helpers and asserts:

```ts
expect(cycleStatusGroup('draft')).toBe('attention');
expect(cycleStatusGroup('manager_score')).toBe('active');
expect(cyclePrimaryActionLabel('launch_blocked')).toBe('重新检查');
expect(cycleStageIndex('approval')).toBe(3);
```

The browser test mocks HR identity and cycle APIs, opens `/cycles?group=attention`, then expects `cycle-group-attention`, four table headers, and `cycle-primary-<id>`.

- [ ] **Step 2: Verify the contract fails because helpers and compact UI do not exist**

Run: `npm run test:contracts -- e2e/specs/14-cycle-management-compact.spec.ts`

Expected: TypeScript or Playwright failure naming the missing helper/component/test ids.

- [ ] **Step 3: Implement helpers and compact table**

`cycle-management.ts` owns all display mappings. `CycleCompactTable.vue` renders:

```text
周期 | 当前状态 | 下一步 | 操作
```

It emits row open and only one visible primary button; secondary operations live in an Element Plus dropdown.

- [ ] **Step 4: Make `CycleManageView` URL-driven**

Read `group`, `status`, `type`, `keyword`, `page`, and `cycleId` from `useRoute()`. Update queries with `router.replace`; entering detail adds `cycleId` with `router.push`; closing detail removes only `cycleId`.

- [ ] **Step 5: Verify compact list contracts pass**

Run: `npm run test:contracts -- e2e/specs/14-cycle-management-compact.spec.ts`

Expected: helper and list tests pass.

- [ ] **Step 6: Commit the compact list slice**

```powershell
git add -- web/src/views/admin/cycle-management.ts web/src/views/admin/components/CycleCompactTable.vue web/src/views/admin/CycleManageView.vue web/e2e/specs/14-cycle-management-compact.spec.ts web/playwright.contract.config.ts
git commit -m "feat(web): compact cycle management list"
```

### Task 3: Default-First Cycle Creation

**Files:**
- Modify: `web/src/views/admin/CycleManageView.vue`
- Modify: `web/e2e/specs/14-cycle-management-compact.spec.ts`

**Interfaces:**
- Consumes: existing `createForm`, `presetNextQuarter`, `buildCreateBody`, `getCreateDeadlineValidationMessage`, and `cyclesApi.create`.
- Produces: compact create dialog test ids `cycle-create-advanced`, `cycle-create-save-draft`, and `cycle-create-and-check`.

- [ ] **Step 1: Write failing creation contract tests**

Open the dialog and assert advanced date, grade, and visibility controls are hidden. Expand `cycle-create-advanced` and assert they become visible. Mock `POST /cycles`; clicking `cycle-create-and-check` must create once, set `cycleId` in the URL, and request `/cycles/<id>/preflight`.

- [ ] **Step 2: Verify the contract fails on the existing long form**

Run: `npm run test:contracts -- e2e/specs/14-cycle-management-compact.spec.ts`

Expected: advanced controls are visible or the new buttons are missing.

- [ ] **Step 3: Reshape the existing form without changing its payload**

Keep name, type, HR owner, participation scope, and compact schedule summary visible. Wrap extra participants, exemptions, opening times, seven deadlines, grade ratios, and visible fields in a collapsed section. Keep the existing form model and `buildCreateBody()`.

- [ ] **Step 4: Add separate create outcomes**

Refactor creation to return the created `AssessmentCycle`. “保存草稿” reloads the list. “创建并开放检查” calls `openCycleWorkspace(created, { runPreflight: true })`. If preflight fails, preserve the selected `cycleId` and show the workspace error state.

- [ ] **Step 5: Verify creation contracts pass**

Run: `npm run test:contracts -- e2e/specs/14-cycle-management-compact.spec.ts`

Expected: compact creation and create-and-check flow pass.

- [ ] **Step 6: Commit the compact creation slice**

```powershell
git add -- web/src/views/admin/CycleManageView.vue web/e2e/specs/14-cycle-management-compact.spec.ts
git commit -m "feat(web): simplify cycle creation"
```

### Task 4: Full-Page Cycle Workspace and Exception-First Preflight

**Files:**
- Create: `web/src/views/admin/components/CycleWorkspaceShell.vue`
- Modify: `web/src/views/admin/CycleManageView.vue`
- Modify: `web/e2e/specs/14-cycle-management-compact.spec.ts`

**Interfaces:**
- Consumes: `AssessmentCycle`, `LaunchPreflightResult`, `cycleStageIndex`, existing launch/schedule/cancel/deadline actions.
- Produces: shell events `back`, `preflight`, `launch`, `schedule`, `edit-deadlines`, `cancel-schedule`, and test ids `cycle-workspace`, `cycle-stage-<index>`, `cycle-current-action`, `cycle-preflight-blockers`, `cycle-preflight-details`.

- [ ] **Step 1: Write failing workspace contracts**

Click a draft row and assert the list disappears, a five-stage workspace appears, the URL keeps existing filters plus `cycleId`, and browser/back button restores the compact list. Mock failed preflight and assert blockers are visible while participant details stay collapsed; mock ready preflight and assert “立即开放” and “按开放时间预约”.

- [ ] **Step 2: Verify workspace contracts fail on dialog-based detail**

Run: `npm run test:contracts -- e2e/specs/14-cycle-management-compact.spec.ts`

Expected: `cycle-workspace` and stage ids are missing.

- [ ] **Step 3: Implement the workspace shell**

Render a compact header, five-stage horizontal progress, current action card, exception-first preflight panel, collapsed full participant table, and settings drawer. The shell remains present during detail/preflight errors so the user can retry or return.

- [ ] **Step 4: Rewire existing actions into the workspace**

Replace `detailDialogVisible` and `preflightDialogVisible` with URL-driven workspace state. Reuse the existing confirmation, launch, schedule, cancel, and deadline validation functions. Successful actions refresh both detail and list without leaving the workspace unless business state requires it.

- [ ] **Step 5: Verify workspace contracts pass**

Run: `npm run test:contracts -- e2e/specs/14-cycle-management-compact.spec.ts`

Expected: URL restoration, stage display, blockers, ready actions, and collapsed participant details pass.

- [ ] **Step 6: Commit the cycle workspace slice**

```powershell
git add -- web/src/views/admin/components/CycleWorkspaceShell.vue web/src/views/admin/CycleManageView.vue web/e2e/specs/14-cycle-management-compact.spec.ts
git commit -m "feat(web): add cycle operations workspace"
```

### Task 5: Responsive and Regression Verification

**Files:**
- Modify: `web/src/views/admin/components/CycleCompactTable.vue`
- Modify: `web/src/views/admin/components/CycleWorkspaceShell.vue`
- Modify: `web/src/views/admin/CycleManageView.vue`
- Modify: `web/e2e/specs/14-cycle-management-compact.spec.ts`

**Interfaces:**
- Consumes: the completed compact list, create dialog, and workspace.
- Produces: desktop and 390px layouts with no page-level horizontal overflow.

- [ ] **Step 1: Add a failing 390px contract**

Set viewport to `390x844`, open list, create dialog, and workspace, then assert:

```ts
expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
```

Assert the primary action remains visible in all three surfaces.

- [ ] **Step 2: Verify the narrow-screen contract fails before responsive styles**

Run: `npm run test:contracts -- e2e/specs/14-cycle-management-compact.spec.ts`

Expected: overflow or action visibility assertion fails.

- [ ] **Step 3: Add focused responsive styles**

At narrow widths, collapse filters, render table rows as stacked surfaces, allow only the stage strip to scroll horizontally, make the create form single-column, and keep footer actions visible.

- [ ] **Step 4: Run focused verification serially**

Run in order:

```powershell
Set-Location api
npm test -- --runInBand src/cycles/cycles.service.spec.ts
Set-Location ../web
npm run test:contracts -- e2e/specs/14-cycle-management-compact.spec.ts
npm run type-check
npm run build
Set-Location ..
git diff --check
```

Expected: all commands pass with no warnings attributable to changed files.

- [ ] **Step 5: Review only in-scope changes**

Run `git status --short` and `git diff --` for the files in this plan. Confirm pre-existing dirty files remain untouched and do not stage or commit them.

- [ ] **Step 6: Commit responsive verification changes**

```powershell
git add -- web/src/views/admin/components/CycleCompactTable.vue web/src/views/admin/components/CycleWorkspaceShell.vue web/src/views/admin/CycleManageView.vue web/e2e/specs/14-cycle-management-compact.spec.ts
git commit -m "test(web): verify compact cycle workspace"
```
