# 绩效指标可见范围、目标跟进与目标地图闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让周期开放后的员工在目标跟进中看到本人及本周期绩效直属上级的可见指标，让绩效待办严格区分本人和直属下属任务，并以多选可见规则与显式指标对齐关系驱动目标地图。

**Architecture:** `AssessmentTask.managerId` 继续作为周期开放时冻结的绩效汇报关系；指标可见性从单个枚举扩展为 `IndicatorVisibilityRule` 多行并集规则，`IndicatorInstance.visibilityScope` 在迁移期保留为兼容列；指标对齐新增 `IndicatorInstanceAlignment`，只允许同周期员工指标对齐到冻结绩效直属上级的可见指标。API 统一通过 `IndicatorVisibilityService` 判定可见性，目标跟进与目标地图读取同一批指标数据。Web 复用现有目标跟进、目标地图画布和任务工作台，增加多选编辑器、周期快照分组、显式连线和“同部门可见·未对齐”独立区域。

**Tech Stack:** NestJS 10、Prisma 5、PostgreSQL、Jest、Vue 3、TypeScript、Element Plus、Playwright、Docker Compose。

**Spec:** `docs/superpowers/specs/2026-09-01-performance-indicator-visibility-and-map-design.md`

## Global Constraints

- 直接在领先的 `main` 上开发，不创建功能分支或工作树；每个任务完成 focused verification 后提交。
- 人员是否参与、员工的绩效直属上级是谁，只读取周期开放时冻结的 `AssessmentTask`，不按当前花名册重新推导。
- 绩效待办只展示本人任务和 `managerId = viewer.id` 的直属下属任务；同部门可见规则不能扩大任务、评分或总结权限。
- 目标跟进只展示本人和同周期冻结绩效直属上级；不得沿管理链继续向上展示。
- 可见范围按多选规则并集判定，`company` 与其他范围互斥；`custom` 可与其他规则共存并支持多部门、多员工。
- 目标地图主图只连接显式 `IndicatorInstanceAlignment`；同部门可见但未对齐的指标进入独立区域，隐藏父节点不得通过名称、数量或占位符泄漏。
- PC 1440px 和手机 390px 均不得横向溢出；手机端“同部门可见·未对齐”移到主图下方。
- 采用 expand-migrate-contract：先新增表和回填，兼容期双读/双写，生产验证后才允许移除旧单值列。
- 任何鉴权错误、接口错误或数据冲突都必须显示明确状态，不能伪装成“暂无数据”。
- 上线前备份生产数据库和当前镜像/提交，数据库、API、Web 使用同一代码版本；保持 `ENABLE_TEST_QUICK_LOGIN` 关闭并验证正式线上地址。

---

### Task 1: 扩展指标可见规则和显式指标对齐数据模型

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: `api/prisma/migrations/20260901090000_expand_indicator_visibility_and_alignment/migration.sql`
- Modify: `api/src/tasks/indicator-schema.contract.spec.ts`

**Interfaces:**
- Produces: `IndicatorVisibilityRule(id, indicatorInstanceId, scope, createdAt)`.
- Produces: `IndicatorInstanceAlignment(id, childIndicatorId, parentIndicatorId, createdAt)`.
- Preserves: `IndicatorInstance.visibilityScope` as compatibility source during migration.
- Produces: unique constraints `(indicatorInstanceId, scope)` and `(childIndicatorId, parentIndicatorId)`.

- [ ] **Step 1: Add failing schema contract tests**

```ts
expect(schema).toContain('model IndicatorVisibilityRule');
expect(schema).toContain('@@unique([indicatorInstanceId, scope])');
expect(schema).toContain('model IndicatorInstanceAlignment');
expect(schema).toContain('@@unique([childIndicatorId, parentIndicatorId])');
expect(schema).toMatch(/visibilityRules\s+IndicatorVisibilityRule\[\]/);
expect(schema).toMatch(/parentAlignments\s+IndicatorInstanceAlignment\[\]/);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- indicator-schema.contract.spec.ts --runInBand`

Expected: FAIL because the rule and alignment models do not exist.

- [ ] **Step 3: Add additive Prisma models and relations**

