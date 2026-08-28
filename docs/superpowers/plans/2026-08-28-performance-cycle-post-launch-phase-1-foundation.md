# Performance Cycle Post-Launch Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backward-compatible workflow-v2 foundation for scoring frequency, monthly schedules, launch snapshots, period rows, V1 indicator-version shells, probation exclusion, and top-leader exemption.

**Architecture:** Keep `AssessmentTask` as the employee-by-cycle participation record and add normalized child records for cycle schedules, assessment periods, and indicator versions. Existing cycles remain `workflowVersion = 1`; phase-1 behavior is created only for `workflowVersion = 2`. The API is the source of truth for default schedules and validation, while the existing Vue cycle form consumes a preview endpoint and keeps the current create/edit/review/launch interaction.

**Tech Stack:** NestJS 10, Prisma 5/PostgreSQL, Jest, Vue 3, TypeScript, Element Plus, Playwright contract tests.

**Spec:** `docs/superpowers/specs/2026-08-28-performance-cycle-post-launch-workflow-design.md`

## Global Constraints

- Do not change or migrate historical `approverId`, `IndicatorInstance`, `GradeResult`, `FlowRecord`, or existing task ownership.
- Existing rows backfill to `workflowVersion = 1`; only newly created v2 cycles use the new records.
- Monthly cycles always use monthly scoring; custom cycles always use cycle scoring; quarterly, semiannual, and annual cycles default to monthly and may be changed to cycle scoring.
- Review frequency is fixed to cycle-level review and is returned as `reviewFrequency: 'cycle'`; do not create a monthly review option.
- Default monthly timing is: next month first statutory workday 09:00 open self-evaluation, third statutory workday 18:00 employee due, and the third statutory workday after that 18:00 manager due.
- Only node-order violations block saving; non-workday, cross-month, long-gap, and overlap risks are warnings.
- Probation employees do not enter a v2 performance plan.
- The configured company final approver (李宏) is exempt from personal performance; do not create a self-managed task.
- Use the HRM `User.directManagerId` relation only; do not use roster manager or DingTalk manager fields.
- Preserve the existing “绩效待办” layout; phase 1 does not redesign task pages.
- Do not publish production without an explicit user instruction to publish.

---

## Phase 1 File Map

### Database and domain

- Modify `api/prisma/schema.prisma`: add v2 enums, cycle fields, relations, schedules, periods, indicator-version shells, and participant disposition.
- Create `api/prisma/migrations/20260828180000_add_performance_workflow_v2_foundation/migration.sql`: additive migration and v1 backfill.
- Modify `api/prisma/seed.ts`: add the company final approver configuration key without guessing a user ID.
- Create `api/src/cycles/cycle-scoring-plan.ts`: pure scoring-frequency and period-definition rules.
- Create `api/src/cycles/cycle-scoring-plan.spec.ts`: pure domain-rule tests.
- Create `api/src/cycles/cycle-workday-calendar.ts`: statutory-workday shifting used by schedule generation.
- Create `api/src/cycles/cycle-schedule.service.ts`: preview, normalization, blocking validation, and warnings.
- Create `api/src/cycles/cycle-schedule.service.spec.ts`: schedule tests.

### Cycle API and launch

- Create `api/src/cycles/dto/cycle-period-schedule.dto.ts`: persisted schedule item validation.
- Create `api/src/cycles/dto/preview-cycle-schedule.dto.ts`: preview request validation.
- Modify `api/src/cycles/dto/create-cycle.dto.ts`: v2 workflow, scoring frequency, and schedules.
- Modify `api/src/cycles/dto/update-cycle.dto.ts`: inherit the new optional fields.
- Modify `api/src/cycles/cycles.controller.ts`: add schedule preview endpoint.
- Modify `api/src/cycles/cycles.module.ts`: register/export schedule service.
- Modify `api/src/cycles/cycles.service.ts`: persist v2 plan and invalidate approval after core changes.
- Modify `api/src/cycles/cycles.service.spec.ts`: persistence and reapproval tests.
- Modify `api/src/cycles/launch.service.ts`: include v2 config in preflight hash and generate period/version records.
- Modify `api/src/cycles/launch.service.spec.ts`: v2 launch, probation exclusion, and top-leader exemption tests.

### Web

- Modify `web/src/types/enums.ts`: v2 scoring/period types.
- Modify `web/src/types/api.types.ts`: schedule preview, cycle fields, period summaries.
- Modify `web/src/api/cycles.api.ts`: preview endpoint.
- Create `web/src/views/admin/components/CycleScoringSettings.vue`: scoring-frequency choice and fixed review-frequency explanation.
- Create `web/src/views/admin/components/CycleMonthlyScheduleEditor.vue`: unified and exceptional-month schedule editing.
- Modify `web/src/views/admin/CycleManageView.vue`: create/edit integration and payload assembly.
- Modify `web/src/views/admin/components/CycleWorkspaceShell.vue`: plan summary and preflight snapshot.
- Modify `web/src/views/admin/components/CycleCompactTable.vue`: concise frequency summary.
- Create `web/e2e/specs/25-cycle-scoring-plan.spec.ts`: v2 creation/edit/review/preflight contract coverage.

### End-to-end acceptance

- Create `api/test/suites/12-performance-workflow-v2-foundation.e2e-spec.ts`: persisted v2 plan and launch records.

---

### Task 1: Add the backward-compatible v2 persistence model

**Files:**

- Modify: `api/prisma/schema.prisma`
- Modify: `api/prisma/seed.ts`
- Create: `api/prisma/migrations/20260828180000_add_performance_workflow_v2_foundation/migration.sql`

**Interfaces:**

- Produces: `ScoringFrequency`, `AssessmentPeriodType`, `AssessmentPeriodStatus`, `IndicatorVersionStatus`, and `ParticipantDisposition` Prisma enums.
- Produces: `AssessmentCycle.workflowVersion`, `AssessmentCycle.scoringFrequency`, `AssessmentCycle.companyFinalApproverId`.
- Produces: `CyclePeriodSchedule`, `AssessmentPeriod`, `IndicatorVersion`, and `IndicatorVersionItem` models.
- Preserves: the existing unique key `AssessmentTask(cycleId, employeeId)` and all v1 columns.

