# Cycle Scope Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cycle scope contain only actual assessed employees, preserve historical audit data without displaying injected top-leader records, and show the approved goal-review chain in business language.

**Architecture:** Stop adding the configured company leader to future launch candidates. At the historical participant-record boundary, filter the legacy `top_leader_exempt` row and compute summary counts from the filtered set while exposing the already-frozen manager, department head, and supervising leader names. The Vue workspace renders one generic goal-review chain in the header and the actual frozen people per employee.

**Tech Stack:** NestJS, Prisma, Jest, Vue 3, TypeScript, Element Plus, Playwright

**Spec:** `docs/superpowers/specs/2026-11-17-cycle-scope-clarity-design.md`

## Global Constraints

- Do not delete or update historical assessment tasks, scores, goals, approvals, or flow records.
- Do not add permissions, database migrations, or new workflow nodes.
- Performance approvals still end at each task's frozen supervising leader.
- Header copy is exactly `目标审核流程：员工填写 → 绩效直属上级 → 部门负责人 → 员工确认 → 分管领导`.
- Existing same-person merge and self-review skip rules remain unchanged.

## Review Focus

- A one-person custom cycle must not gain the configured company leader; covered by Task 1 launch/preflight tests.
- A full-company cycle may contain the top leader in legacy storage, but the participant-record response must not count or return `top_leader_exempt`; covered by Task 2 service tests.
- Ordinary cycle exemptions must remain visible and counted after filtering the top leader; covered by Task 2 service tests.
- Historical launch plans with missing relation fields must return `null` rather than fail; covered by Task 2 parser tests.
- PC and 390px views must show the generic chain and each employee's frozen manager, department head, and supervising leader without the removed technical copy; covered by Task 3 Playwright tests.

---

### Task 1: Stop injecting the company leader into new cycle scope

**Files:**
- Modify: `api/src/cycles/launch.service.spec.ts`
- Modify: `api/src/cycles/launch.service.ts`

**Interfaces:**
- Consumes: `findCandidates(...)` selected employees and existing `resolveParticipantDisposition(...)` behavior.
- Produces: preflight and launch plans whose candidate list is exactly `selection.included`; no call to `includeCompanyFinalApprover(...)`.

- [ ] **Step 1: Write the failing tests**

Add focused cases proving a workflow-v2 cycle selecting one employee returns `participantCount: 1`, contains no `top_leader_exempt`, creates no task for the configured company leader, and still freezes the configured leader ID for backward compatibility.

- [ ] **Step 2: Run the tests and verify RED**

Run: `cd api; npm test -- --runInBand src/cycles/launch.service.spec.ts`

Expected: FAIL because preflight returns two participants and launch creates the injected company-leader task.

- [ ] **Step 3: Implement the minimal source change**

Use `selection.included` directly in `preflight(...)` and `launch(...)`; remove the now-unused `includeCompanyFinalApprover(...)` helper. Keep company-leader configuration validation and `resolveParticipantDisposition(...)` for explicitly selected legacy/top-leader cases.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `cd api; npm test -- --runInBand src/cycles/launch.service.spec.ts`

Expected: all launch-service tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/src/cycles/launch.service.ts api/src/cycles/launch.service.spec.ts
git commit -m "fix(performance): keep approvers out of cycle scope"
```

### Task 2: Normalize historical participant records at the API boundary

**Files:**
- Modify: `api/src/cycles/cycles.service.spec.ts`
- Modify: `api/src/cycles/cycles.service.ts`

**Interfaces:**
- Consumes: frozen `launchPlan.participants` and actual task dispositions.
- Produces: `findParticipantRecord(id)` with `top_leader_exempt` removed, summary derived from remaining rows, and nullable `deptHeadId`, `deptHeadName`, `approverId`, `approverName` on each participant.

- [ ] **Step 1: Write the failing tests**

Extend the participant-record fixture with one active employee, one ordinary `cycle_exempt` employee, and one injected `top_leader_exempt` leader. Assert the response contains only the first two, summary is `{ total: 2, active: 1, exempted: 1 }`, frozen relation names are returned, and missing relation fields normalize to `null`.

- [ ] **Step 2: Run the tests and verify RED**

Run: `cd api; npm test -- --runInBand src/cycles/cycles.service.spec.ts`

Expected: FAIL because the top leader is counted and frozen department-head/approver fields are discarded.

- [ ] **Step 3: Implement the minimal source change**

Extend `FrozenLaunchParticipant` and `frozenLaunchParticipants(...)` with nullable department-head and approver fields. Filter `participantDisposition === 'top_leader_exempt'` before merging task state and computing summary.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `cd api; npm test -- --runInBand src/cycles/cycles.service.spec.ts`

Expected: all cycle-service tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/src/cycles/cycles.service.ts api/src/cycles/cycles.service.spec.ts
git commit -m "fix(performance): clean historical cycle scope records"
```