```prisma
model IndicatorVisibilityRule {
  id                  String                   @id @default(uuid()) @db.Uuid
  indicatorInstanceId String                   @map("indicator_instance_id") @db.Uuid
  scope               IndicatorVisibilityScope
  createdAt           DateTime                 @default(now()) @map("created_at")
  indicatorInstance   IndicatorInstance        @relation(fields: [indicatorInstanceId], references: [id], onDelete: Cascade)

  @@unique([indicatorInstanceId, scope])
  @@index([scope, indicatorInstanceId])
  @@map("indicator_visibility_rules")
}

model IndicatorInstanceAlignment {
  id                String            @id @default(uuid()) @db.Uuid
  childIndicatorId  String            @map("child_indicator_id") @db.Uuid
  parentIndicatorId String            @map("parent_indicator_id") @db.Uuid
  createdAt         DateTime          @default(now()) @map("created_at")
  childIndicator    IndicatorInstance @relation("IndicatorAlignmentChild", fields: [childIndicatorId], references: [id], onDelete: Cascade)
  parentIndicator   IndicatorInstance @relation("IndicatorAlignmentParent", fields: [parentIndicatorId], references: [id], onDelete: Cascade)

  @@unique([childIndicatorId, parentIndicatorId])
  @@index([parentIndicatorId])
  @@map("indicator_instance_alignments")
}
```

- [ ] **Step 4: Add a non-destructive migration and backfill one rule per historical indicator**

Migration must create both tables and foreign keys, then insert `scope = visibility_scope` for every existing indicator using `ON CONFLICT DO NOTHING`. It must not delete or rewrite custom department/user relations or objective alignments.

- [ ] **Step 5: Generate Prisma types and confirm GREEN**

Run: `npm run prisma:generate; npm test -- indicator-schema.contract.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/prisma/schema.prisma api/prisma/migrations/20260901090000_expand_indicator_visibility_and_alignment/migration.sql api/src/tasks/indicator-schema.contract.spec.ts
git commit -m "feat(performance): expand indicator visibility model"
```

### Task 2: 将指标设置契约升级为多选可见范围并集中鉴权

**Files:**
- Modify: `api/src/tasks/dto/set-indicators.dto.ts`
- Modify: `api/src/tasks/indicator-visibility.service.ts`
- Modify: `api/src/tasks/indicator-visibility.service.spec.ts`
- Modify: `api/src/tasks/tasks.service.ts`
- Modify: `api/src/tasks/tasks.service.spec.ts`
- Modify: `api/src/objectives/objectives.service.ts`
- Modify: `api/src/objectives/objectives.service.spec.ts`

**Interfaces:**
- Consumes: `visibilityScopes: IndicatorVisibilityScope[]`.
- Consumes: `visibleDepartmentIds`, `visibleUserIds`, `alignedParentIndicatorIds`.
- Produces: response fields `visibilityScopes` plus compatibility `visibilityScope`.
- Produces: `IndicatorVisibilityService.canViewerSeeIndicator(...)` and reusable Prisma filter builder.

- [ ] **Step 1: Write failing validation and authorization tests**

Cover required non-empty scopes, duplicate normalization, `company` exclusivity, `custom` with empty selectors, union semantics, hidden parent denial, and compatibility fallback when only the old scalar exists.

```ts
expect(service.normalizeSelection({ visibilityScopes: ['supervisors', 'department'] }))
  .toMatchObject({ visibilityScopes: ['supervisors', 'department'] });
expect(() => service.normalizeSelection({ visibilityScopes: ['company', 'department'] }))
  .toThrow('全公司可见不能与其他范围同时选择');
```

- [ ] **Step 2: Run focused API tests and confirm RED**

Run: `npm test -- indicator-visibility.service.spec.ts tasks.service.spec.ts objectives.service.spec.ts --runInBand`

Expected: FAIL because requests and persistence are single-select.

- [ ] **Step 3: Upgrade DTOs and normalize compatibility requests**

Accept `visibilityScopes` as the primary field. During compatibility, transform a request with only `visibilityScope` into a one-item array; reject requests that provide neither. Default new indicators to `['supervisors']`.

- [ ] **Step 4: Implement union semantics in one visibility service**

Build visibility from rule rows, falling back to the scalar only when rules are absent. `custom` reads existing visible department/user joins. Relation meanings remain:

- `supervisors`: viewer is the task's frozen `managerId`.
- `direct_reports`: indicator owner is viewer's frozen direct report in the same cycle.
- `all_reports`: only where the existing supported hierarchy can prove ancestry; no task or score exposure.
- `department` / `department_tree`: department membership only.
- `company`: all authenticated employees.

- [ ] **Step 5: Dual-write indicator rules transactionally**

