# Manager Team Performance Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build the complete supervisor workflow in /tasks for team goal review and manager evaluation, including compact expandable indicators, department/user visibility, target alignment, batch review, drafts, submission, and conditional withdrawal.

**Architecture:** Keep the existing NestJS modular monolith and Prisma task state machine. Add focused team-query and indicator-visibility services beside TasksService, expose explicit team and review endpoints, and compose the Vue workspace from small list, indicator, review, evaluation, and reference components. Existing employee task flows remain intact; /manager/scoring becomes a compatibility redirect.

**Tech Stack:** NestJS 10, Prisma 5, PostgreSQL, Jest, Vue 3, TypeScript 5.6, Pinia, Vue Router 4, Element Plus 2.8, Playwright 1.61.

## Global Constraints

- Work directly in the existing modular monolith; do not introduce microservices, queues, or new middleware.
- /tasks is the only active employee/supervisor performance-workspace entry.
- Team queries and team write operations must require assessmentTask.managerId === viewer.id.
- Historical indicators migrate to visibility scope supervisors.
- Custom visibility accepts both department ids and user ids and requires at least one selection.
- A task employee, assigned manager, and legal workflow actor always retain task-detail access.
- Batch review uses one transaction per task and returns partial success instead of rolling back the entire batch.
- Manager evaluation is submitted one employee at a time; drafts do not transition task status.
- Withdrawal is allowed only before the immediate next node records an action.
- Indicators are collapsed by default; the first invalid, rejected, or unsaved indicator auto-expands.
- Desktop acceptance viewport is 1440x900; narrow-screen acceptance viewport is 390x844.
- Use existing Element Plus icons, card radii no greater than 8px, no nested cards, and no decorative gradients.
- Every write endpoint validates task state, actor, and expected updatedAt on the server.

## File Structure

- api/prisma/schema.prisma: visibility enums, join models, target alignment, and withdraw action.
- api/src/tasks/team-task-stage.ts: canonical stage-to-status mapping shared by team queries and counts.
- api/src/tasks/team-tasks.service.ts: exact-manager team list, facets, counts, batch goal review.
- api/src/tasks/indicator-visibility.service.ts: visibility selection validation and reference visibility rules.
- api/src/tasks/tasks.service.ts: task detail mapping, indicator persistence, manager draft/final submission/withdrawal.
- web/src/views/task/use-task-workspace-query.ts: URL parsing and updates for scope, stage, filters, and selected task.
- web/src/views/task/components/TeamTaskList.vue: filters, counts, selection, and batch commands.
- web/src/views/task/components/TeamMemberRail.vue: employee switching in detail mode.
- web/src/views/task/components/PerformanceIndicatorList.vue: stable compact rows and inline disclosure.
- web/src/views/task/components/IndicatorVisibilityEditor.vue: scope selector plus department/user custom selection.
- web/src/views/task/components/GoalReviewWorkspace.vue: single-employee review.
- web/src/views/task/components/ManagerEvaluationWorkspace.vue: side-by-side self/manager evaluation, draft, submit, withdraw.
- web/src/views/task/components/PerformanceReferencePanel.vue: aligned objectives and flow history.

---

### Task 1: Add indicator visibility, alignment, and withdrawal schema

**Files:**
- Modify: api/prisma/schema.prisma:151,290,319,592,691,1010
- Create: api/prisma/migrations/20260808000001_add_indicator_visibility_alignment/migration.sql
- Create: api/src/tasks/indicator-schema.contract.spec.ts

**Interfaces:**
- Produces: Prisma enum IndicatorVisibilityScope and relations visibleDepartments, visibleUsers, objectiveAlignments.
- Produces: FlowAction.withdraw for Task 5.

- [ ] **Step 1: Write the failing Prisma contract test**

~~~ts
import { FlowAction, IndicatorVisibilityScope } from '@prisma/client';

describe('indicator visibility Prisma contract', () => {
  it('exports every supported scope and withdraw action', () => {
    expect(Object.values(IndicatorVisibilityScope)).toEqual([
      'company',
      'department',
      'department_tree',
      'direct_reports',
      'all_reports',
      'supervisors',
      'custom',
    ]);
    expect(FlowAction.withdraw).toBe('withdraw');
  });
});
~~~

- [ ] **Step 2: Run the contract test and verify it fails**

Run: cd api && npm test -- indicator-schema.contract.spec.ts --runInBand

Expected: FAIL because IndicatorVisibilityScope and FlowAction.withdraw do not exist in the generated client.

- [ ] **Step 3: Add schema relations and migration**

Add this enum and the corresponding fields:

~~~prisma
enum IndicatorVisibilityScope {
  company
  department
  department_tree
  direct_reports
  all_reports
  supervisors
  custom

  @@map("indicator_visibility_scope")
}

model IndicatorVisibilityDepartment {
  indicatorInstanceId String @map("indicator_instance_id") @db.Uuid
  departmentId        String @map("department_id") @db.Uuid
  indicatorInstance   IndicatorInstance @relation(fields: [indicatorInstanceId], references: [id], onDelete: Cascade)
  department          Department @relation(fields: [departmentId], references: [id], onDelete: Cascade)

  @@id([indicatorInstanceId, departmentId])
  @@index([departmentId])
  @@map("indicator_visibility_departments")
}

model IndicatorVisibilityUser {
  indicatorInstanceId String @map("indicator_instance_id") @db.Uuid
  userId              String @map("user_id") @db.Uuid
  indicatorInstance   IndicatorInstance @relation(fields: [indicatorInstanceId], references: [id], onDelete: Cascade)
  user                User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([indicatorInstanceId, userId])
  @@index([userId])
  @@map("indicator_visibility_users")
}