- [ ] **Step 1: Add schema-contract assertions before changing the schema**

Add a new `describe('performance workflow v2 schema')` block to `api/src/tasks/indicator-schema.contract.spec.ts` that reads `api/prisma/schema.prisma` and asserts these fragments without depending on formatter spacing:

```ts
expect(schema).toMatch(/workflowVersion\s+Int\s+@default\(1\)/);
expect(schema).toMatch(/scoringFrequency\s+ScoringFrequency\s+@default\(cycle\)/);
expect(schema).toContain('model CyclePeriodSchedule');
expect(schema).toContain('model AssessmentPeriod');
expect(schema).toContain('model IndicatorVersion');
expect(schema).toContain('@@unique([cycleId, periodKey])');
expect(schema).toContain('@@unique([taskId, periodKey])');
expect(schema).toContain('@@unique([taskId, version])');
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run from `api`:

```powershell
npm test -- --runInBand src/tasks/indicator-schema.contract.spec.ts
```

Expected: FAIL because the v2 fields and models are absent.

- [ ] **Step 3: Add the Prisma enums, fields, and relations**

Add these enums to `api/prisma/schema.prisma`:

```prisma
enum ScoringFrequency {
  monthly
  cycle

  @@map("scoring_frequency")
}

enum AssessmentPeriodType {
  month
  cycle

  @@map("assessment_period_type")
}

enum AssessmentPeriodStatus {
  unopened
  self_eval
  manager_scoring
  completed
  no_result

  @@map("assessment_period_status")
}

enum IndicatorVersionStatus {
  draft
  active
  retired

  @@map("indicator_version_status")
}

enum ParticipantDisposition {
  active
  cycle_exempt
  top_leader_exempt

  @@map("participant_disposition")
}
```

Add to `AssessmentCycle`:

```prisma
workflowVersion          Int              @default(1) @map("workflow_version")
scoringFrequency         ScoringFrequency @default(cycle) @map("scoring_frequency")
companyFinalApproverId   String?          @map("company_final_approver_id") @db.Uuid

companyFinalApprover User?                 @relation("CycleCompanyFinalApprover", fields: [companyFinalApproverId], references: [id], onDelete: SetNull)
periodSchedules       CyclePeriodSchedule[]
```

Add the inverse relation to `User`:

```prisma
companyFinalApproverCycles AssessmentCycle[] @relation("CycleCompanyFinalApprover")
```

Add to `AssessmentTask`:

```prisma
participantDisposition ParticipantDisposition @default(active) @map("participant_disposition")
periods                AssessmentPeriod[]
indicatorVersions      IndicatorVersion[]
```

Add these models:

```prisma
model CyclePeriodSchedule {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  cycleId         String   @map("cycle_id") @db.Uuid
  periodKey       String   @map("period_key") @db.VarChar(20)
  periodType      AssessmentPeriodType @map("period_type")
  sequence        Int
  periodStart     DateTime @map("period_start") @db.Date
  periodEnd       DateTime @map("period_end") @db.Date
  selfEvalOpenAt  DateTime @map("self_eval_open_at") @db.Timestamptz(6)
  selfEvalDueAt   DateTime @map("self_eval_due_at") @db.Timestamptz(6)
  managerDueAt    DateTime @map("manager_due_at") @db.Timestamptz(6)
  isException     Boolean  @default(false) @map("is_exception")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

  cycle           AssessmentCycle @relation(fields: [cycleId], references: [id], onDelete: Cascade)

  @@unique([cycleId, periodKey])
  @@index([cycleId, sequence])
  @@map("cycle_period_schedules")
}

model AssessmentPeriod {
  id                 String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  taskId             String   @map("task_id") @db.Uuid
  periodKey          String   @map("period_key") @db.VarChar(20)
  periodType         AssessmentPeriodType @map("period_type")
  sequence           Int
  periodStart        DateTime @map("period_start") @db.Date
  periodEnd          DateTime @map("period_end") @db.Date
  managerId          String?  @map("manager_id") @db.Uuid
  indicatorVersionId String?  @map("indicator_version_id") @db.Uuid
  status             AssessmentPeriodStatus @default(unopened)
  openedAt           DateTime? @map("opened_at") @db.Timestamptz(6)
  lockedAt           DateTime? @map("locked_at") @db.Timestamptz(6)
  noResultReason     String?  @map("no_result_reason") @db.Text
  createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

  task               AssessmentTask @relation(fields: [taskId], references: [id], onDelete: Cascade)
  manager            User? @relation("PeriodManager", fields: [managerId], references: [id], onDelete: SetNull)
  indicatorVersion   IndicatorVersion? @relation("PeriodIndicatorVersion", fields: [indicatorVersionId], references: [id], onDelete: SetNull)

  @@unique([taskId, periodKey])
  @@index([managerId, status])
  @@index([status, periodStart])
  @@map("assessment_periods")
}

model IndicatorVersion {
  id                     String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  taskId                 String @map("task_id") @db.Uuid
  version                Int
  status                 IndicatorVersionStatus @default(draft)
  effectiveFromPeriodKey String @map("effective_from_period_key") @db.VarChar(20)
  reason                 String? @db.Text
  createdById            String? @map("created_by_id") @db.Uuid
  activatedAt            DateTime? @map("activated_at") @db.Timestamptz(6)
  createdAt              DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt              DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

  task                   AssessmentTask @relation(fields: [taskId], references: [id], onDelete: Cascade)
  createdBy              User? @relation("IndicatorVersionCreator", fields: [createdById], references: [id], onDelete: SetNull)
  items                  IndicatorVersionItem[]
  periods                AssessmentPeriod[] @relation("PeriodIndicatorVersion")

  @@unique([taskId, version])
  @@index([taskId, status])
  @@map("indicator_versions")
}