On draft save, autosave, submit, review edits and imported indicators: replace rule rows in the same transaction, preserve custom joins, and set legacy `visibilityScope` to a deterministic representative for old readers. Do not partially save alignments here; Task 4 validates and writes them.

- [ ] **Step 6: Replace ad-hoc objective visibility clauses with the centralized service**

`ObjectivesService` must not maintain a second hard-coded visibility matrix. Tracking details, reference information, alignment candidates and map aggregation all consume the same filter/evaluator.

- [ ] **Step 7: Generate types and confirm GREEN**

Run: `npm run prisma:generate; npm test -- indicator-visibility.service.spec.ts tasks.service.spec.ts objectives.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add api/src/tasks api/src/objectives
git commit -m "feat(performance): support multi-scope indicator visibility"
```

### Task 3: 用周期冻结绩效直属上级统一目标跟进与绩效待办

**Files:**
- Modify: `api/src/cycles/tracking-context.types.ts`
- Modify: `api/src/cycles/cycles.service.ts`
- Modify: `api/src/cycles/cycles.service.spec.ts`
- Modify: `api/src/objectives/objectives.service.ts`
- Modify: `api/src/objectives/objectives.service.spec.ts`
- Modify: `api/src/tasks/team-tasks.service.ts`
- Modify: `api/src/tasks/team-tasks.service.spec.ts`
- Modify: `web/src/types/api.types.ts`
- Modify: `web/src/views/objectives/goal-tracking.ts`
- Modify: `web/src/views/objectives/use-goal-tracking.ts`
- Modify: `web/src/views/task/components/TeamTaskList.vue`
- Modify: `web/src/views/task/components/TeamTaskWorkspaceShell.vue`
- Modify: `web/src/views/task/TaskListView.vue`

**Interfaces:**
- Produces: `PerformanceCycleContext.task.manager: { id, name } | null` from the frozen task.
- Produces: goal-tracking groups `我` and `绩效直属上级`.
- Produces: task groups `我的绩效待办` and `直属下属的绩效待办`.

- [ ] **Step 1: Write failing frozen-relation tests**

Assert that a changed current roster manager does not alter an opened cycle, the frozen manager may view the employee, an unrelated or indirect manager receives 403/no-access, and team task queries only use `AssessmentTask.managerId = viewer.id`.

- [ ] **Step 2: Confirm RED**

Run: `npm test -- cycles.service.spec.ts objectives.service.spec.ts team-tasks.service.spec.ts --runInBand`

Expected: FAIL because tracking still relies on the current direct manager in some paths and team copy/contracts are not unified.

- [ ] **Step 3: Return the frozen manager in cycle contexts**

Include task `managerId` and manager name from the launched task snapshot. `findTrackingContexts` authorizes self or that task manager for the selected owner/cycle; it must not traverse to higher managers.

- [ ] **Step 4: Bind indicator tracking to owner + cycle + frozen task**

Verify the selected cycle has an owner task. For a manager owner, filter every indicator through Task 2 visibility. For an unauthorized relationship return 403 with “你没有权限查看该员工在本考核周期的目标”。

- [ ] **Step 5: Keep performance tasks separate from indicator visibility**

Personal tasks come from `employeeId = viewer.id`; subordinate tasks come only from `managerId = viewer.id`. Department/custom visibility must never add rows to the team task query.

- [ ] **Step 6: Update Web grouping and refresh behavior**

Remove `CurrentUser.directManagerId` as the source for goal tracking people. Select a cycle first, then use its frozen manager context. Changing cycle must refresh summary, indicators, periods and current action together; stale requests must be ignored or cancelled.

- [ ] **Step 7: Update user-visible terminology without changing internal routes**

Replace “直接上级/团队成员/我团队的绩效待办” with the approved terms. Preserve “主管评分”, “部门负责人”, “下级部门” and “花名册直属主管”.

- [ ] **Step 8: Confirm GREEN**

Run: `npm test -- cycles.service.spec.ts objectives.service.spec.ts team-tasks.service.spec.ts --runInBand`