model IndicatorObjectiveAlignment {
  indicatorInstanceId String @map("indicator_instance_id") @db.Uuid
  objectiveId         String @map("objective_id") @db.Uuid
  indicatorInstance   IndicatorInstance @relation(fields: [indicatorInstanceId], references: [id], onDelete: Cascade)
  objective           Objective @relation(fields: [objectiveId], references: [id], onDelete: Cascade)

  @@id([indicatorInstanceId, objectiveId])
  @@index([objectiveId])
  @@map("indicator_objective_alignments")
}
~~~

Add visibilityScope with @default(supervisors) to IndicatorInstance, add the three relation arrays to their parent models, and add withdraw to FlowAction. The SQL migration must create the enum and join tables, alter indicator_instances with a non-null supervisors default, add indexes/foreign keys, and execute:

~~~sql
ALTER TYPE "flow_action" ADD VALUE IF NOT EXISTS 'withdraw';
~~~

- [ ] **Step 4: Generate Prisma client and pass validation**

Run: cd api && npx prisma format && npx prisma validate && npm run prisma:generate && npm test -- indicator-schema.contract.spec.ts --runInBand

Expected: Prisma schema valid and the contract test PASS.

- [ ] **Step 5: Commit the schema contract**

~~~bash
git add api/prisma/schema.prisma api/prisma/migrations/20260808000001_add_indicator_visibility_alignment api/src/tasks/indicator-schema.contract.spec.ts
git commit -m "feat(api): add indicator visibility schema"
~~~

### Task 2: Add exact-manager team task queries and stage counts

**Files:**
- Create: api/src/tasks/team-task-stage.ts
- Create: api/src/tasks/team-task-stage.spec.ts
- Create: api/src/tasks/dto/team-task-query.dto.ts
- Create: api/src/tasks/team-tasks.service.ts
- Create: api/src/tasks/team-tasks.service.spec.ts
- Modify: api/src/tasks/tasks.controller.ts:20-45
- Modify: api/src/tasks/tasks.module.ts:1-13

**Interfaces:**
- Produces: TeamTaskStage = 'goal-review' | 'manager-eval'.
- Produces: TeamStageState = 'not_started' | 'pending' | 'completed' | 'exempted'.
- Produces: TeamTasksService.findAll(dto, viewer): Promise<TeamTaskPage>.
- Produces: GET /tasks/team before the /tasks/:id route.

- [ ] **Step 1: Write failing stage and scope tests**

~~~ts
expect(getTeamStageState('indicator_reviewing', 'goal-review')).toBe('pending');
expect(getTeamStageState('indicator_confirming', 'goal-review')).toBe('completed');
expect(getTeamStageState('self_eval', 'manager-eval')).toBe('not_started');
expect(getTeamStageState('manager_scoring', 'manager-eval')).toBe('pending');
expect(getTeamStageState('dept_review', 'manager-eval')).toBe('completed');
expect(getTeamStageState('exempted', 'manager-eval')).toBe('exempted');

await service.findAll(query, managerViewer);
expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(
  expect.objectContaining({
    where: expect.objectContaining({ managerId: managerViewer.id }),
  }),
);
~~~

The service test must also assert that a requested deptId, employeeId, keyword, and stage state are combined with managerId instead of replacing it.

- [ ] **Step 2: Run focused tests and verify failure**

Run: cd api && npm test -- team-task-stage.spec.ts team-tasks.service.spec.ts --runInBand

Expected: FAIL because the stage module and TeamTasksService do not exist.

- [ ] **Step 3: Implement canonical team query contracts**

Define:

~~~ts
export type TeamTaskStage = 'goal-review' | 'manager-eval';
export type TeamStageState = 'not_started' | 'pending' | 'completed' | 'exempted';

export interface TeamTaskCounts {
  all: number;
  notStarted: number;
  pending: number;
  completed: number;
  exempted: number;
}

export interface TeamTaskListItem extends TaskListItem {
  employeeNo: string | null;
  avatarUrl: string | null;
  position: string | null;
  stageState: TeamStageState;
}

export interface TeamTaskPage extends Paginated<TeamTaskListItem> {
  counts: TeamTaskCounts;
  facets: {
    departments: Array<{ id: string; name: string }>;
    employees: Array<{ id: string; name: string; employeeNo: string | null; deptId: string | null }>;
  };
}
~~~

TeamTaskQueryDto extends PaginationDto and validates stage, stageState, cycleId, deptId, employeeId, and keyword. TeamTasksService must start every query with:

~~~ts
const authorizedWhere: Prisma.AssessmentTaskWhereInput = {
  managerId: viewer.id,
};
~~~

Use these exact status groups:

~~~ts
export const TEAM_STAGE_STATUSES = {
  'goal-review': {
    not_started: ['pending', 'indicator_drafting', 'indicator_setting'],
    pending: ['indicator_reviewing'],
    completed: [
      'indicator_confirming',
      'self_eval',
      'manager_scoring',
      'dept_review',
      'hr_calibration',
      'approval',
      'published',
      'confirmed',
      'appealing',
      'closed',
    ],
  },
  'manager-eval': {
    not_started: [
      'pending',
      'indicator_drafting',
      'indicator_setting',
      'indicator_reviewing',
      'indicator_confirming',
      'self_eval',
    ],
    pending: ['manager_scoring'],
    completed: [
      'dept_review',
      'hr_calibration',
      'approval',
      'published',
      'confirmed',
      'appealing',
      'closed',
    ],
  },
} as const;
~~~