model IndicatorVersionItem {
  id                  String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  indicatorVersionId  String @map("indicator_version_id") @db.Uuid
  sourceInstanceId    String? @map("source_instance_id") @db.Uuid
  name                String @db.VarChar(200)
  description         String? @db.Text
  scoringStandard     String? @map("scoring_standard") @db.Text
  targetValue         Decimal? @map("target_value") @db.Decimal(10, 2)
  targetValueText     String? @map("target_value_text") @db.VarChar(100)
  unit                String? @db.VarChar(30)
  weight              Decimal @db.Decimal(5, 4)
  indicatorType       IndicatorType @default(kpi) @map("indicator_type")
  dimensionName       String? @map("dimension_name") @db.VarChar(100)
  dimensionWeight     Decimal @map("dimension_weight") @db.Decimal(5, 4)
  sortOrder           Int @default(0) @map("sort_order")

  indicatorVersion IndicatorVersion @relation(fields: [indicatorVersionId], references: [id], onDelete: Cascade)

  @@index([indicatorVersionId, sortOrder])
  @@map("indicator_version_items")
}
```

Add inverse `User` relations for `PeriodManager` and `IndicatorVersionCreator`.

Use these exact fields:

```prisma
managedAssessmentPeriods AssessmentPeriod[] @relation("PeriodManager")
createdIndicatorVersions IndicatorVersion[]  @relation("IndicatorVersionCreator")
```

- [ ] **Step 4: Create the additive SQL migration**

The migration must:

1. create the five enums;
2. add nullable/new-default cycle and task columns;
3. backfill every existing cycle to `workflow_version = 1` and `scoring_frequency = 'cycle'`;
4. backfill every existing task to `participant_disposition = 'active'`;
5. create the four new tables and indexes;
6. add foreign keys with `ON DELETE` behavior matching the Prisma schema;
7. insert `performance_company_final_approver` with JSON value `{ "userId": null }` only when the configuration key does not already exist;
8. not update existing `approver_id`, scores, statuses, or timestamps.

Include these safety assertions as comments directly above the backfill:

```sql
-- Historical rows stay on workflow v1. No historical task/result ownership is rewritten.
UPDATE assessment_cycles
SET workflow_version = 1, scoring_frequency = 'cycle'
WHERE workflow_version IS NULL;
```

Add the same configuration key to `api/prisma/seed.ts`:

```ts
{
  key: 'performance_company_final_approver',
  value: { userId: null },
  description: '公司绩效最终审定人。启用新流程前由 HR 管理员配置为李宏的用户 ID',
}
```

The migration and seed must not resolve the person by name, `canViewAll`, or system role.

- [ ] **Step 5: Validate and generate the Prisma client**

Run from `api`:

```powershell
npx prisma validate
npx prisma generate
npm test -- --runInBand src/tasks/indicator-schema.contract.spec.ts
```

Expected: Prisma schema valid; client generation succeeds; contract test PASS.

- [ ] **Step 6: Commit the persistence foundation**

```powershell
git add api/prisma/schema.prisma api/prisma/seed.ts api/prisma/migrations/20260828180000_add_performance_workflow_v2_foundation api/src/tasks/indicator-schema.contract.spec.ts
git commit -m "feat(performance): add workflow v2 foundation schema"
```

---

### Task 2: Implement scoring-frequency and period-definition rules

**Files:**

- Create: `api/src/cycles/cycle-scoring-plan.ts`
- Create: `api/src/cycles/cycle-scoring-plan.spec.ts`

**Interfaces:**

- Produces: `normalizeScoringFrequency(type: CycleType, requested?: ScoringFrequency): ScoringFrequency`.
- Produces: `buildPeriodDefinitions(input: BuildPeriodDefinitionsInput): PeriodDefinition[]`.
- Produces: `PeriodDefinition { periodKey, periodType, sequence, periodStart, periodEnd }`.
- Consumed by: `CycleScheduleService`, `CyclesService`, and `LaunchService`.

- [ ] **Step 1: Write failing rule tests**

Create tests covering these exact cases:

```ts
expect(normalizeScoringFrequency('monthly')).toBe('monthly');
expect(normalizeScoringFrequency('custom', 'monthly')).toBe('cycle');
expect(normalizeScoringFrequency('quarterly')).toBe('monthly');
expect(normalizeScoringFrequency('semiannual')).toBe('monthly');
expect(normalizeScoringFrequency('annual', 'cycle')).toBe('cycle');

expect(buildPeriodDefinitions({
  type: 'quarterly',
  scoringFrequency: 'monthly',
  startDate: new Date('2026-07-01T00:00:00+08:00'),
  endDate: new Date('2026-09-30T00:00:00+08:00'),
}).map((item) => item.periodKey)).toEqual(['2026-07', '2026-08', '2026-09']);

expect(buildPeriodDefinitions({
  type: 'quarterly',
  scoringFrequency: 'cycle',
  startDate: new Date('2026-07-01T00:00:00+08:00'),
  endDate: new Date('2026-09-30T00:00:00+08:00'),
})).toEqual([expect.objectContaining({ periodKey: 'cycle', periodType: 'cycle', sequence: 1 })]);
```

Also assert that a partial first/last month uses the actual cycle start/end dates while retaining the `YYYY-MM` key.

- [ ] **Step 2: Run the tests and verify they fail**

```powershell
cd api
npm test -- --runInBand src/cycles/cycle-scoring-plan.spec.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure functions**

Use these exported types exactly:

```ts
export interface BuildPeriodDefinitionsInput {
  type: CycleType;
  scoringFrequency: ScoringFrequency;
  startDate: Date;
  endDate: Date;
}

export interface PeriodDefinition {
  periodKey: string;
  periodType: AssessmentPeriodType;
  sequence: number;
  periodStart: Date;
  periodEnd: Date;
}
```

Implementation rules:

- compare calendar dates in `Asia/Shanghai`;
- reject `endDate < startDate` with `BadRequestException`;
- iterate months inclusively for monthly scoring;
- use the cycle boundary for partial first/last months;
- never accept monthly scoring for `custom`;
- never accept cycle scoring for `monthly`.

- [ ] **Step 4: Run the focused test**