Run: `npm run type-check`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add api/src/cycles api/src/objectives api/src/tasks web/src/types web/src/views/objectives web/src/views/task
git commit -m "fix(performance): bind workspaces to frozen manager relation"
```

### Task 4: 校验并持久化员工指标到直属上级指标的显式对齐

**Files:**
- Modify: `api/src/tasks/dto/set-indicators.dto.ts`
- Modify: `api/src/tasks/tasks.service.ts`
- Modify: `api/src/tasks/tasks.service.spec.ts`
- Modify: `api/src/objectives/objectives.controller.ts`
- Modify: `api/src/objectives/objectives.service.ts`
- Modify: `api/src/objectives/objectives.service.spec.ts`
- Modify: `web/src/api/objectives.ts`
- Modify: `web/src/types/api.types.ts`

**Interfaces:**
- Consumes: per indicator `alignedParentIndicatorIds: string[]`.
- Produces: `GET /objectives/alignment-candidates?taskId=<uuid>`.
- Produces: indicator responses with `alignedParentIndicators` summaries.

- [ ] **Step 1: Write failing alignment validation tests**

Cover same-cycle enforcement, parent owner equals child task's frozen manager, visible-parent enforcement, self-link rejection, duplicate normalization, multi-parent support and deletion of removed links.

- [ ] **Step 2: Confirm RED**

Run: `npm test -- tasks.service.spec.ts objectives.service.spec.ts --runInBand`

Expected: FAIL because only generic objective alignment exists.

- [ ] **Step 3: Add a visibility-filtered candidate endpoint**

Return only the same cycle's frozen manager indicators that the employee can see. Do not return hidden parent IDs, names or counts. When no manager task/visible indicator exists, return an empty list with a business reason field.

- [ ] **Step 4: Validate and replace alignment rows in the indicator transaction**

Resolve all IDs in one query, validate ownership/cycle/visibility, then replace only that child's links. Reject the whole request on one invalid parent so indicator and alignment state cannot diverge.

- [ ] **Step 5: Return normalized alignment summaries**

Responses include `{ id, name, owner: { id, name } }` for visible linked parents only. Keep existing generic `ObjectiveAlignment` responses unchanged for compatibility.

- [ ] **Step 6: Confirm GREEN and commit**

Run: `npm test -- tasks.service.spec.ts objectives.service.spec.ts --runInBand`

```bash
git add api/src/tasks api/src/objectives web/src/api/objectives.ts web/src/types/api.types.ts
git commit -m "feat(performance): align indicators to frozen manager goals"
```

### Task 5: 实现指标可见范围多选编辑器和批准术语

**Files:**
- Modify: `web/src/types/api.types.ts`
- Modify: `web/src/views/task/components/IndicatorVisibilityEditor.vue`
- Modify: `web/src/views/task/components/IndicatorSnapshot.vue`
- Modify: `web/src/views/task/components/GoalReviewWorkspace.vue`
- Modify: `web/src/views/task/components/ManagerEvaluationWorkspace.vue`
- Modify: `web/src/views/task/components/PerformanceIndicatorList.vue`
- Modify: `web/src/views/objectives/GoalTrackingDetailDrawer.vue`
- Modify: `web/src/views/objectives/indicator-version-history.ts`
- Create: `web/e2e/specs/31-indicator-visibility-and-map.spec.ts`

**Interfaces:**
- Consumes/produces: `visibilityScopes`, custom departments/users and `alignedParentIndicatorIds`.
- Displays grouped options using the approved labels.

- [ ] **Step 1: Add failing Playwright contract for multi-select behavior**

Assert default `绩效直属上级可见`, at least one selection, union chips, grouped option labels, `全公司可见` exclusivity, custom department/user multi-select, independent permission-control styling and persisted reload.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'; npx playwright test e2e/specs/31-indicator-visibility-and-map.spec.ts --project=chromium`

Expected: FAIL because the editor is single-select.

- [ ] **Step 3: Replace the single-select editor with grouped multi-select**

Groups and values:

- 汇报关系: `supervisors` 绩效直属上级可见, `direct_reports` 直属下属可见, `all_reports` 全部下属可见.
- 组织范围: `department` 本部门可见, `department_tree` 本部门及下级部门可见.
- 指定范围: `custom` 自定义部门或员工.
- 全员: `company` 全公司可见.

Keep the control visually outside the indicator cell list, show selected chips, and expose custom pickers only while `custom` is selected.

- [ ] **Step 4: Update every read/write surface**

Draft creation, autosave, submit, manager review, detail drawer, version diff and compact/complete modes must send and render the same array contract. Legacy responses with one scalar are normalized client-side.

- [ ] **Step 5: Add indicator alignment selection to goal setting**