exempted maps to exempted for both stages and is excluded from pending/not-started/completed counts.

Counts apply cycle, department, employee, and keyword filters but exclude stageState; item pagination applies stageState. Facets come from the same managerId and cycleId scope so unauthorized employees never appear.

- [ ] **Step 4: Expose GET /tasks/team and pass tests**

Register TeamTasksService in TasksModule. Inject it into TasksController and place @Get('team') before @Get(':id').

Run: cd api && npm test -- team-task-stage.spec.ts team-tasks.service.spec.ts --runInBand && npm run build

Expected: focused tests and Nest build PASS.

- [ ] **Step 5: Commit team querying**

~~~bash
git add api/src/tasks/team-task-stage.ts api/src/tasks/team-task-stage.spec.ts api/src/tasks/dto/team-task-query.dto.ts api/src/tasks/team-tasks.service.ts api/src/tasks/team-tasks.service.spec.ts api/src/tasks/tasks.controller.ts api/src/tasks/tasks.module.ts
git commit -m "feat(api): add supervisor team task query"
~~~

### Task 3: Persist visibility selections and objective alignment

**Files:**
- Create: api/src/tasks/indicator-visibility.service.ts
- Create: api/src/tasks/indicator-visibility.service.spec.ts
- Create: api/src/tasks/dto/reference-indicator-query.dto.ts
- Create: api/src/tasks/task-version.ts
- Create: api/src/tasks/task-version.spec.ts
- Modify: api/src/common/services/data-scope.service.ts
- Modify: api/src/common/services/data-scope.service.spec.ts
- Modify: api/src/objectives/objectives.service.ts:96-126
- Modify: api/src/objectives/objectives.module.ts:1-12
- Modify: api/src/tasks/tasks.module.ts:1-16
- Modify: api/src/tasks/tasks.controller.ts:20-55
- Modify: api/src/tasks/dto/set-indicators.dto.ts:1-100
- Modify: api/src/tasks/tasks.service.ts:20-105,260-285,450-555,981-1090

**Interfaces:**
- Produces: IndicatorVisibilityService.validateSelection(selection, task, viewer): Promise<void>.
- Produces: IndicatorVisibilityService.buildReferenceWhere(viewer): Promise<Prisma.IndicatorInstanceWhereInput>.
- Produces: IndicatorVisibilityService.findVisibleReferences(query, viewer): Promise<Paginated<IndicatorReferenceItem>>.
- Produces: ObjectivesService.assertVisibleIds(ids, viewer): Promise<void>.
- Produces: ObjectivesService.findVisibleByIds(ids, viewer): Promise<ObjectiveNode[]>.
- Produces: GET /tasks/reference-indicators before the /tasks/:id route.
- Produces: assertTaskVersion(updatedAt, expectedUpdatedAt) for Tasks 4 and 5.
- Extends each indicator request with visibilityScope, visibleDepartmentIds, visibleUserIds, alignedObjectiveIds.
- Extends task detail indicators with visible ids and aligned objective summaries.

- [ ] **Step 1: Write failing validation and persistence tests**

~~~ts
await expect(
  visibility.validateSelection(
    {
      visibilityScope: 'custom',
      visibleDepartmentIds: [],
      visibleUserIds: [],
      alignedObjectiveIds: [],
    },
    task,
    manager,
  ),
).rejects.toThrow('自定义可见范围至少选择一个部门或员工');

await service.setIndicators('task-1', dtoWithVisibility, manager);
expect(prisma.indicatorInstance.create).toHaveBeenCalledWith(
  expect.objectContaining({
    data: expect.objectContaining({
      visibilityScope: 'custom',
      visibleDepartments: { createMany: { data: [{ departmentId: 'dept-2' }] } },
      visibleUsers: { createMany: { data: [{ userId: 'user-2' }] } },
      objectiveAlignments: { createMany: { data: [{ objectiveId: 'objective-1' }] } },
    }),
  }),
);
~~~

Also test that unauthorized selected users/departments/objectives throw ForbiddenException and that non-custom scopes reject stray custom ids.
Add a task-detail test where two objectives are aligned but findVisibleByIds returns one; alignedObjectives must contain only that visible objective.

Add reference-query tests for every scope:

~~~ts
const where = await visibility.buildReferenceWhere(viewer);
expect(where.OR).toEqual(expect.arrayContaining([
  { visibilityScope: 'company' },
  { visibilityScope: 'department', task: { deptId: viewer.deptId } },
  { visibilityScope: 'supervisors', task: { managerId: viewer.id } },
  { visibleUsers: { some: { userId: viewer.id } } },
]));
~~~

Add a task-version test:

~~~ts
expect(() => assertTaskVersion(
  new Date('2026-08-08T08:00:01.000Z'),
  '2026-08-08T08:00:00.000Z',
)).toThrow('任务已被其他操作更新，请刷新后重试');
~~~

- [ ] **Step 2: Run focused tests and verify failure**

Run: cd api && npm test -- indicator-visibility.service.spec.ts task-version.spec.ts data-scope.service.spec.ts tasks.service.spec.ts --runInBand

Expected: FAIL because visibility fields and service do not exist.

- [ ] **Step 3: Implement centralized validation**

IndicatorVisibilityService must:

- Accept all seven scope values.
- Require at least one selected department or user for custom.
- Require empty custom lists for non-custom scopes.
- Validate selected users through DataScopeService.getVisibleEmployeeFilter(viewer).
- Validate selected departments against departments represented in the viewer's visible employee scope; HR, system_admin, and canViewAll may select any active department.
- Call ObjectivesService.assertVisibleIds for aligned objective ids.
- Deduplicate all id arrays before persistence.