```powershell
cd api
npm test -- --runInBand src/cycles/cycle-scoring-plan.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the domain rules**

```powershell
git add api/src/cycles/cycle-scoring-plan.ts api/src/cycles/cycle-scoring-plan.spec.ts
git commit -m "feat(cycles): define scoring period rules"
```

---

### Task 3: Generate and validate monthly schedules on the API

**Files:**

- Create: `api/src/cycles/cycle-workday-calendar.ts`
- Create: `api/src/cycles/cycle-schedule.service.ts`
- Create: `api/src/cycles/cycle-schedule.service.spec.ts`
- Create: `api/src/cycles/dto/cycle-period-schedule.dto.ts`
- Create: `api/src/cycles/dto/preview-cycle-schedule.dto.ts`
- Modify: `api/src/cycles/cycles.controller.ts`
- Modify: `api/src/cycles/cycles.module.ts`

**Interfaces:**

- Consumes: `buildPeriodDefinitions()` from Task 2.
- Produces: `CycleScheduleService.preview(dto): CycleSchedulePreview`.
- Produces: `CycleScheduleService.normalizeAndValidate(input): NormalizedCycleSchedulePlan`.
- Produces endpoint: `POST /cycles/schedule-preview`.

- [ ] **Step 1: Write failing schedule tests**

Use a fixed official-calendar fixture and assert:

```ts
const preview = service.preview({
  type: 'quarterly',
  scoringFrequency: 'monthly',
  startDate: new Date('2026-07-01T00:00:00+08:00'),
  endDate: new Date('2026-09-30T00:00:00+08:00'),
});

expect(preview.reviewFrequency).toBe('cycle');
expect(preview.schedules).toHaveLength(3);
expect(preview.schedules[0]).toMatchObject({
  periodKey: '2026-07',
  periodType: 'month',
  sequence: 1,
  isException: false,
});
expect(preview.schedules[0].selfEvalOpenAt).toContain('T09:00:00');
expect(preview.schedules[0].selfEvalDueAt).toContain('T18:00:00');
expect(preview.schedules[0].managerDueAt).toContain('T18:00:00');
```

Add tests that:

- `selfEvalOpenAt >= selfEvalDueAt` is a blocker;
- `selfEvalDueAt >= managerDueAt` is a blocker;
- non-workday, cross-month, interval longer than 10 statutory workdays, and overlap return warning codes without blocking;
- cycle scoring returns one `periodKey: 'cycle'` schedule;
- a supplied exceptional month survives normalization with `isException: true`.

- [ ] **Step 2: Run and verify failure**

```powershell
cd api
npm test -- --runInBand src/cycles/cycle-schedule.service.spec.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement calendar helpers**

Export these functions from `cycle-workday-calendar.ts`:

```ts
export type WorkdayStatus = { isWorkday: boolean; official: boolean };
export function workdayStatus(date: Date): WorkdayStatus;
export function shiftStatutoryWorkdays(date: Date, count: number): Date;
export function atShanghaiTime(date: Date, hour: number): Date;
```

Port the existing official calendar data from `web/src/views/admin/cycle-default-schedule.ts` verbatim, add test coverage for every included year, and use the weekday fallback only when official data is unavailable. A fallback result must create warning code `WORKDAY_CALENDAR_FALLBACK`.

- [ ] **Step 4: Implement DTOs and service output**

Use this response type:

```ts
export interface CycleSchedulePreview {
  scoringFrequency: ScoringFrequency;
  reviewFrequency: 'cycle';
  schedules: Array<PeriodDefinition & {
    selfEvalOpenAt: string;
    selfEvalDueAt: string;
    managerDueAt: string;
    isException: boolean;
  }>;
  blockers: Array<{ code: string; periodKey: string; message: string }>;
  warnings: Array<{ code: string; periodKey: string; message: string }>;
}
```

Use this internal normalized type so persistence receives `Date` objects rather than reparsing preview strings:

```ts
export interface NormalizedCycleSchedulePlan {
  scoringFrequency: ScoringFrequency;
  reviewFrequency: 'cycle';
  schedules: Array<PeriodDefinition & {
    selfEvalOpenAt: Date;
    selfEvalDueAt: Date;
    managerDueAt: Date;
    isException: boolean;
  }>;
  blockers: Array<{ code: string; periodKey: string; message: string }>;
  warnings: Array<{ code: string; periodKey: string; message: string }>;
}
```

`CyclePeriodScheduleDto` validates ISO timestamps and exact `periodKey` format (`cycle` or `YYYY-MM`). `PreviewCycleScheduleDto` validates `CycleType`, dates, and optional `ScoringFrequency`.

- [ ] **Step 5: Add the preview route before the `:id` route**

Add to `CyclesController`:

```ts
@Post('schedule-preview')
@HttpCode(200)
previewSchedule(@Body() dto: PreviewCycleScheduleDto) {
  return this.cycleScheduleService.preview(dto);
}
```

Inject `CycleScheduleService` and register/export it in `CyclesModule`.

- [ ] **Step 6: Run service and controller tests**

```powershell
cd api
npm test -- --runInBand src/cycles/cycle-schedule.service.spec.ts src/cycles/cycles.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit API-owned schedules**

```powershell
git add api/src/cycles
git commit -m "feat(cycles): generate monthly scoring schedules"
```

---

### Task 4: Persist v2 cycle configuration and force reapproval after core changes

**Files:**

- Modify: `api/src/cycles/dto/create-cycle.dto.ts`
- Modify: `api/src/cycles/dto/update-cycle.dto.ts`
- Modify: `api/src/cycles/cycles.service.ts`
- Modify: `api/src/cycles/cycles.service.spec.ts`

**Interfaces:**

- Consumes: `CycleScheduleService.normalizeAndValidate()` from Task 3.
- Accepts: `workflowVersion: 2`, `scoringFrequency`, and `periodSchedules` in create/update bodies.
- Returns: cycle relations with ordered `periodSchedules` and `reviewFrequency: 'cycle'`.

- [ ] **Step 1: Add failing DTO and service tests**

Extend `create-cycle.dto.spec.ts` and `cycles.service.spec.ts` with:

```ts
expect(await validate(plainToInstance(CreateCycleDto, {
  name: '2027 年第一季度绩效',
  type: 'quarterly',
  workflowVersion: 2,
  scoringFrequency: 'monthly',
  startDate: '2027-01-01T00:00:00+08:00',
  endDate: '2027-03-31T00:00:00+08:00',
  periodSchedules: validQuarterSchedules,
}))).toHaveLength(0);
```

Service assertions:

```ts
expect(prisma.assessmentCycle.create).toHaveBeenCalledWith({
  data: expect.objectContaining({
    workflowVersion: 2,
    scoringFrequency: 'monthly',
    periodSchedules: { create: expect.arrayContaining([
      expect.objectContaining({ periodKey: '2027-01', sequence: 1 }),
    ]) },
  }),
  include: expect.objectContaining({ periodSchedules: expect.any(Object) }),
});
```

Also test that changing `scoringFrequency` or any schedule timestamp on an approved draft clears `reviewedAt`, clears `reviewComment`, and sets `reviewStatus = 'pending'`.

- [ ] **Step 2: Run tests and verify failure**

```powershell
cd api
npm test -- --runInBand src/cycles/dto/create-cycle.dto.spec.ts src/cycles/cycles.service.spec.ts
```

Expected: FAIL on missing fields/persistence.

- [ ] **Step 3: Add DTO fields**

Add to `CreateCycleDto`:

```ts
@IsOptional()
@IsIn([1, 2])
workflowVersion?: 1 | 2;