When a candidate list exists, show “对齐绩效直属上级指标” as an optional multi-select. Hidden candidates never appear. Complete and compact modes share the same data; compact mode shows selected alignment chips.

- [ ] **Step 6: Confirm GREEN**

Run: `npm run type-check`

Run: `$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'; npx playwright test e2e/specs/31-indicator-visibility-and-map.spec.ts --project=chromium`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/types web/src/views/task web/src/views/objectives web/e2e/specs/31-indicator-visibility-and-map.spec.ts
git commit -m "feat(web): add multi-scope indicator permissions"
```

### Task 6: 实现指标级目标地图 API

**Files:**
- Create: `api/src/objectives/dto/indicator-map-query.dto.ts`
- Create: `api/src/objectives/indicator-map.types.ts`
- Modify: `api/src/objectives/objectives.controller.ts`
- Modify: `api/src/objectives/objectives.service.ts`
- Modify: `api/src/objectives/objectives.service.spec.ts`
- Modify: `api/src/objectives/objectives.module.ts`

**Interfaces:**
- Produces: `GET /objectives/indicator-map?cycleId=<uuid>`.
- Produces: `{ cycle, roots, nodes, edges, sameDepartmentUnaligned, permissions }`.
- Consumes: Task 2 visibility and Task 4 alignment rows.

- [ ] **Step 1: Write failing map aggregation tests**

Test visible aligned parent/child graph, employee and frozen manager roots, same-department visible unaligned sidebar, hidden parent omission with visible child promoted to root, cross-cycle exclusion, unrelated department exclusion and no hidden count leakage.

- [ ] **Step 2: Confirm RED**

Run: `npm test -- objectives.service.spec.ts --runInBand`

Expected: FAIL because there is no indicator map endpoint.

- [ ] **Step 3: Implement one visibility-first aggregation query**

Load the selected cycle and viewer's active/exempt task context. Determine the viewer, the frozen manager and same-department candidate owners. Filter indicator instances through `IndicatorVisibilityService` before resolving edges.

- [ ] **Step 4: Build graph and unaligned collections without leakage**

Keep an edge only when both child and parent are visible. A visible node with no remaining visible parent is a root. `sameDepartmentUnaligned` contains only visible same-department indicators with no explicit alignment into the main graph; do not return omitted totals.

- [ ] **Step 5: Confirm GREEN and commit**

Run: `npm test -- objectives.service.spec.ts --runInBand`

```bash
git add api/src/objectives
git commit -m "feat(objectives): expose visibility-safe indicator map"
```

### Task 7: 将目标跟进和目标地图页面接入统一指标数据

**Files:**
- Modify: `web/src/api/objectives.ts`
- Modify: `web/src/types/api.types.ts`
- Modify: `web/src/views/objectives/ObjectiveMapView.vue`
- Modify: `web/src/views/objectives/objective-map-layout.ts`
- Modify: `web/src/views/objectives/components/ObjectiveMapCanvas.vue`
- Modify: `web/src/views/objectives/components/ObjectiveMapFilters.vue`
- Modify: `web/src/views/objectives/GoalTrackingView.vue`
- Modify: `web/src/views/objectives/use-goal-tracking.ts`
- Modify: `web/e2e/specs/31-indicator-visibility-and-map.spec.ts`
- Modify: `web/e2e/specs/09-performance-workspace.spec.ts`

**Interfaces:**
- Consumes: indicator map contract from Task 6.
- Displays: A layout — aligned main graph plus independent “同部门可见 · 未对齐” area.
- Displays: goal-tracking people groups `我` and `绩效直属上级`.

- [ ] **Step 1: Extend failing E2E tests for PC and mobile**

Mock two cycles with different frozen managers and indicators. Assert cycle change refreshes all content, goal tracking shows only self + frozen manager, no permission state is explicit, graph edges reflect only explicit alignments, unaligned same-department indicators stay outside the graph, and hidden parent data is absent from DOM.

At 390px assert the unaligned panel is below the graph, controls are touch-sized and there is no horizontal overflow.

- [ ] **Step 2: Confirm RED**

Run: `$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'; npx playwright test e2e/specs/31-indicator-visibility-and-map.spec.ts --project=chromium`

Expected: FAIL because the map still renders generic objectives and goal tracking derives people from the current profile.

- [ ] **Step 3: Adapt the existing canvas and layout to indicator nodes**

Reuse pan, zoom, fit, SVG edge and node interaction behavior. Node identity is indicator ID; node metadata includes owner, department, weight, progress and visibility summary. Edges come exclusively from the API.