Reference visibility uses these exact server-side rules:

- The indicator owner can always discover their own indicator.
- company: any authenticated user.
- department: viewer.deptId equals the indicator task deptId.
- department_tree: the indicator task deptId is in the viewer department's ancestor chain.
- direct_reports: the indicator owner is viewer.directManagerId.
- all_reports: the indicator owner is in the viewer's direct-manager chain.
- supervisors: the indicator task managerId equals viewer.id.
- custom: visibleUsers contains viewer.id or visibleDepartments contains viewer.deptId.

Add DataScopeService.getAncestorDeptIds(deptId) and getManagerChainIds(userId) with cycle detection and focused unit tests. ReferenceIndicatorQueryDto validates cycleId, ownerId, keyword, page, and pageSize. findVisibleReferences always combines the visibility OR clause with the query filters and returns only id, taskId, cycleId, employee id/name, indicator name, weight, and visibilityScope.

SetIndicatorsDto adds required expectedUpdatedAt. Call assertTaskVersion immediately after loading the task and before replacing indicators. task-version.ts compares normalized ISO timestamps and throws ConflictException with ERROR_CODE.CONFLICT on mismatch.

Export ObjectivesService from ObjectivesModule. Implement assertVisibleIds and findVisibleByIds by applying the same buildWhere visibility rules used by findAll. assertVisibleIds returns ForbiddenException when any submitted id is missing or invisible without revealing which protected objective exists; findVisibleByIds quietly omits invisible objectives for read responses.

- [ ] **Step 4: Save nested relations and return them in task detail**

Replace indicator createMany with one indicatorInstance.create per normalized item so nested createMany relations are written atomically. Include visibleDepartments, visibleUsers, and objectiveAlignments.objective in findOne. Collect aligned ids, call ObjectivesService.findVisibleByIds for the viewer, and pass the returned id set into buildTaskDetail so invisible reference objectives are omitted. Then map:

~~~ts
visibilityScope: ind.visibilityScope,
visibleDepartmentIds: ind.visibleDepartments.map((row) => row.departmentId),
visibleUserIds: ind.visibleUsers.map((row) => row.userId),
alignedObjectives: ind.objectiveAlignments.map(({ objective }) => ({
  id: objective.id,
  title: objective.title,
  level: objective.level,
  ownerId: objective.ownerId,
})),
~~~

Run: cd api && npm test -- indicator-visibility.service.spec.ts task-version.spec.ts data-scope.service.spec.ts tasks.service.spec.ts --runInBand && npm run build

Expected: tests and build PASS.

- [ ] **Step 5: Commit visibility and alignment persistence**

~~~bash
git add api/src/tasks/indicator-visibility.service.ts api/src/tasks/indicator-visibility.service.spec.ts api/src/tasks/dto/reference-indicator-query.dto.ts api/src/tasks/task-version.ts api/src/tasks/task-version.spec.ts api/src/common/services/data-scope.service.ts api/src/common/services/data-scope.service.spec.ts api/src/objectives/objectives.service.ts api/src/objectives/objectives.module.ts api/src/tasks/tasks.module.ts api/src/tasks/tasks.controller.ts api/src/tasks/dto/set-indicators.dto.ts api/src/tasks/tasks.service.ts
git commit -m "feat(api): persist indicator visibility and alignment"
~~~

### Task 4: Add partial-success batch goal review

**Files:**
- Create: api/src/tasks/dto/batch-indicator-review.dto.ts
- Modify: api/src/tasks/team-tasks.service.ts
- Modify: api/src/tasks/team-tasks.service.spec.ts
- Modify: api/src/tasks/tasks.controller.ts

**Interfaces:**
- Produces: POST /tasks/team/indicator-review/batch-approve.
- Produces: POST /tasks/team/indicator-review/batch-reject.
- Produces: BatchReviewResult with succeeded and failed arrays.

- [ ] **Step 1: Write failing partial-success tests**

~~~ts
const result = await service.batchApprove(
  {
    tasks: [
      { taskId: 'valid-task', updatedAt: '2026-08-08T08:00:00.000Z' },
      { taskId: 'foreign-task', updatedAt: '2026-08-08T08:00:00.000Z' },
    ],
  },
  manager,
);

expect(result.succeeded).toEqual([
  { taskId: 'valid-task', status: 'indicator_confirming' },
]);
expect(result.failed).toEqual([
  expect.objectContaining({ taskId: 'foreign-task', reason: '无权审核该员工目标' }),
]);
~~~

Add tests for non-100% total weight, empty indicators, stale updatedAt, common reject reason, and one independent transaction per task.

- [ ] **Step 2: Run the tests and verify failure**

Run: cd api && npm test -- team-tasks.service.spec.ts --runInBand

Expected: FAIL because batch methods and DTOs do not exist.

- [ ] **Step 3: Implement per-task review transactions**

Define:

~~~ts
export class BatchTaskRefDto {
  @IsUUID()
  taskId!: string;

  @IsISO8601()
  updatedAt!: string;
}

export interface BatchReviewResult {
  succeeded: Array<{ taskId: string; status: TaskStatus }>;
  failed: Array<{ taskId: string; reason: string }>;
}
~~~

For each task:

1. Load by id.
2. Require managerId === viewer.id.
3. Require status === indicator_reviewing.
4. Call assertTaskVersion with the request updatedAt.
5. Require at least one indicator and decimal weight sum within 0.0001 of 1.
6. Run an independent Prisma transaction.
7. Use FlowService.transitionTx with submit to indicator_confirming or reject to indicator_drafting.
8. Write a batchId in extraData and notify the employee after a successful transaction.

Catch the business exception for that task, append failed, and continue.

- [ ] **Step 4: Expose both endpoints and pass tests**

Run: cd api && npm test -- team-tasks.service.spec.ts --runInBand && npm run build

Expected: partial-success tests and build PASS.

- [ ] **Step 5: Commit batch review**

~~~bash
git add api/src/tasks/dto/batch-indicator-review.dto.ts api/src/tasks/team-tasks.service.ts api/src/tasks/team-tasks.service.spec.ts api/src/tasks/tasks.controller.ts
git commit -m "feat(api): add batch goal review"
~~~

### Task 5: Add manager evaluation drafts and conditional withdrawal

**Files:**
- Create: api/src/tasks/dto/save-manager-evaluation-draft.dto.ts
- Create: api/src/tasks/dto/withdraw-manager-score.dto.ts
- Modify: api/src/tasks/dto/submit-manager-score.dto.ts
- Modify: api/src/tasks/tasks.service.ts:688-803
- Modify: api/src/tasks/tasks.service.spec.ts
- Modify: api/src/tasks/tasks.controller.ts:105-130

**Interfaces:**
- Produces: PUT /tasks/:id/manager-evaluation-draft.
- Produces: POST /tasks/:id/manager-score/withdraw.
- Extends final submit with expectedUpdatedAt.

- [ ] **Step 1: Write failing draft and withdrawal tests**

~~~ts
await service.saveManagerEvaluationDraft('task-1', draftDto, manager);
expect(prisma.assessmentTask.update).toHaveBeenCalledWith(
  expect.objectContaining({ data: expect.objectContaining({ updatedAt: expect.any(Date) }) }),
);
expect(prisma.managerEvalSummary.upsert).toHaveBeenCalledWith(
  expect.objectContaining({
    create: expect.objectContaining({ submittedAt: null }),
    update: expect.objectContaining({ submittedAt: null }),
  }),
);
expect(flowService.transitionTx).not.toHaveBeenCalled();

const result = await service.withdrawManagerScore(
  'task-1',
  { expectedUpdatedAt: '2026-08-08T08:00:00.000Z' },
  manager,
);
expect(result.status).toBe('manager_scoring');
expect(prisma.flowRecord.create).toHaveBeenCalledWith(
  expect.objectContaining({ data: expect.objectContaining({ action: 'withdraw' }) }),
);
~~~

Add rejection tests for wrong manager, stale updatedAt, wrong status, deptReviewedAt/hrCalibratedAt present, and any flow record after managerScoredAt at dept_review or later.

- [ ] **Step 2: Run focused tests and verify failure**

Run: cd api && npm test -- tasks.service.spec.ts --runInBand

Expected: FAIL because draft and withdrawal methods do not exist.

- [ ] **Step 3: Implement draft persistence and stale-write checks**

Draft indicator items allow optional managerScore and managerComment; final submit still requires every score. Both DTOs carry expectedUpdatedAt. Draft persistence:

- Requires managerId === viewer.id and status manager_scoring.
- Compares expectedUpdatedAt to task.updatedAt.
- Updates only supplied indicator fields.
- Upserts ManagerEvalSummary with submittedAt null.
- Does not calculate GradeResult and does not transition status.
- Writes one FlowRecord comment with extraData.type manager_evaluation_draft_saved.

Reuse assertTaskVersion from Task 3 in draft, final submit, and withdraw. Batch review already uses it from Task 4; indicator save uses it from Task 3.

- [ ] **Step 4: Implement guarded withdrawal and pass tests**

Withdrawal must run in one transaction and:

~~~ts
await tx.assessmentTask.update({
  where: { id: task.id },
  data: {
    status: 'manager_scoring',
    managerScoredAt: null,
    updatedAt: new Date(),
  },
});
await tx.managerEvalSummary.update({
  where: { taskId: task.id },
  data: { submittedAt: null },
});
await tx.flowRecord.create({
  data: {
    taskId: task.id,
    cycleId: task.cycleId,
    nodeType: 'manager_score',
    actorId: viewer.id,
    action: 'withdraw',
    extraData: { type: 'manager_score_withdrawn' },
  },
});
~~~

Preserve manager scores, comments, extra scores, GradeResult, and summary text as draft data.

Run: cd api && npm test -- tasks.service.spec.ts --runInBand && npm run build

Expected: focused tests and build PASS.

- [ ] **Step 5: Commit draft and withdrawal**

~~~bash
git add api/src/tasks/dto/save-manager-evaluation-draft.dto.ts api/src/tasks/dto/withdraw-manager-score.dto.ts api/src/tasks/dto/submit-manager-score.dto.ts api/src/tasks/tasks.service.ts api/src/tasks/tasks.service.spec.ts api/src/tasks/tasks.controller.ts
git commit -m "feat(api): add manager evaluation draft and withdrawal"
~~~

### Task 6: Add web API contracts and URL workspace state

**Files:**
- Modify: web/src/types/api.types.ts:402-700
- Modify: web/src/types/enums.ts
- Modify: web/src/api/tasks.api.ts:1-130
- Create: web/src/views/task/use-task-workspace-query.ts
- Create: web/e2e/specs/10-team-performance-contract.spec.ts