@IsOptional()
@IsEnum(ScoringFrequency)
scoringFrequency?: ScoringFrequency;

@IsOptional()
@ValidateNested({ each: true })
@Type(() => CyclePeriodScheduleDto)
periodSchedules?: CyclePeriodScheduleDto[];
```

Keep `UpdateCycleDto extends PartialType(CreateCycleDto)`.

- [ ] **Step 4: Normalize, persist, and return plan data**

In `CyclesService.create()`:

1. treat missing `workflowVersion` as v1;
2. for v2, call `normalizeAndValidate()` and reject only if `blockers.length > 0`;
3. read `SystemConfig.performance_company_final_approver.value.userId`, verify that the user is active and not deleted, and snapshot that user ID into `companyFinalApproverId`;
4. if the configuration is absent or invalid, keep the draft value null and let preflight return the explicit `COMPANY_FINAL_APPROVER_MISSING` blocker instead of guessing by name, organization position, `canViewAll`, or system role;
5. persist normalized frequency and ordered schedule rows in the same transaction;
6. include warnings in the response as `scheduleWarnings` without storing transient UI text.

Use this resolver signature:

```ts
private async resolveCompanyFinalApproverId(
  tx: Prisma.TransactionClient,
): Promise<string | null>
```

Read the config with `tx.systemConfig.findUnique({ where: { key: 'performance_company_final_approver' } })`, parse only `value.userId`, then validate with `tx.user.findFirst({ where: { id: userId, deletedAt: null, status: 'active' } })`.

In `updateDraft()`:

1. compare normalized scoring frequency and schedule values with stored values;
2. replace schedule rows only when core timing changed;
3. reset the plan review fields on any core change;
4. record an `AuditLog` action `cycle_scoring_plan_updated` containing old/new frequency and changed period keys.

- [ ] **Step 5: Return ordered schedules from list/detail**

Add this include consistently to `findAll()` and `findOne()` for v2 cycles:

```ts
periodSchedules: { orderBy: { sequence: 'asc' } },
companyFinalApprover: { select: { id: true, name: true } },
```

Map `reviewFrequency: 'cycle'` in the service response; do not persist a one-value database enum.

- [ ] **Step 6: Run focused tests**

```powershell
cd api
npm test -- --runInBand src/cycles/dto/create-cycle.dto.spec.ts src/cycles/cycles.service.spec.ts src/cycles/cycle-schedule.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit cycle persistence**

```powershell
git add api/src/cycles
git commit -m "feat(cycles): persist scoring plans and monthly schedules"
```

---

### Task 5: Generate v2 launch snapshots, periods, and participant dispositions

**Files:**

- Modify: `api/src/cycles/launch.service.ts`
- Modify: `api/src/cycles/launch.service.spec.ts`

**Interfaces:**

- Consumes: v2 cycle `periodSchedules`, `scoringFrequency`, and structural organization relations.
- Produces: one `AssessmentTask` per included employee, one `AssessmentPeriod` per schedule, and one draft `IndicatorVersion(version = 1)` per active task.
- Produces: launch-plan hash fields `workflowVersion`, `scoringFrequency`, `companyFinalApproverId`, `periodSchedules`, and `participantDisposition`.

- [ ] **Step 1: Replace the current top-leader behavior with failing v2 tests**

Keep the existing v1 self-managed test and add a v2 counterpart:

```ts
it('marks the structural company top leader exempt in workflow v2', async () => {
  // company final approver config points to 李宏; 李宏 has no direct manager
  const checked = await service.preflight(cycleId);
  expect(checked.participants).toContainEqual(expect.objectContaining({
    employeeName: '李宏',
    participantDisposition: 'top_leader_exempt',
    isExempt: true,
  }));

  await service.launch(cycleId, operator, { expectedPlanHash: checked.planHash! });
  expect(tx.assessmentTask.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      employeeId: topLeader.id,
      managerId: null,
      status: 'exempted',
      participantDisposition: 'top_leader_exempt',
      exemptReason: '最高负责人豁免',
    }),
  });
});
```

Add another test asserting v1 keeps its current behavior so historical compatibility is explicit.

- [ ] **Step 2: Add failing probation-exclusion test**

```ts
expect(tx.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
  where: expect.objectContaining({ status: 'active' }),
}));
expect(preflight.exclusions).toContainEqual(expect.objectContaining({
  reasonCode: 'PROBATION_NOT_IN_PLAN',
}));
```

Candidate loading must separately count probation exclusions so HR can see why headcount changed; do not silently discard them from preflight output.

Use this selection contract in `launch.service.ts`:

```ts
interface CandidateSelection {
  included: Candidate[];
  exclusions: Array<{
    employeeId: string;
    employeeName: string;
    reasonCode: 'PROBATION_NOT_IN_PLAN';
    reason: '试用期员工不进入本绩效计划';
  }>;
}
```

- [ ] **Step 3: Add failing period/version generation test**

For a three-month v2 cycle assert:

```ts
expect(tx.assessmentPeriod.createMany).toHaveBeenCalledWith({
  data: [
    expect.objectContaining({ taskId: 'task-1', periodKey: '2027-01', sequence: 1, managerId: candidate.directManagerId }),
    expect.objectContaining({ taskId: 'task-1', periodKey: '2027-02', sequence: 2, managerId: candidate.directManagerId }),
    expect.objectContaining({ taskId: 'task-1', periodKey: '2027-03', sequence: 3, managerId: candidate.directManagerId }),
  ],
});
expect(tx.indicatorVersion.create).toHaveBeenCalledWith({
  data: expect.objectContaining({
    taskId: 'task-1',
    version: 1,
    status: 'draft',
    effectiveFromPeriodKey: '2027-01',
  }),
});
```