- [ ] **Step 4: Implement the A layout**

Desktop: main graph fills the center, right-side card lists `同部门可见 · 未对齐`. Mobile: graph first, the same card below. Clicking a node opens the existing indicator detail drawer only when the API returned that node.

- [ ] **Step 5: Make cycle switching atomic and stale-safe**

Every selected cycle change clears prior page data, requests the new context/map, ignores late responses for old cycle IDs and shows loading/error/empty states separately. “暂无考核周期” is used only for a successful empty cycle list.

- [ ] **Step 6: Confirm GREEN**

Run: `npm run type-check`

Run: `$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'; npx playwright test e2e/specs/31-indicator-visibility-and-map.spec.ts e2e/specs/09-performance-workspace.spec.ts --project=chromium`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/api web/src/types web/src/views/objectives web/e2e/specs/31-indicator-visibility-and-map.spec.ts web/e2e/specs/09-performance-workspace.spec.ts
git commit -m "feat(web): render aligned indicator map"
```

### Task 8: 全链路回归、生产迁移与上线验证

**Files:**
- Modify if required by verification only: `api/src/**/*.spec.ts`, `web/e2e/specs/*.spec.ts`
- Use: `deploy/docker-compose.prod.yml`
- Use: `deploy/scripts/deploy.sh`
- Use: `scripts/update-prod.sh`

**Interfaces:**
- Verifies: migration, API, Web, authenticated roles, PC/mobile and rollback points all match one `main` commit.

- [ ] **Step 1: Inspect final worktree and commit graph**

Run: `git status --short --branch; git log --oneline --decorate -12; git fetch origin --prune; git rev-list --left-right --count origin/main...main`

Expected: only intentional work exists and local main contains origin/main without divergence.

- [ ] **Step 2: Run API focused and broad verification**

Run: `npm run prisma:generate`

Run: `npm test -- indicator-schema.contract.spec.ts indicator-visibility.service.spec.ts tasks.service.spec.ts objectives.service.spec.ts cycles.service.spec.ts team-tasks.service.spec.ts --runInBand`

Run: `npm run build`

Expected: PASS. Any unrelated existing failure must be recorded separately and must not be presented as new work passing.

- [ ] **Step 3: Run Web type, focused E2E and build verification**

Run: `npm run type-check`

Run: `$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'; npx playwright test e2e/specs/31-indicator-visibility-and-map.spec.ts e2e/specs/30-goal-tracking-cycle-closure.spec.ts e2e/specs/09-performance-workspace.spec.ts --project=chromium`

Run: `npm run build`

Expected: PASS at 1440px and 390px.

- [ ] **Step 4: Review the complete diff against the approved spec**

Run: `git diff origin/main...main --check`

Search: `rg -n "团队成员|直接上级|仅上级可见|visibilityScope" web/src api/src`

Classify every hit as approved legacy/internal compatibility or a missed visible/contract conversion. Verify no TODO/TBD and no hidden-parent leakage path.

- [ ] **Step 5: Create production rollback evidence**

Record current external health, deployed image IDs, current application commit and database migration status. Create a timestamped PostgreSQL backup before migration. Verify `ENABLE_TEST_QUICK_LOGIN` is disabled.

- [ ] **Step 6: Push the verified main commit**

Run: `git push origin main`

Expected: local `main`, `origin/main` and the release commit are identical.

- [ ] **Step 7: Deploy matching DB, API and Web artifacts**

Deploy the additive migration first through the existing production compose process, then replace API and Web with images built from the same commit. Do not recreate the database volume or deploy unrelated services.

- [ ] **Step 8: Verify live behavior with real role boundaries**

Check formal health/API route, production Web, login, one employee and one frozen direct manager:

- indicator setting persists multiple visibility rules and alignment selections;
- employee goal tracking shows self + only the frozen performance manager;
- manager performance tasks show self + direct reports only;
- same-department visibility never exposes tasks/scores/summaries;
- target map shows explicit edges and the separate unaligned area;
- unauthorized employee view returns the explicit no-permission page;
- switching cycle refreshes all page data;
- PC and mobile layouts have no horizontal overflow.

- [ ] **Step 9: Report and archive release evidence**

Report the release commit, pushed remote state, migration name, backup/rollback point, actual verification commands/results and any remaining non-blocking risk. Do not call the release accepted until the user has performed business acceptance.