**Interfaces:**
- Produces: TeamTaskPage, TeamTaskQuery, BatchReviewResult, IndicatorVisibilityScope.
- Produces: tasksApi.findTeam, tasksApi.findReferenceIndicators, tasksApi.batchApproveIndicators, tasksApi.batchRejectIndicators, tasksApi.saveManagerEvaluationDraft, tasksApi.withdrawManagerScore.
- Produces: parseTaskWorkspaceQuery, updateTaskWorkspaceQuery, and useTaskWorkspaceQuery.

Exact signatures:

~~~ts
export function parseTaskWorkspaceQuery(query: LocationQuery): TaskWorkspaceQuery;
export function updateTaskWorkspaceQuery(
  router: Router,
  current: LocationQuery,
  patch: Partial<TaskWorkspaceQuery>,
): Promise<NavigationFailure | void | undefined>;
export function useTaskWorkspaceQuery(): {
  state: ComputedRef<TaskWorkspaceQuery>;
  update: (patch: Partial<TaskWorkspaceQuery>) => Promise<NavigationFailure | void | undefined>;
};
~~~

- [ ] **Step 1: Write failing contract and URL tests**

~~~ts
import { parseTaskWorkspaceQuery } from '../../src/views/task/use-task-workspace-query';

test('normalizes team workspace query', () => {
  expect(parseTaskWorkspaceQuery({
    scope: 'team',
    stage: 'manager-eval',
    cycleId: 'cycle-1',
    taskId: 'task-1',
  })).toEqual(expect.objectContaining({
    scope: 'team',
    stage: 'manager-eval',
    cycleId: 'cycle-1',
    taskId: 'task-1',
  }));
});

test('employees cannot normalize unknown scope or stage values', () => {
  expect(parseTaskWorkspaceQuery({ scope: 'bad', stage: 'bad' })).toEqual(
    expect.objectContaining({ scope: 'mine', stage: 'goal-review' }),
  );
});
~~~

- [ ] **Step 2: Run the Playwright contract test and verify failure**

Run: cd web && npx playwright test e2e/specs/10-team-performance-contract.spec.ts

Expected: FAIL because the query module and new API types do not exist.

- [ ] **Step 3: Add exact frontend contracts**

Add:

~~~ts
export type IndicatorVisibilityScope =
  | 'company'
  | 'department'
  | 'department_tree'
  | 'direct_reports'
  | 'all_reports'
  | 'supervisors'
  | 'custom';

export type TeamTaskStage = 'goal-review' | 'manager-eval';
export type TeamStageState = 'not_started' | 'pending' | 'completed' | 'exempted';

export interface TaskWorkspaceQuery {
  scope: 'mine' | 'team';
  stage: TeamTaskStage;
  cycleId?: string;
  deptId?: string;
  employeeId?: string;
  taskId?: string;
  stageState?: TeamStageState;
  keyword?: string;
}
~~~

Extend IndicatorInstance with visibilityScope, visibleDepartmentIds, visibleUserIds, and alignedObjectives. Add IndicatorReferenceItem, expectedUpdatedAt to write bodies, and the six new API methods with their exact server paths.

- [ ] **Step 4: Implement URL parsing and pass checks**

The query composable must use router.replace for filter changes, preserve unrelated recognized keys, remove empty values, and expose scope, stage, cycleId, deptId, employeeId, taskId, stageState, and keyword as computed values.

~~~ts
export function useTaskWorkspaceQuery() {
  const route = useRoute();
  const router = useRouter();
  const state = computed(() => parseTaskWorkspaceQuery(route.query));
  const update = (patch: Partial<TaskWorkspaceQuery>) =>
    updateTaskWorkspaceQuery(router, route.query, patch);
  return { state, update };
}
~~~

Run: cd web && npm run type-check && npx playwright test e2e/specs/10-team-performance-contract.spec.ts

Expected: type-check and contract test PASS.

- [ ] **Step 5: Commit web contracts**

~~~bash
git add web/src/types/api.types.ts web/src/types/enums.ts web/src/api/tasks.api.ts web/src/views/task/use-task-workspace-query.ts web/e2e/specs/10-team-performance-contract.spec.ts
git commit -m "feat(web): add team performance contracts"
~~~

### Task 7: Build the unified team list and member switching shell

**Files:**
- Create: web/src/views/task/components/TeamTaskList.vue
- Create: web/src/views/task/components/TeamMemberRail.vue
- Modify: web/src/views/task/TaskListView.vue
- Modify: web/e2e/specs/10-team-performance-contract.spec.ts

**Interfaces:**
- Consumes: tasksApi.findTeam and useTaskWorkspaceQuery from Task 6.
- Produces: task-selected event carrying taskId and employeeId.
- Produces: batch-approve and batch-reject events carrying selected task versions.

- [ ] **Step 1: Add failing mocked-browser tests**

Mock GET /api/v1/tasks/team and assert:

~~~ts
await page.goto('/tasks?scope=team&stage=goal-review&cycleId=cycle-1');
await expect(page.getByTestId('task-scope-team')).toHaveAttribute('aria-pressed', 'true');
await expect(page.getByTestId('team-count-pending')).toContainText('2');
await expect(page.getByTestId('team-department-filter')).toBeVisible();
await expect(page.getByTestId('team-employee-filter')).toBeVisible();
await page.getByTestId('team-task-row-task-1').click();
await expect(page).toHaveURL(/taskId=task-1/);
~~~

Add an employee storage-state test asserting task-scope-team is absent.

- [ ] **Step 2: Run the tests and verify failure**

Run: cd web && npx playwright test e2e/specs/10-team-performance-contract.spec.ts --grep "team list"