- [ ] **Step 4: Run launch tests and verify failure**

```powershell
cd api
npm test -- --runInBand src/cycles/launch.service.spec.ts
```

Expected: FAIL on v2 behavior.

- [ ] **Step 5: Extend preflight and its hash**

For v2 cycles:

- load `periodSchedules` ordered by sequence;
- require at least one normalized schedule;
- include schedule timestamps, frequency, workflow version, final approver ID, and participant disposition in `buildLaunchPlan()`;
- classify the user saved in `companyFinalApproverId` as `top_leader_exempt` and verify this user has no `directManagerId`;
- classify explicit/automatic cycle exemptions as `cycle_exempt`;
- exclude `User.status = probation` and return a summarized `exclusions` entry;
- continue using `User.directManagerId` for everyone else;
- produce blocker `COMPANY_FINAL_APPROVER_MISSING` when a v2 plan has no configured company final approver;
- replace v2 blocker copy “最终业务审批人” with “分管总审核人/公司最终审定人”; retain v1 copy unchanged.

- [ ] **Step 6: Generate records transactionally**

After creating an active v2 task:

```ts
const version = await tx.indicatorVersion.create({
  data: {
    taskId: task.id,
    version: 1,
    status: 'draft',
    effectiveFromPeriodKey: schedules[0].periodKey,
    createdById: operator.id,
  },
});

await tx.assessmentPeriod.createMany({
  data: schedules.map((schedule) => ({
    taskId: task.id,
    periodKey: schedule.periodKey,
    periodType: schedule.periodType,
    sequence: schedule.sequence,
    periodStart: schedule.periodStart,
    periodEnd: schedule.periodEnd,
    managerId: task.managerId,
    indicatorVersionId: null,
    status: 'unopened',
  })),
});
```

V1 is a draft shell at launch because employee goals are not yet confirmed. Phase 2 activates V1, copies immutable version items, and assigns it to periods after target confirmation.

For `top_leader_exempt` and `cycle_exempt`, create the task for audit/list visibility but do not create periods or indicator versions.

- [ ] **Step 7: Make launch idempotency count v2 children**

Extend `existingLaunchResult()` and its tests so a retry returns the existing task/period counts without creating duplicate `AssessmentPeriod` or `IndicatorVersion` rows. Rely on the unique keys as a final database guard.

- [ ] **Step 8: Run launch and cycle tests**

```powershell
cd api
npm test -- --runInBand src/cycles/launch.service.spec.ts src/cycles/cycles.service.spec.ts
```

Expected: PASS, including v1 compatibility tests.

- [ ] **Step 9: Commit v2 launch generation**

```powershell
git add api/src/cycles/launch.service.ts api/src/cycles/launch.service.spec.ts
git commit -m "feat(cycles): generate v2 launch periods and snapshots"
```

---

### Task 6: Add Web types, API client, and focused scoring components

**Files:**

- Modify: `web/src/types/enums.ts`
- Modify: `web/src/types/api.types.ts`
- Modify: `web/src/api/cycles.api.ts`
- Create: `web/src/views/admin/components/CycleScoringSettings.vue`
- Create: `web/src/views/admin/components/CycleMonthlyScheduleEditor.vue`

**Interfaces:**

- Produces: `ScoringFrequency = 'monthly' | 'cycle'` and `AssessmentPeriodType = 'month' | 'cycle'`.
- Produces: `cyclesApi.previewSchedule(body): Promise<CycleSchedulePreview>`.
- `CycleScoringSettings` uses `v-model:scoring-frequency` and emits `change`.
- `CycleMonthlyScheduleEditor` uses `v-model:schedules` and emits `restore-all`, `restore-one`, and `apply-unified`.

- [ ] **Step 1: Add failing Playwright component-contract expectations**

Create the first part of `web/e2e/specs/25-cycle-scoring-plan.spec.ts`. Mock `POST /api/v1/cycles/schedule-preview` and assert:

```ts
await page.getByTestId('cycle-create').click();
await page.getByTestId('cycle-type-quarterly').click();
await expect(page.getByTestId('cycle-scoring-monthly')).toBeChecked();
await expect(page.getByTestId('cycle-review-frequency')).toContainText('按周期审核');
await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);
```

Add cases:

- monthly cycle hides frequency choice and displays “固定按月评分”;
- custom cycle hides frequency choice and displays “按整个周期评分”;
- semiannual displays six rows;
- annual displays twelve rows;
- switching quarterly to cycle scoring displays one overall schedule row.

- [ ] **Step 2: Run the contract test and verify failure**

```powershell
cd web
npx playwright test --config playwright.contract.config.ts e2e/specs/25-cycle-scoring-plan.spec.ts
```

Expected: FAIL because the controls do not exist.

- [ ] **Step 3: Add exact Web types and API call**

Add to `web/src/types/enums.ts`:

```ts
export type ScoringFrequency = 'monthly' | 'cycle';
export type AssessmentPeriodType = 'month' | 'cycle';
```

Add to `web/src/types/api.types.ts`:

```ts
export interface CyclePeriodSchedule {
  id?: string;
  periodKey: string;
  periodType: AssessmentPeriodType;
  sequence: number;
  periodStart: string;
  periodEnd: string;
  selfEvalOpenAt: string;
  selfEvalDueAt: string;
  managerDueAt: string;
  isException: boolean;
}

export interface CycleScheduleIssue {
  code: string;
  periodKey: string;
  message: string;
}

export interface CycleSchedulePreview {
  scoringFrequency: ScoringFrequency;
  reviewFrequency: 'cycle';
  schedules: CyclePeriodSchedule[];
  blockers: CycleScheduleIssue[];
  warnings: CycleScheduleIssue[];
}
```

Extend `AssessmentCycle`, `CreateCycleBody`, and `UpdateCycleBody` with `workflowVersion`, `scoringFrequency`, `reviewFrequency`, `periodSchedules`, and `companyFinalApprover`.