### Task 3: Replace technical cycle metadata with the business review chain

**Files:**
- Modify: `web/src/types/api.types.ts`
- Modify: `web/src/views/admin/components/CycleWorkspaceShell.vue`
- Modify: `web/e2e/specs/14-cycle-management-compact.spec.ts`
- Modify: `web/e2e/specs/25-cycle-scoring-plan.spec.ts`

**Interfaces:**
- Consumes: Task 2 participant fields `deptHeadName` and `approverName`.
- Produces: the approved header copy and personnel table columns `绩效直属上级`, `部门负责人`, `分管领导` for preflight and launched records.

- [ ] **Step 1: Write the failing Playwright assertions**

Update the integrated-cycle and launched-record fixtures to assert the exact goal-review chain, actual frozen people per row, absence of `周期结束统一评分`, `已调整月份`, `公司负责人（不参与绩效审批）`, and absence of the injected leader from the launched participant record. Cover 1440px and 390px viewports.

- [ ] **Step 2: Run the tests and verify RED**

Run: `cd web; npx playwright test e2e/specs/14-cycle-management-compact.spec.ts e2e/specs/25-cycle-scoring-plan.spec.ts --project=chromium --workers=1`

Expected: FAIL because the technical metadata row remains and launched records hide department-head/supervising-leader columns.

- [ ] **Step 3: Implement the minimal UI and type changes**

Extend `CycleParticipantRecord` fields, replace the scoring metadata row with the exact chain copy, remove the obsolete scoring helper/count from the workspace, show `部门负责人` and `分管领导` for both preflight and historical rows, and keep source explanations only for preflight.

- [ ] **Step 4: Run Web verification**

Run:

```bash
cd web
npx playwright test e2e/specs/14-cycle-management-compact.spec.ts e2e/specs/25-cycle-scoring-plan.spec.ts --project=chromium --workers=1
npm run type-check
npm run build
```

Expected: focused Playwright tests, type-check, and production build pass.

- [ ] **Step 5: Run API regression and builds**

Run:

```bash
cd api
npm test -- --runInBand src/cycles/launch.service.spec.ts src/cycles/cycles.service.spec.ts
npm run build
```

Expected: both focused suites and API build pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/types/api.types.ts web/src/views/admin/components/CycleWorkspaceShell.vue web/e2e/specs/14-cycle-management-compact.spec.ts web/e2e/specs/25-cycle-scoring-plan.spec.ts
git commit -m "fix(performance): clarify cycle scope and review chain"
```

### Task 4: Final review and delivery boundary

**Files:**
- Review only: all files changed by Tasks 1-3

**Interfaces:**
- Consumes: committed implementation and verification output.
- Produces: clean branch, evidence summary, and explicit separation of implemented/committed/deployed/business-accepted states.

- [ ] **Step 1: Inspect the aggregate diff and repository state**

Run: `git diff main...HEAD --check; git status --short --branch; git log --oneline main..HEAD`

Expected: only the approved design, plan, API, Web, and focused tests are present; worktree is clean.

- [ ] **Step 2: Perform whole-branch review**

Check scope counts, legacy compatibility, null fields, responsive layout, and that no workflow state/data mutation was introduced.

- [ ] **Step 3: Report without publishing**

Report code/test/commit status separately. Do not merge to `main`, push, deploy, or alter production data without the user's explicit release instruction.