Expected: FAIL because team scope controls and list do not exist.

- [ ] **Step 3: Implement team list and context controls**

TaskListView must:

- Keep the existing mine scope unchanged.
- Show scope controls only when the authenticated user has a manager-capable role.
- Fetch team tasks from tasksApi.findTeam with URL-derived filters.
- Render counts as segmented controls.
- Render department and employee selectors from response facets.
- Keep selected task id in the URL.
- Open TeamMemberRail in detail mode without losing filters.
- Preserve stable dimensions while list/detail requests load.

TeamTaskList emits selected rows and exposes batch commands only in goal-review pending state.

- [ ] **Step 4: Pass focused browser and type checks**

Run: cd web && npm run type-check && npx playwright test e2e/specs/10-team-performance-contract.spec.ts --grep "team list"

Expected: PASS with no horizontal overflow at 1440x900 and 390x844.

- [ ] **Step 5: Commit the team shell**

~~~bash
git add web/src/views/task/components/TeamTaskList.vue web/src/views/task/components/TeamMemberRail.vue web/src/views/task/TaskListView.vue web/e2e/specs/10-team-performance-contract.spec.ts
git commit -m "feat(web): add team performance task shell"
~~~

### Task 8: Build compact goal review, visibility editing, and reference history

**Files:**
- Create: web/src/views/task/components/PerformanceIndicatorList.vue
- Create: web/src/views/task/components/IndicatorVisibilityEditor.vue
- Create: web/src/views/task/components/PerformanceReferencePanel.vue
- Create: web/src/views/task/components/GoalReviewWorkspace.vue
- Modify: web/src/views/task/TaskListView.vue
- Modify: web/src/views/task/components/IndicatorSnapshot.vue
- Modify: web/e2e/specs/10-team-performance-contract.spec.ts

**Interfaces:**
- Consumes: TaskDetail, visibility fields, aligned objectives, and flow records.
- Produces: save, approve, reject events with expectedUpdatedAt.
- Produces: invalid-indicator-ids input that auto-expands the first matching row.

- [ ] **Step 1: Add failing disclosure and visibility tests**

~~~ts
await expect(page.getByTestId('indicator-details-ind-1')).toBeHidden();
await page.getByTestId('indicator-toggle-ind-1').click();
await expect(page.getByTestId('indicator-details-ind-1')).toBeVisible();
await page.getByTestId('indicator-expand-all').click();
await expect(page.getByTestId('indicator-details-ind-2')).toBeVisible();

await page.getByTestId('indicator-visibility-ind-1').click();
await page.getByRole('option', { name: '自定义范围' }).click();
await page.getByTestId('visibility-departments').click();
await page.getByRole('option', { name: '研发部' }).click();
await page.getByTestId('visibility-users').click();
await page.getByRole('option', { name: '张三' }).click();
~~~

Also assert the weight total blocks approval when it is not 100%, and a rejected/invalid indicator opens automatically.

- [ ] **Step 2: Run focused tests and verify failure**

Run: cd web && npx playwright test e2e/specs/10-team-performance-contract.spec.ts --grep "goal review"

Expected: FAIL because compact indicator review components do not exist.

- [ ] **Step 3: Implement the compact indicator primitives**

PerformanceIndicatorList must use a stable CSS grid for number/name, weight, visibility, status, and icon command. It owns a Set of expanded ids, defaults empty, supports expand all/collapse all, and watches invalidIndicatorIds to expand and scroll the first id into view.

IndicatorVisibilityEditor uses one select for the seven scopes. For custom it opens department and employee multi-selects, shows selected counts, and emits normalized unique arrays.

PerformanceReferencePanel has two tabs: aligned objectives and flow history. Its employee-target picker calls tasksApi.findReferenceIndicators, while aligned objectives come from the scoped task-detail response; it never issues an unscoped task or objective request.

- [ ] **Step 4: Wire goal review and employee rejection positioning**

GoalReviewWorkspace loads tasksApi.findOne(taskId), renders the compact list, saves edits, approves one task, or rejects with a required reason. TaskListView handles batch dialogs and displays succeeded/failed items without clearing failed selections.

Adapt IndicatorSnapshot's employee drafting/reviewing presentation to use the same compact disclosure primitive and pass the latest rejected indicator or first validation error id.

Run: cd web && npm run type-check && npx playwright test e2e/specs/10-team-performance-contract.spec.ts --grep "goal review"

Expected: type-check and goal-review tests PASS.

- [ ] **Step 5: Commit goal review UI**

~~~bash
git add web/src/views/task/components/PerformanceIndicatorList.vue web/src/views/task/components/IndicatorVisibilityEditor.vue web/src/views/task/components/PerformanceReferencePanel.vue web/src/views/task/components/GoalReviewWorkspace.vue web/src/views/task/TaskListView.vue web/src/views/task/components/IndicatorSnapshot.vue web/e2e/specs/10-team-performance-contract.spec.ts
git commit -m "feat(web): add compact team goal review"
~~~

### Task 9: Build side-by-side manager evaluation and compatibility redirect

**Files:**
- Create: web/src/views/task/components/ManagerEvaluationWorkspace.vue
- Modify: web/src/views/task/TaskListView.vue
- Modify: web/src/router/index.ts:90-120
- Delete: web/src/views/manager/ManagerScoringView.vue
- Modify: web/e2e/specs/10-team-performance-contract.spec.ts

**Interfaces:**
- Consumes: draft, final submit, and withdrawal API methods from Task 6.
- Produces: dirty-change guard and one-employee submission flow.
- Produces: /manager/scoring redirect to /tasks?scope=team&stage=manager-eval.