Add:

```ts
previewSchedule(body: {
  type: CycleType;
  scoringFrequency?: ScoringFrequency;
  startDate: string;
  endDate: string;
}): Promise<CycleSchedulePreview> {
  return apiPost('/cycles/schedule-preview', body);
}
```

- [ ] **Step 4: Implement `CycleScoringSettings.vue`**

Required visible behavior:

```vue
<el-radio-group
  v-if="canChooseFrequency"
  :model-value="scoringFrequency"
  @update:model-value="emit('update:scoringFrequency', $event as ScoringFrequency)"
>
  <el-radio-button data-testid="cycle-scoring-monthly" value="monthly">按月度评分</el-radio-button>
  <el-radio-button data-testid="cycle-scoring-cycle" value="cycle">按整个周期评分</el-radio-button>
</el-radio-group>
<p v-else>{{ fixedFrequencyCopy }}</p>
<div data-testid="cycle-review-frequency">结果审核频率：按周期审核（固定）</div>
```

Component rules:

- `monthly` cycle emits `monthly`;
- `custom` emits `cycle`;
- quarterly/semiannual/annual preserve the selected value and default to monthly;
- the component never offers monthly review frequency.

- [ ] **Step 5: Implement `CycleMonthlyScheduleEditor.vue`**

Keep the interaction list-based; do not add drag editing. The component must render:

- period label;
- self-evaluation open time;
- employee planned completion time;
- manager planned completion time;
- “特殊月份” badge when `isException`;
- per-row “恢复默认”；
- “统一调整规则” action;
- “调整特殊月份” action;
- warning text under the affected row;
- blocker text next to the invalid input.

Use immutable emits: clone the schedule array before updating it. `apply-unified` must include `{ preserveExceptions: boolean }` so the parent can explicitly choose keep/overwrite.

- [ ] **Step 6: Run type check and focused contract test**

```powershell
cd web
npm run type-check
npx playwright test --config playwright.contract.config.ts e2e/specs/25-cycle-scoring-plan.spec.ts
```

Expected: types PASS; the component-level scenarios PASS after integration stubs are added to the test harness.

- [ ] **Step 7: Commit Web contracts and components**

```powershell
git add web/src/types web/src/api/cycles.api.ts web/src/views/admin/components web/e2e/specs/25-cycle-scoring-plan.spec.ts
git commit -m "feat(web): add cycle scoring plan controls"
```

---

### Task 7: Integrate scoring configuration into create, edit, review, and preflight

**Files:**

- Modify: `web/src/views/admin/CycleManageView.vue`
- Modify: `web/src/views/admin/components/CycleWorkspaceShell.vue`
- Modify: `web/src/views/admin/components/CycleCompactTable.vue`
- Modify: `web/e2e/specs/25-cycle-scoring-plan.spec.ts`

**Interfaces:**

- Consumes: components and API types from Task 6.
- Produces: v2 create/update payloads containing normalized schedules.
- Displays: frequency, fixed cycle review, number of periods, schedule exceptions, final approver, probation exclusions, and top-leader exemption in review/preflight.

- [ ] **Step 1: Complete failing interaction tests**

Add Playwright assertions for these flows:

```ts
await page.getByTestId('cycle-scoring-monthly').click();
await page.getByTestId('cycle-special-month-button').click();
await page.getByTestId('cycle-month-schedule-row').nth(1).getByTestId('manager-due-at').fill('2027-03-10 18:00');
await page.getByRole('button', { name: '下一步' }).click();

expect(createBodies.at(-1)).toMatchObject({
  workflowVersion: 2,
  scoringFrequency: 'monthly',
  periodSchedules: expect.arrayContaining([
    expect.objectContaining({ periodKey: '2027-02', isException: true }),
  ]),
});
```

Also assert:

- blocker prevents submission and focuses the invalid schedule row;
- warning allows submission after explicit confirmation;
- changing scoring frequency on an approved draft displays “修改后需重新审核”;
- compact table shows “按月评分 · 3个月”;
- workspace shows “结果审核：按周期审核”;
- preflight displays probation exclusion count and “最高负责人豁免：李宏”.

- [ ] **Step 2: Run and verify interaction failures**

```powershell
cd web
npx playwright test --config playwright.contract.config.ts e2e/specs/25-cycle-scoring-plan.spec.ts
```

Expected: FAIL on missing parent integration.

- [ ] **Step 3: Add v2 fields to the create/edit form state**

Use this state shape in `CycleManageView.vue`:

```ts
interface CycleScoringPlanForm {
  workflowVersion: 2;
  scoringFrequency: ScoringFrequency;
  reviewFrequency: 'cycle';
  periodSchedules: CyclePeriodSchedule[];
  scheduleBlockers: CycleScheduleIssue[];
  scheduleWarnings: CycleScheduleIssue[];
}
```

When cycle type or period changes:

1. call `cyclesApi.previewSchedule()`;
2. replace defaults only after the existing “regenerate or keep current schedule” confirmation;
3. never silently overwrite a special month;
4. debounce date-range changes, but call immediately on explicit frequency selection.

For v2 cycles, stop using the local default generator in `cycle-default-schedule.ts`; the API preview is authoritative. Keep the local generator only for untouched v1 edit behavior until the historical workflow is retired.

- [ ] **Step 4: Assemble create/update payloads**

Add exactly these fields for new cycles:

```ts
{
  workflowVersion: 2,
  scoringFrequency: scoringPlan.scoringFrequency,
  periodSchedules: scoringPlan.periodSchedules.map(({ id, ...schedule }) => schedule),
}
```

Do not send `reviewFrequency` because it is fixed and server-derived. When editing a v1 cycle, do not add v2 fields or convert it.

- [ ] **Step 5: Display the confirmed summary in list/workspace**

`CycleCompactTable.vue` summary:

```ts
const scoringSummary = cycle.workflowVersion === 2
  ? cycle.scoringFrequency === 'monthly'
    ? `按月评分 · ${cycle.periodSchedules.length}个月`
    : '按整个周期评分'
  : '历史流程';
```

`CycleWorkspaceShell.vue` must show:

- scoring summary;
- fixed cycle review;
- schedule exception count;
- company final approver;
- preflight exclusions and dispositions;
- the existing check/review/launch actions without renaming or moving them.