- [ ] **Step 1: Add failing evaluation tests**

~~~ts
await page.goto('/tasks?scope=team&stage=manager-eval&taskId=task-2');
await page.getByTestId('indicator-toggle-ind-1').click();
await expect(page.getByTestId('employee-self-comment-ind-1')).toBeVisible();
await page.getByTestId('manager-score-ind-1').fill('88');
await page.getByTestId('manager-comment-ind-1').fill('按期完成，协作良好');
await page.getByTestId('manager-evaluation-save').click();
await expect(page.getByText('草稿已保存')).toBeVisible();
~~~

Add tests for final submit becoming read-only, withdraw appearing only for untouched dept_review/hr_calibration, and blocked withdrawal showing the server reason.

- [ ] **Step 2: Run focused tests and verify failure**

Run: cd web && npx playwright test e2e/specs/10-team-performance-contract.spec.ts --grep "manager evaluation"

Expected: FAIL because the manager evaluation workspace does not exist.

- [ ] **Step 3: Implement manager evaluation**

Use PerformanceIndicatorList. Collapsed rows show name, weight, self-evaluation summary, and manager evaluation status. Expanded rows show target/actual, self score/comment, manager score/comment. The bottom unframed section shows employee summary and editable manager strengths, improvements, development plan, and attachments.

Save sends expectedUpdatedAt and keeps status. Submit requires every indicator score, confirms once, sends the current updatedAt, and reloads read-only task detail. Track a dirty flag and guard member/route changes with ElMessageBox.confirm.

- [ ] **Step 4: Add withdrawal and old-route redirect**

Show withdraw only when current status is dept_review or hr_calibration and managerScoredAt exists. The server remains authoritative; after success reload the task in manager_scoring with existing form values.

Replace the ManagerScoring route component with a redirect function preserving cycleId and taskId query keys:

~~~ts
redirect: (to) => ({
  path: '/tasks',
  query: {
    ...to.query,
    scope: 'team',
    stage: 'manager-eval',
  },
}),
~~~

Run rg -n "ManagerScoringView|/manager/scoring" web/src web/e2e. After the route no longer imports ManagerScoringView and only the compatibility URL assertions remain, delete ManagerScoringView.vue.

Run: cd web && npm run type-check && npx playwright test e2e/specs/10-team-performance-contract.spec.ts --grep "manager evaluation|redirect"

Expected: type-check and focused tests PASS.

- [ ] **Step 5: Commit manager evaluation**

~~~bash
git add -A web/src/views/task/components/ManagerEvaluationWorkspace.vue web/src/views/task/TaskListView.vue web/src/router/index.ts web/src/views/manager/ManagerScoringView.vue web/e2e/specs/10-team-performance-contract.spec.ts
git commit -m "feat(web): add manager evaluation workspace"
~~~

### Task 10: Close the real-role workflow and responsive acceptance

**Files:**
- Create: api/test/suites/11-manager-team-workspace.e2e-spec.ts
- Modify: web/e2e/specs/05-multi-role-happy-path.spec.ts
- Modify: web/e2e/specs/09-performance-workspace.spec.ts
- Modify: web/e2e/specs/10-team-performance-contract.spec.ts

**Interfaces:**
- Consumes: all API and UI behavior from Tasks 1-9.
- Produces: executable acceptance evidence for employee and supervisor roles.

- [ ] **Step 1: Add the API end-to-end workflow**

The new API suite must create a cycle with two employees under one manager and verify:

1. Employee submits indicators with custom department/user visibility and one objective alignment.
2. Manager team query returns both employees and no foreign employee.
3. Batch approve succeeds for the valid task and independently fails a stale task.
4. Employee submits self-evaluation.
5. Manager saves a draft and reloads it.
6. Manager submits final evaluation.
7. Manager withdraws before next-node action.
8. Manager resubmits; department head acts; later withdrawal returns conflict.

Use existing fixture-factory and auth-helper functions; assert flow records include batchId and withdraw.

- [ ] **Step 2: Run the new API E2E suite**

Run: cd api && npm run test:e2e -- --runTestsByPath test/suites/11-manager-team-workspace.e2e-spec.ts

Expected: PASS. If infrastructure setup fails before the first HTTP assertion, record the setup error separately and still keep unit/build evidence.

- [ ] **Step 3: Extend the browser multi-role flow**

In 05-multi-role-happy-path.spec.ts, use employee and manager storage states to perform the same browser journey, including refresh after draft save and URL restoration after returning from task detail. Assert no unauthorized employee appears in department/employee selectors.

- [ ] **Step 4: Run full verification**

Run:

~~~bash
cd api && npm test -- --runInBand
cd api && npm run build
cd web && npm run type-check
cd web && npm run build
cd web && npx playwright test e2e/specs/05-multi-role-happy-path.spec.ts e2e/specs/09-performance-workspace.spec.ts e2e/specs/10-team-performance-contract.spec.ts
~~~

Expected: all commands PASS. Capture browser screenshots at 1440x900 and 390x844; verify no horizontal overflow, text overlap, layout shift, console error, or failed network request.

- [ ] **Step 5: Commit acceptance coverage**

~~~bash
git add api/test/suites/11-manager-team-workspace.e2e-spec.ts web/e2e/specs/05-multi-role-happy-path.spec.ts web/e2e/specs/09-performance-workspace.spec.ts web/e2e/specs/10-team-performance-contract.spec.ts
git commit -m "test: verify manager team performance workflow"
~~~