- [ ] **Step 6: Run Web verification**

```powershell
cd web
npm run type-check
npx playwright test --config playwright.contract.config.ts e2e/specs/17-cycle-launch-entry-ux.spec.ts e2e/specs/25-cycle-scoring-plan.spec.ts
```

Expected: type check PASS; existing launch UX and new scoring-plan tests PASS.

- [ ] **Step 7: Commit the cycle-management integration**

```powershell
git add web/src/views/admin web/e2e/specs/25-cycle-scoring-plan.spec.ts
git commit -m "feat(cycles): integrate scoring plan into cycle management"
```

---

### Task 8: Add persisted API end-to-end acceptance for phase 1

**Files:**

- Create: `api/test/suites/12-performance-workflow-v2-foundation.e2e-spec.ts`
- Modify: `api/test/jest-e2e.json` only if the existing suite pattern does not already include `12-*` files.

**Interfaces:**

- Verifies: HTTP create → review → preflight → launch → database records.
- Verifies: v1 cycles remain readable and launchable without v2 child records.

- [ ] **Step 1: Write the failing e2e scenario**

Use controlled fixtures for one employee, one direct manager, one department head, HR, HR administrator, and structural top leader. The test must:

1. set `performance_company_final_approver.value.userId` to the controlled 李宏 fixture ID;
2. create a v2 quarterly monthly-scored cycle with three schedules;
3. approve the plan;
4. call preflight and assert active/probation/top-leader counts;
5. launch using the returned `planHash`;
6. query Prisma and assert one task per included/audited participant;
7. assert three periods and one draft V1 shell for the active employee;
8. assert no periods/version for top-leader exemption;
9. assert the probation employee has no task;
10. create a v1 cycle and assert it has no v2 schedule/period/version requirements.

Core database assertions:

```ts
expect(await prisma.assessmentPeriod.count({ where: { taskId: employeeTask.id } })).toBe(3);
expect(await prisma.indicatorVersion.findUnique({
  where: { taskId_version: { taskId: employeeTask.id, version: 1 } },
})).toMatchObject({ status: 'draft', effectiveFromPeriodKey: '2027-01' });
expect(await prisma.assessmentPeriod.count({ where: { taskId: topLeaderTask.id } })).toBe(0);
expect(await prisma.assessmentTask.count({ where: { cycleId, employeeId: probationUser.id } })).toBe(0);
```

- [ ] **Step 2: Run the e2e scenario and verify it fails**

With the existing test Compose environment running, run from `api`:

```powershell
npm run test:e2e -- --runInBand test/suites/12-performance-workflow-v2-foundation.e2e-spec.ts
```

Expected: FAIL until all phase-1 API work is wired.

- [ ] **Step 3: Fix only integration gaps found by the e2e test**

Allowed fixes in this step:

- missing Nest module provider/import;
- missing Prisma include/select;
- transaction mock/real-client mismatch;
- response serialization of Decimal/Date;
- route ordering;
- launch idempotency.

Do not add phase-2 self-evaluation or manager-scoring behavior.

- [ ] **Step 4: Run the e2e scenario again**

```powershell
cd api
npm run test:e2e -- --runInBand test/suites/12-performance-workflow-v2-foundation.e2e-spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the phase-1 e2e evidence**

```powershell
git add api/test/suites/12-performance-workflow-v2-foundation.e2e-spec.ts api/src api/prisma
git commit -m "test(performance): cover workflow v2 launch foundation"
```

---

### Task 9: Run the phase-1 regression gate and prepare review evidence

**Files:**

- Modify only files required to fix a demonstrated phase-1 regression.

**Interfaces:**

- Produces: a clean branch/worktree containing only phase-1 changes.
- Produces: command evidence for API, Web, v1 compatibility, and v2 acceptance.

- [ ] **Step 1: Run Prisma and focused API verification**

```powershell
cd api
npx prisma validate
npx prisma generate
npm test -- --runInBand src/cycles/cycle-scoring-plan.spec.ts src/cycles/cycle-schedule.service.spec.ts src/cycles/dto/create-cycle.dto.spec.ts src/cycles/cycles.service.spec.ts src/cycles/launch.service.spec.ts src/tasks/indicator-schema.contract.spec.ts
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 2: Run Web verification**

```powershell
cd web
npm run type-check
npx playwright test --config playwright.contract.config.ts e2e/specs/17-cycle-launch-entry-ux.spec.ts e2e/specs/14-cycle-management-compact.spec.ts e2e/specs/25-cycle-scoring-plan.spec.ts
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Run the persisted e2e scenario**

```powershell
cd api
npm run test:e2e -- --runInBand test/suites/03-cycle-lifecycle.e2e-spec.ts test/suites/12-performance-workflow-v2-foundation.e2e-spec.ts
```

Expected: v1 lifecycle and v2 foundation scenarios PASS.

- [ ] **Step 4: Inspect the migration against an existing-data copy**

Run the migration in the project test database copied from a recent non-production snapshot, then execute:

```sql
SELECT workflow_version, scoring_frequency, COUNT(*)
FROM assessment_cycles
GROUP BY workflow_version, scoring_frequency;

SELECT COUNT(*) AS historical_period_rows
FROM assessment_periods ap
JOIN assessment_tasks t ON t.id = ap.task_id
JOIN assessment_cycles c ON c.id = t.cycle_id
WHERE c.workflow_version = 1;
```

Expected:

- all historical cycles are `(1, cycle)`;
- `historical_period_rows = 0`;
- historical task/result/approver counts are unchanged from the pre-migration snapshot.

- [ ] **Step 5: Review changed files and working tree**

```powershell
git diff --check
git status --short
git log --oneline --decorate -12
```

Expected: no whitespace errors; no unrelated files; phase-1 commits are narrow and ordered.

- [ ] **Step 6: Stop at the phase-1 review gate**

Present the user with:

- the scoring-frequency create/edit screen;
- three/six/twelve generated monthly schedules;
- a special-month adjustment;
- review reset after changing the frequency;
- preflight probation exclusion and top-leader exemption;
- persisted task/period/version counts after launch;
- v1 compatibility test evidence.

Do not start phase 2 and do not publish production until the user accepts phase 1.
