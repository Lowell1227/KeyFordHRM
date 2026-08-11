# Realistic Demo Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and safely load a deterministic, source-calibrated synthetic dataset for 128 current employees, complete performance history, active workflows, and eight cross-role acceptance accounts.

**Architecture:** Keep the feature outside the application runtime under `api/prisma/realistic-demo`. A pure generator creates rows with deterministic UUIDs, a validator rejects inconsistent datasets before any write, and a Prisma persistence layer replaces only owned synthetic rows inside one transaction. The CLI adds explicit production-mode gates, preview, verification, and exact-scope cleanup without changing the existing base seed or Prisma schema.

**Tech Stack:** TypeScript 5.6, Node.js 20, Prisma 5/PostgreSQL 15, Jest/ts-jest, Testcontainers, bcrypt, NestJS/Vue/Playwright for final acceptance.

## Global Constraints

- Preserve the current modular-monolith architecture, Prisma schema, API contracts, and frontend behavior.
- Use `2026-08-11T00:00:00.000+08:00` as the fixed observation instant; never derive demo dates from `new Date()` without an explicit timestamp.
- Generate 128 current people, 4 resigned historical people, and 1 system administrator service account.
- Generate exactly 115 `full_time`, 9 `rehire`, 3 `external`, and 1 `part_time` current people; exactly 7 current people have `status=probation`.
- Never copy names, phones, emails, identity numbers, addresses, bank details, or other personal values from `C:\Users\lwei\Documents\HRzl`.
- Only eight acceptance accounts receive `passwordHash`; their plaintext password comes from `REALISTIC_DEMO_ACCOUNT_PASSWORD` and is never logged.
- All synthetic objects use deterministic UUIDs and the source marker `realistic-demo-v1` where the schema has a JSON or text marker field.
- Do not add runtime dependencies or schema migrations.
- Do not modify the responsibilities of `prisma db seed`; realistic data is always invoked by a separate command.
- A write requires `ENABLE_REALISTIC_DEMO_SEED=true`; cleanup requires `ENABLE_REALISTIC_DEMO_CLEAN=true`.
- A rerun may replace only deterministic synthetic IDs after collision checks; never call an unscoped `deleteMany({})` or reset the database.
- Tests and browser acceptance must prove business consistency after refresh; build success alone is insufficient.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `api/prisma/realistic-demo/types.ts` | Shared dataset, manifest, context, bundle, and row-set types. |
| `api/prisma/realistic-demo/config.ts` | Observation date, namespace, quotas, base department references, cycles, personas, and acceptance account numbers. |
| `api/prisma/realistic-demo/ids.ts` | RFC 4122 version-5 deterministic UUID generation. |
| `api/prisma/realistic-demo/random.ts` | Seeded pseudo-random selection and shuffling with no ambient randomness. |
| `api/prisma/realistic-demo/context.ts` | `createDemoContext()` composing config, IDs, and random source. |
| `api/prisma/realistic-demo/people.ts` | Departments, 128 current people, 4 resigned people, the service account, roles, and manager graph. |
| `api/prisma/realistic-demo/catalog.ts` | Seven job-family indicator catalogs and assessment templates. |
| `api/prisma/realistic-demo/performance.ts` | Cycles, snapshots, tasks, indicators, scoring, calibration, archives, objectives, and flow timestamps. |
| `api/prisma/realistic-demo/narratives.ts` | Indicator-aware self-review, manager feedback, appeal, interview, and improvement text. |
| `api/prisma/realistic-demo/workflows.ts` | Interviews, appeals, improvement plans, probation, confirmation, signatures, notifications, and audit rows. |
| `api/prisma/realistic-demo/generate.ts` | Public `generateRealisticDemoDataset()` orchestration. |
| `api/prisma/realistic-demo/validate.ts` | Pre-write invariants and path-specific validation errors. |
| `api/prisma/realistic-demo/ownership.ts` | Collision checks and exact owned-ID manifest. |
| `api/prisma/realistic-demo/persist.ts` | Transactional delete-and-recreate and cleanup preview/execution. |
| `api/prisma/realistic-demo/report.ts` | In-memory and database summaries with exact expected counts. |
| `api/prisma/realistic-demo/guards.ts` | Environment gates and secret-presence checks. |
| `api/prisma/realistic-demo/*.spec.ts` | Pure generator, validator, and guard tests. |
| `api/prisma/realistic-demo/jest.config.js` | Jest entry restricted to realistic-demo unit tests. |
| `api/prisma/seed-realistic-demo.ts` | Preview/write CLI entrypoint. |
| `api/prisma/verify-realistic-demo.ts` | Read-only database verification CLI. |
| `api/prisma/clean-realistic-demo.ts` | Exact-scope cleanup preview/execution CLI. |
| `api/test/suites/13-realistic-demo-seed.e2e-spec.ts` | PostgreSQL idempotency, collision, rollback, and non-owned-row integration tests. |
| `api/package.json` | Seed, preview, verify, clean, and unit-test commands. |
| `docs/operations/realistic-demo-data.md` | Operator runbook and safe production-mode procedure. |
| `docs/acceptance/2026-08-11-realistic-demo-data.md` | Final role/page/API acceptance evidence created during execution. |

---

### Task 1: Deterministic Core, Types, and Test Harness

**Files:**
- Create: `api/prisma/realistic-demo/types.ts`
- Create: `api/prisma/realistic-demo/config.ts`
- Create: `api/prisma/realistic-demo/ids.ts`
- Create: `api/prisma/realistic-demo/random.ts`
- Create: `api/prisma/realistic-demo/context.ts`
- Create: `api/prisma/realistic-demo/ids.spec.ts`
- Create: `api/prisma/realistic-demo/random.spec.ts`
- Create: `api/prisma/realistic-demo/config.spec.ts`
- Create: `api/prisma/realistic-demo/jest.config.js`
- Modify: `api/package.json`

**Interfaces:**
- Consumes: Prisma create-many input types from `@prisma/client`; Node `crypto` only.
- Produces: `demoId(kind, key)`, `SeededRandom`, `createDemoContext()`, `DEMO_CONFIG`, `RealisticDemoDataset`, and `DemoManifest` for every later task.

- [ ] **Step 1: Add failing deterministic-ID and random tests**

```ts
import { demoId } from './ids';
import { SeededRandom } from './random';

describe('realistic demo deterministic core', () => {
  it('returns stable UUIDv5 values and separates entity kinds', () => {
    expect(demoId('user', 'FD210101')).toBe(demoId('user', 'FD210101'));
    expect(demoId('user', 'FD210101')).not.toBe(demoId('task', 'FD210101'));
    expect(demoId('user', 'FD210101')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('replays the same seeded sequence', () => {
    const first = new SeededRandom(20260811);
    const second = new SeededRandom(20260811);
    expect(Array.from({ length: 20 }, () => first.int(1, 100))).toEqual(
      Array.from({ length: 20 }, () => second.int(1, 100)),
    );
  });
});
```

- [ ] **Step 2: Add failing config-invariant tests**

```ts
import { DEMO_CONFIG } from './config';

it('locks approved people and performance totals', () => {
  expect(Object.values(DEMO_CONFIG.departmentHeadcount).reduce((a, b) => a + b, 0)).toBe(128);
  expect(Object.values(DEMO_CONFIG.employmentTypeCount).reduce((a, b) => a + b, 0)).toBe(128);
  expect(DEMO_CONFIG.currentProbationCount).toBe(7);
  expect(DEMO_CONFIG.resignedHistoryCount).toBe(4);
  expect(DEMO_CONFIG.q1.gradeCount).toEqual({ A: 23, B: 47, C: 37, D: 11 });
  expect(DEMO_CONFIG.q2.gradeCount).toEqual({ A: 24, B: 49, C: 38, D: 12 });
  expect(DEMO_CONFIG.q3.taskStatusCount).toEqual({ self_eval: 113, indicator_confirming: 9, indicator_setting: 6 });
});
```

- [ ] **Step 3: Run the new Jest command and verify the missing modules fail**

Run: `cd api && npx jest --config prisma/realistic-demo/jest.config.js --runInBand`

Expected: FAIL because `ids.ts`, `random.ts`, and `config.ts` do not exist.

- [ ] **Step 4: Implement the shared types and deterministic primitives**

```ts
// types.ts
import type { Prisma } from '@prisma/client';

export type DemoEntityKind =
  | 'department' | 'user' | 'indicator' | 'template' | 'dimension'
  | 'template-indicator' | 'cycle' | 'snapshot' | 'task' | 'indicator-instance'
  | 'self-eval' | 'manager-eval' | 'grade' | 'flow' | 'archive' | 'objective'
  | 'action-item' | 'interview' | 'appeal' | 'improvement-plan'
  | 'probation-review' | 'probation-indicator' | 'confirmation'
  | 'signature' | 'notification' | 'audit-log';

export interface DemoManifest {
  source: 'realistic-demo-v1';
  asOf: Date;
  ownedIds: Record<DemoEntityKind, string[]>;
  acceptanceEmployeeNos: Record<string, string>;
  storyUserIds: Record<string, string>;
  expectedCounts: Record<string, number>;
}

export interface DemoRowSets {
  departments: Prisma.DepartmentCreateManyInput[];
  users: Prisma.UserCreateManyInput[];
  indicators: Prisma.IndicatorCreateManyInput[];
  templates: Prisma.AssessmentTemplateCreateManyInput[];
  dimensions: Prisma.TemplateDimensionCreateManyInput[];
  templateIndicators: Prisma.TemplateIndicatorCreateManyInput[];
  cycles: Prisma.AssessmentCycleCreateManyInput[];
  snapshots: Prisma.AssessmentTemplateSnapshotCreateManyInput[];
  tasks: Prisma.AssessmentTaskCreateManyInput[];
  indicatorInstances: Prisma.IndicatorInstanceCreateManyInput[];
  selfEvaluations: Prisma.SelfEvalSummaryCreateManyInput[];
  managerEvaluations: Prisma.ManagerEvalSummaryCreateManyInput[];
  gradeResults: Prisma.GradeResultCreateManyInput[];
  flowRecords: Prisma.FlowRecordCreateManyInput[];
  archives: Prisma.PerformanceArchiveCreateManyInput[];
  objectives: Prisma.ObjectiveCreateManyInput[];
  actionItems: Prisma.ActionItemCreateManyInput[];
  interviews: Prisma.PerformanceInterviewCreateManyInput[];
  appeals: Prisma.AppealCreateManyInput[];
  improvementPlans: Prisma.ImprovementPlanCreateManyInput[];
  probationReviews: Prisma.ProbationReviewCreateManyInput[];
  probationIndicators: Prisma.ProbationReviewIndicatorCreateManyInput[];
  confirmations: Prisma.ConfirmationApplicationCreateManyInput[];
  signatures: Prisma.SignatureCreateManyInput[];
  notifications: Prisma.NotificationLogCreateManyInput[];
  auditLogs: Prisma.AuditLogCreateManyInput[];
}

export interface RealisticDemoDataset {
  rows: DemoRowSets;
  departmentLeadership: Array<{ id: string; leaderId: string | null; approverId: string | null }>;
  manifest: DemoManifest;
}
```

Implement UUIDv5 with `createHash('sha1')`, set version bits to `0x50`, variant bits to `0x80`, and format the first 16 bytes. Implement `SeededRandom` with xorshift32 and methods `next()`, `int(min,max)`, `pick(items)`, `shuffle(items)`, and `weighted(items)`; reject empty inputs and non-positive total weight.

- [ ] **Step 5: Define approved constants and account contracts**

```ts
export const DEMO_CONFIG = {
  source: 'realistic-demo-v1' as const,
  namespace: '7d00d390-fdc5-5c87-9b36-202608110001',
  seed: 20260811,
  asOf: new Date('2026-08-11T00:00:00.000+08:00'),
  departmentHeadcount: { project: 59, supplyChain: 26, creative: 17, hrAdmin: 8, sales: 7, finance: 5, executive: 3, beijing: 2, digital: 1 },
  employmentTypeCount: { full_time: 115, rehire: 9, external: 3, part_time: 1 },
  currentProbationCount: 7,
  resignedHistoryCount: 4,
  acceptanceEmployeeNos: {
    admin: 'FD900001', hr: 'FD100001', vp: 'FD100002', deptHead: 'FD210001',
    manager: 'FD210002', employee: 'FD210101', lowPerformer: 'FD210102', probation: 'FD210103',
  },
  q1: { taskCount: 120, exemptCount: 2, gradeCount: { A: 23, B: 47, C: 37, D: 11 } },
  q2: { taskCount: 124, exemptCount: 1, gradeCount: { A: 24, B: 49, C: 38, D: 12 } },
  q3: { taskCount: 128, taskStatusCount: { self_eval: 113, indicator_confirming: 9, indicator_setting: 6 } },
  annualLeaderTaskCount: 12,
} as const;
```

Add `test:seed:realistic` to `api/package.json` as `jest --config prisma/realistic-demo/jest.config.js --runInBand`.

- [ ] **Step 6: Run unit tests and TypeScript compilation**

Run: `cd api && npm run test:seed:realistic && npx tsc --noEmit -p tsconfig.json`

Expected: all realistic-demo tests PASS; TypeScript exits 0.

- [ ] **Step 7: Commit deterministic core**

```bash
git add api/package.json api/prisma/realistic-demo
git commit -m "test(api): define realistic demo generator core"
```

---

### Task 2: Organization, People, Roles, and Manager Graph

**Files:**
- Create: `api/prisma/realistic-demo/people.ts`
- Create: `api/prisma/realistic-demo/people.spec.ts`
- Modify: `api/prisma/realistic-demo/types.ts`
- Modify: `api/prisma/realistic-demo/config.ts`

**Interfaces:**
- Consumes: `DemoContext`, `DEMO_CONFIG`, `demoId()`.
- Produces: `generatePeople(context): PeopleBundle`, including user/dept rows, base-department assertions, manager maps, persona IDs, and leadership updates.

- [ ] **Step 1: Write the failing approved-distribution test**

```ts
const people = generatePeople(createDemoContext());
const current = people.users.filter((u) => u.status !== 'resigned' && u.sysRole !== 'system_admin');
expect(current).toHaveLength(128);
expect(people.users.filter((u) => u.status === 'resigned')).toHaveLength(4);
expect(people.users.filter((u) => u.sysRole === 'system_admin')).toHaveLength(1);
expect(countBy(current, 'employmentType')).toEqual({ full_time: 115, rehire: 9, external: 3, part_time: 1 });
expect(current.filter((u) => u.status === 'probation')).toHaveLength(7);
expect(current.filter((u) => u.passwordHash !== null)).toHaveLength(7);
expect(people.users.filter((u) => u.passwordHash !== null)).toHaveLength(8);
```

- [ ] **Step 2: Write the failing hierarchy and privacy test**

```ts
expect(people.managerIds).toHaveLength(18);
expect(assertAcyclicManagerGraph(people.users)).toBeUndefined();
const teamSizes = managerTeamSizes(people.users).sort((a, b) => a - b);
expect(teamSizes.at(-1)).toBeLessThanOrEqual(24);
expect(teamSizes[Math.floor(teamSizes.length / 2)]).toBe(6);
for (const user of people.users) {
  expect(user.phone).toBeNull();
  if (user.email) expect(user.email).toMatch(/@example\.invalid$/);
}
```

- [ ] **Step 3: Run the people test and verify it fails**

Run: `cd api && npm run test:seed:realistic -- people.spec.ts`

Expected: FAIL because `generatePeople` is undefined.

- [ ] **Step 4: Implement base department references and exact allocations**

Use the fixed IDs already present in `api/prisma/seed.ts` for the company root and existing active departments. Store `{ id, expectedName }` pairs in `DEMO_CONFIG.baseDepartments`; persistence will abort if an ID resolves to a different name. Create only the missing `总经办` as an owned synthetic department.

Allocate current people in this exact order: department quota, second/third-level weighted team, employment type quota, entry-date cohort, position, manager, role, then the seven probation statuses. Use 116 pre-2026 entries and four entries in each of Q1, Q2, and Q3 so cycle eligibility is deterministic.

```ts
export interface PeopleBundle {
  departments: Prisma.DepartmentCreateManyInput[];
  users: Prisma.UserCreateManyInput[];
  baseDepartmentAssertions: Array<{ id: string; expectedName: string }>;
  departmentLeadership: RealisticDemoDataset['departmentLeadership'];
  managerIds: string[];
  managerByUserId: Map<string, string>;
  deptHeadByDepartmentId: Map<string, string>;
  approverByDepartmentId: Map<string, string>;
  storyUserIds: Record<string, string>;
  acceptanceEmployeeNos: Record<string, string>;
}
```

Use fictional Chinese names assembled from local surname/given-name arrays and deterministic employee numbers. Do not read HRzl files from the generator. Only the seven human acceptance users and the service administrator receive the password-hash sentinel `__ACCEPTANCE_PASSWORD_HASH__`; persistence replaces the sentinel with the bcrypt hash.

- [ ] **Step 5: Implement the manager graph and persona assignment**

Create 18 manager IDs with target team sizes covering `[1, 2, 3, 4, 5, 5, 5, 6, 6, 6, 6, 6, 7, 7, 8, 9, 13, 24]`; the 123 total reporting edges leave five roots/non-reporting accounts while preserving a median of 6 and maximum of 24. Distribute managers under department heads and redistribute any departmental remainder without exceeding 24. Bind named story keys `excellentManager`, `stableContributor`, `lowPerformer`, `consecutiveLowPerformerA`, `consecutiveLowPerformerB`, `appealModified`, `appealMaintained`, `lateEntryExempt`, and `transferredEmployee` to fixed employee numbers.

- [ ] **Step 6: Run unit tests twice to prove reproducibility**

Run: `cd api && npm run test:seed:realistic -- people.spec.ts && npm run test:seed:realistic -- people.spec.ts`

Expected: both runs PASS with identical snapshots and counts.

- [ ] **Step 7: Commit people generation**

```bash
git add api/prisma/realistic-demo
git commit -m "feat(api): generate realistic demo organization"
```

---

### Task 3: Job-Family Indicator Catalog and Templates

**Files:**
- Create: `api/prisma/realistic-demo/catalog.ts`
- Create: `api/prisma/realistic-demo/catalog.spec.ts`
- Modify: `api/prisma/realistic-demo/types.ts`

**Interfaces:**
- Consumes: `PeopleBundle`, `DemoContext`.
- Produces: `generateCatalog(context, people): CatalogBundle` with indicators, templates, dimensions, template indicators, and `templateIdByJobFamily`.

- [ ] **Step 1: Write failing catalog completeness tests**

```ts
const catalog = generateCatalog(createDemoContext(), generatePeople(createDemoContext()));
expect([...catalog.templateIdByJobFamily.keys()].sort()).toEqual([
  'creative', 'customerSupport', 'ecommerce', 'functions', 'projectProduct', 'salesRetail', 'supplyChain',
]);
for (const family of catalog.templateIdByJobFamily.keys()) {
  const template = catalog.templateForFamily(family);
  expect(template.indicators.length).toBeGreaterThanOrEqual(3);
  expect(template.indicators.length).toBeLessThanOrEqual(6);
  expect(sum(template.dimensions.map((d) => d.weight))).toBeCloseTo(1, 6);
  for (const indicator of template.indicators) {
    expect(indicator.dataSource).not.toHaveLength(0);
    expect(indicator.dataCaliber).not.toHaveLength(0);
    expect(indicator.scoringStandard).not.toHaveLength(0);
  }
}
```

- [ ] **Step 2: Run the catalog test and verify failure**

Run: `cd api && npm run test:seed:realistic -- catalog.spec.ts`

Expected: FAIL because `catalog.ts` does not exist.

- [ ] **Step 3: Define all seven catalogs with explicit business content**

Implement these exact KPI groups; each indicator also carries unit, data source, data caliber, target rule, and scoring ladder:

| Family | KPI names |
| --- | --- |
| `projectProduct` | 项目里程碑按期率、项目毛利达成率、客户验收通过率、库存清理目标、跨团队协作 |
| `supplyChain` | 采购降本率、供应商准交率、质量问题关闭率、库存准确率、重大项目保障 |
| `salesRetail` | 净销售额、回款率、新渠道销售占比、坏账控制、库存清理 |
| `ecommerce` | GMV 达成率、投产比、转化率、直播或内容交付、粉丝有效增长 |
| `creative` | 设计交付及时率、作品准确率、审核留痕、视觉升级成果、AI 工具应用 |
| `customerSupport` | 首次响应时效、一次解决率、客户满意度、投诉升级控制、数据准确率 |
| `functions` | 结算或招聘交付及时率、数据准确率、预算或编制控制、制度交付、内部服务满意度 |

Normal templates use KPI dimension weight `0.8` and attitude dimension weight `0.2`. Manager templates keep total weight `1.0` and replace one KPI with talent development/process optimization without adding another dimension. Bonus, penalty, and veto definitions remain separate indicator-library rows and are attached to instances only when a story event needs them.

- [ ] **Step 4: Build deterministic Prisma rows**

```ts
export interface CatalogBundle {
  indicators: Prisma.IndicatorCreateManyInput[];
  templates: Prisma.AssessmentTemplateCreateManyInput[];
  dimensions: Prisma.TemplateDimensionCreateManyInput[];
  templateIndicators: Prisma.TemplateIndicatorCreateManyInput[];
  templateIdByJobFamily: Map<JobFamily, string>;
  templateForFamily(family: JobFamily): GeneratedTemplate;
}
```

Give indicator codes the form `RDMO_<FAMILY>_<NN>` and descriptions the marker `realistic-demo-v1`. Set `applicableDepts` and `applicableUsers` to deterministic UUID arrays, never employee numbers.

- [ ] **Step 5: Run catalog and full unit suites**

Run: `cd api && npm run test:seed:realistic`

Expected: all Task 1–3 tests PASS.

- [ ] **Step 6: Commit catalog generation**

```bash
git add api/prisma/realistic-demo
git commit -m "feat(api): add realistic performance catalogs"
```

---

### Task 4: Cycles, Tasks, Scoring, Objectives, and Core Storylines

**Files:**
- Create: `api/prisma/realistic-demo/performance.ts`
- Create: `api/prisma/realistic-demo/narratives.ts`
- Create: `api/prisma/realistic-demo/performance.spec.ts`
- Modify: `api/prisma/realistic-demo/types.ts`
- Modify: `api/prisma/realistic-demo/config.ts`

**Interfaces:**
- Consumes: `PeopleBundle`, `CatalogBundle`, `DemoContext`.
- Produces: `generatePerformance(context, people, catalog): PerformanceBundle` with cycles through flow records plus objectives/action items; Task 5 augments it with post-publish workflows.

- [ ] **Step 1: Write failing timeline and quota tests**

```ts
const bundle = buildPerformanceFixture();
expect(tasksFor(bundle, '2026-Q1')).toHaveLength(120);
expect(exemptTasksFor(bundle, '2026-Q1')).toHaveLength(2);
expect(countGrades(bundle, '2026-Q1')).toEqual({ A: 23, B: 47, C: 37, D: 11 });
expect(tasksFor(bundle, '2026-Q2')).toHaveLength(124);
expect(exemptTasksFor(bundle, '2026-Q2')).toHaveLength(1);
expect(countGrades(bundle, '2026-Q2')).toEqual({ A: 24, B: 49, C: 38, D: 12 });
expect(countStatuses(bundle, '2026-Q3')).toEqual({ self_eval: 113, indicator_confirming: 9, indicator_setting: 6 });
expect(tasksFor(bundle, '2026-ANNUAL-LEADERS')).toHaveLength(12);
expect(bundle.gradeResults.filter((g) => isQ3OrAnnualTask(bundle, g.taskId))).toHaveLength(0);
```

- [ ] **Step 2: Write failing score and timestamp-consistency tests**

```ts
for (const task of completedTasks(bundle)) {
  expect(recalculateTaskScore(task, bundle.indicatorInstances)).toBeCloseTo(
    Number(gradeFor(bundle, task.id).calculatedScore),
    2,
  );
  expect(task.indicatorSetAt!.getTime()).toBeLessThanOrEqual(task.indicatorConfirmedAt!.getTime());
  expect(task.indicatorConfirmedAt!.getTime()).toBeLessThanOrEqual(task.selfEvalSubmittedAt!.getTime());
  expect(task.selfEvalSubmittedAt!.getTime()).toBeLessThanOrEqual(task.managerScoredAt!.getTime());
  expect(task.publishedAt!.getTime()).toBeLessThanOrEqual(DEMO_CONFIG.asOf.getTime());
}
```

- [ ] **Step 3: Run the performance test and verify failure**

Run: `cd api && npm run test:seed:realistic -- performance.spec.ts`

Expected: FAIL because `generatePerformance` is undefined.

- [ ] **Step 4: Generate the five approved timeline slices**

Create deterministic cycles:

```ts
const CYCLES = [
  { key: '2025-LEGACY', type: 'annual', status: 'closed', start: '2025-01-01', end: '2025-12-31' },
  { key: '2026-Q1', type: 'quarterly', status: 'closed', start: '2026-01-01', end: '2026-03-31' },
  { key: '2026-Q2', type: 'quarterly', status: 'appeal', start: '2026-04-01', end: '2026-06-30' },
  { key: '2026-Q3', type: 'quarterly', status: 'self_eval', start: '2026-07-01', end: '2026-09-30' },
  { key: '2026-ANNUAL-LEADERS', type: 'annual', status: 'self_eval', start: '2026-01-01', end: '2026-12-31' },
] as const;
```

The legacy cycle creates 120 archives and no tasks. Q1/Q2/Q3 eligibility follows entry dates from Task 2. Annual leader tasks select the VP, nine first-level leaders, and two key business leaders.

- [ ] **Step 5: Implement correlated scoring and calibration**

```ts
export function calculateIndicatorScore(target: number, actual: number, higherIsBetter = true): number {
  const ratio = higherIsBetter ? actual / target : target / Math.max(actual, 0.0001);
  return Math.max(0, Math.min(100, Math.round(ratio * 10000) / 100));
}

export function rawGrade(score: number): PerfGrade {
  if (score >= 90) return PerfGrade.A;
  if (score >= 75) return PerfGrade.B;
  if (score >= 60) return PerfGrade.C;
  return PerfGrade.D;
}
```

Assign each person a stable performance factor, add cycle noise limited to ±6 points, and apply fixed story events. Sort eligible employees by calibrated performance index and assign final grade quotas exactly from `DEMO_CONFIG`; preserve `rawGrade`, populate `calibratedGrade`, and require a non-empty `calibrationNote` when they differ. Set coefficients A/B/C/D to 1.2/1.0/0.8/0.6.

- [ ] **Step 6: Generate coherent narratives, objectives, and action items**

`narratives.ts` must use the highest and lowest indicator results in each task. Self-review text names delivered outcomes, one improvement, next goals, and required support. Manager text names a strength, a low-scoring indicator, and a concrete development action. Generate exactly 1 company objective, 9 department objectives, 18 individual objectives, and 56 action items linked to Q3 or the annual leader cycle.

- [ ] **Step 7: Assert the fixed story trajectories**

```ts
expect(gradesForStory(bundle, 'excellentManager')).toEqual(['A', 'A']);
expect(gradesForStory(bundle, 'lowPerformer')).toEqual(['C', 'D']);
expect(gradesForStory(bundle, 'consecutiveLowPerformerA')).toEqual(['D', 'D']);
expect(gradesForStory(bundle, 'consecutiveLowPerformerB')).toEqual(['D', 'D']);
expect(taskForStory(bundle, 'lateEntryExempt', '2026-Q1').status).toBe('exempted');
expect(taskForStory(bundle, 'transferredEmployee', '2026-Q3').deptId).not.toBe(
  taskForStory(bundle, 'transferredEmployee', '2026-Q2').deptId,
);
```

- [ ] **Step 8: Run the performance suite and commit**

Run: `cd api && npm run test:seed:realistic`

Expected: all Task 1–4 tests PASS.

```bash
git add api/prisma/realistic-demo
git commit -m "feat(api): generate realistic performance history"
```

---

### Task 5: Post-Publish, Probation, and Notification Workflows

**Files:**
- Create: `api/prisma/realistic-demo/workflows.ts`
- Create: `api/prisma/realistic-demo/workflows.spec.ts`
- Modify: `api/prisma/realistic-demo/narratives.ts`
- Modify: `api/prisma/realistic-demo/types.ts`

**Interfaces:**
- Consumes: `PeopleBundle`, `PerformanceBundle`, `DemoContext`.
- Produces: `generateWorkflows(context, people, performance): WorkflowBundle` for all auxiliary row sets.

- [ ] **Step 1: Write failing exact workflow-count tests**

```ts
const workflows = buildWorkflowFixture();
expect(countBy(workflows.q1Interviews, 'status')).toEqual({ closed: 118 });
expect(countBy(workflows.q2Interviews, 'status')).toEqual({ closed: 107, filled: 13, pending: 3 });
expect(countBy(workflows.q1Appeals, 'finalResult')).toEqual({ maintained: 2, modified: 1 });
expect(workflows.q2Appeals).toHaveLength(4);
expect(countBy(workflows.q1ImprovementPlans, 'status')).toEqual({ completed: 7, in_progress: 4 });
expect(countBy(workflows.q2ImprovementPlans, 'status')).toEqual({ draft: 2, in_progress: 10 });
expect(workflows.probationReviews).toHaveLength(11);
expect(workflows.confirmations).toHaveLength(7);
expect(workflows.notifications).toHaveLength(48);
```

- [ ] **Step 2: Write failing state-contract tests**

```ts
for (const interview of workflows.interviews) {
  if (interview.status === 'closed') {
    expect(interview.managerSignedAt).not.toBeNull();
    expect(interview.employeeSignedAt).not.toBeNull();
  }
  if (interview.status === 'filled') {
    expect(interview.employeeSignedAt).toBeNull();
  }
  expect(interview.status).not.toBe('employee_signed');
}
for (const plan of workflows.improvementPlans) {
  expect(gradeForTask(plan.taskId).calibratedGrade).toBe('D');
}
```

- [ ] **Step 3: Run the workflow test and verify failure**

Run: `cd api && npm run test:seed:realistic -- workflows.spec.ts`

Expected: FAIL because `generateWorkflows` is undefined.

- [ ] **Step 4: Implement interviews, signatures, appeals, and improvement plans**

Q1 has 118 closed interviews with assessor and assessee signatures. Q2 has 107 closed interviews with both signatures, 13 filled interviews with no employee signature, and 3 pending interviews with neither signature. Do not generate `employee_signed`, because the current service transitions employee signature directly to `closed`.

Create Q1 appeals as two maintained and one modified; create Q2 as one maintained, one modified, one `dept_processing`, and one `hr_processing`. A modified appeal updates the corresponding grade, archive, task status, and flow records before the final bundle is returned. Generate one improvement plan for every final D result, preserving two consecutive-D user histories.

- [ ] **Step 5: Implement 11 probation reviews and 7 confirmations**

Current probation users: two `indicator_setting`, one `self_eval`, one `manager_scoring`, and three closed reviews with `voteResult=extend` that remain probationary. Historical cases: three closed/pass users now active and one closed/fail user now resigned. Every review has four indicators whose weights total 1.0. Confirmation statuses and timestamps must match pass/extend/fail outcomes.

- [ ] **Step 6: Implement notifications and audit rows**

Generate six recent notifications for each of the eight acceptance accounts: two unread actionable task notifications, two read workflow notifications, one read informational notification, and one failed DingTalk delivery with a sanitized error string. Generate audit logs for seven appeals and seven confirmation outcomes; use `127.0.0.1`, `realistic-demo-seed`, and no credentials in JSON.

- [ ] **Step 7: Run workflow and full unit suites**

Run: `cd api && npm run test:seed:realistic`

Expected: all Task 1–5 tests PASS.

- [ ] **Step 8: Commit workflow generation**

```bash
git add api/prisma/realistic-demo
git commit -m "feat(api): add realistic performance workflows"
```

---

### Task 6: Complete Dataset Orchestration and Validation

**Files:**
- Create: `api/prisma/realistic-demo/generate.ts`
- Create: `api/prisma/realistic-demo/validate.ts`
- Create: `api/prisma/realistic-demo/report.ts`
- Create: `api/prisma/realistic-demo/validate.spec.ts`
- Modify: `api/prisma/realistic-demo/types.ts`

**Interfaces:**
- Consumes: all Task 1–5 bundles.
- Produces: `generateRealisticDemoDataset()`, `validateRealisticDemoDataset(dataset)`, and `summarizeRealisticDemoDataset(dataset)`.

- [ ] **Step 1: Write failing orchestration and validation tests**

```ts
const dataset = generateRealisticDemoDataset();
expect(() => validateRealisticDemoDataset(dataset)).not.toThrow();
expect(summarizeRealisticDemoDataset(dataset)).toMatchObject({
  currentPeople: 128,
  resignedPeople: 4,
  q1Tasks: 120,
  q2Tasks: 124,
  q3Tasks: 128,
  annualLeaderTasks: 12,
  appeals: 7,
  improvementPlans: 23,
  probationReviews: 11,
  notifications: 48,
});
```

- [ ] **Step 2: Add path-specific negative tests**

```ts
const invalidWeight = structuredClone(generateRealisticDemoDataset());
invalidWeight.rows.indicatorInstances[0].weight = 0.91;
expect(() => validateRealisticDemoDataset(invalidWeight)).toThrow(/task=.*weight total/);

const invalidTime = structuredClone(generateRealisticDemoDataset());
invalidTime.rows.tasks.find((t) => t.status === 'closed')!.publishedAt = new Date('2026-09-01T00:00:00+08:00');
expect(() => validateRealisticDemoDataset(invalidTime)).toThrow(/publishedAt.*after asOf/);

const missingPlan = structuredClone(generateRealisticDemoDataset());
missingPlan.rows.improvementPlans.pop();
expect(() => validateRealisticDemoDataset(missingPlan)).toThrow(/D grade.*improvement plan/);
```

- [ ] **Step 3: Run validation tests and verify failure**

Run: `cd api && npm run test:seed:realistic -- validate.spec.ts`

Expected: FAIL because orchestration and validation functions do not exist.

- [ ] **Step 4: Implement orchestration and manifest assembly**

```ts
export function generateRealisticDemoDataset(): RealisticDemoDataset {
  const context = createDemoContext();
  const people = generatePeople(context);
  const catalog = generateCatalog(context, people);
  const performance = generatePerformance(context, people, catalog);
  const workflows = generateWorkflows(context, people, performance);
  return assembleDataset(context, people, catalog, performance, workflows);
}
```

The assembler deduplicates IDs, fills `manifest.ownedIds`, replaces password sentinels only in persistence, and rejects duplicate employee numbers before calling the validator.

- [ ] **Step 5: Implement every pre-write invariant**

Validate exact headcounts, employment/status quotas, base-department references, unique IDs/employee numbers, manager graph, leadership/approver resolution, indicator and dimension weights, task/cycle eligibility, exempt-task exclusions, score arithmetic, grade quotas, chronological timestamps, no future completions, appeal/grade/archive consistency, D/PIP coverage, interview/signature state, probation/confirmation outcome, resigned-user exclusion from new tasks, eight password sentinels, and `example.invalid` email usage.

Throw `RealisticDemoValidationError` with messages formatted as `path=<cycle>/<employeeNo>/<entity> rule=<rule> actual=<value> expected=<value>`.

- [ ] **Step 6: Run full unit suite and snapshot twice**

Run: `cd api && npm run test:seed:realistic && npm run test:seed:realistic`

Expected: both runs PASS and summaries are identical.

- [ ] **Step 7: Commit orchestration and validator**

```bash
git add api/prisma/realistic-demo
git commit -m "feat(api): validate realistic demo dataset"
```

---

### Task 7: Transactional Persistence, CLI Gates, and PostgreSQL Integration

**Files:**
- Create: `api/prisma/realistic-demo/ownership.ts`
- Create: `api/prisma/realistic-demo/persist.ts`
- Create: `api/prisma/realistic-demo/guards.ts`
- Create: `api/prisma/realistic-demo/guards.spec.ts`
- Create: `api/prisma/seed-realistic-demo.ts`
- Create: `api/prisma/verify-realistic-demo.ts`
- Create: `api/prisma/clean-realistic-demo.ts`
- Create: `api/test/suites/13-realistic-demo-seed.e2e-spec.ts`
- Modify: `api/package.json`

**Interfaces:**
- Consumes: `RealisticDemoDataset`, `validateRealisticDemoDataset`, `summarizeRealisticDemoDataset`, `PrismaClient`.
- Produces: `persistRealisticDemoDataset(prisma,dataset,passwordHash)`, `inspectOwnedRows(prisma,manifest)`, `cleanRealisticDemoData(prisma,manifest,{execute})`, and three CLI commands.

- [ ] **Step 1: Write failing guard tests**

```ts
expect(() => requireSeedWriteGate({ ENABLE_REALISTIC_DEMO_SEED: 'false' })).toThrow(/ENABLE_REALISTIC_DEMO_SEED=true/);
expect(() => requireSeedWriteGate({ ENABLE_REALISTIC_DEMO_SEED: 'true' })).toThrow(/REALISTIC_DEMO_ACCOUNT_PASSWORD/);
expect(requireSeedWriteGate({
  ENABLE_REALISTIC_DEMO_SEED: 'true',
  REALISTIC_DEMO_ACCOUNT_PASSWORD: 'not-logged-by-test',
})).toEqual({ password: 'not-logged-by-test' });
expect(() => requireCleanGate({ ENABLE_REALISTIC_DEMO_CLEAN: 'false' })).toThrow(/ENABLE_REALISTIC_DEMO_CLEAN=true/);
```

- [ ] **Step 2: Write failing integration tests for idempotency and ownership**

In `13-realistic-demo-seed.e2e-spec.ts`, use the existing E2E PostgreSQL database and `app.prisma`:

```ts
const dataset = generateRealisticDemoDataset();
const control = await app.prisma.user.create({ data: { employeeNo: 'SEED-CONTROL', name: 'Non-owned control row' } });
await persistRealisticDemoDataset(app.prisma, dataset, await bcrypt.hash('integration-only-password', 4));
const first = await verifyRealisticDemoData(app.prisma, dataset.manifest);
await persistRealisticDemoDataset(app.prisma, dataset, await bcrypt.hash('integration-only-password', 4));
const second = await verifyRealisticDemoData(app.prisma, dataset.manifest);
expect(second.counts).toEqual(first.counts);
expect(await app.prisma.user.findUnique({ where: { id: control.id } })).not.toBeNull();
```

Add separate tests that insert a foreign row at one deterministic ID and expect a collision before any deletion, and that force an insert failure inside the transaction and verify the previous complete dataset remains.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `cd api && npm run test:seed:realistic -- guards.spec.ts && npx jest --config ./test/jest-e2e.json --runInBand --runTestsByPath test/suites/13-realistic-demo-seed.e2e-spec.ts`

Expected: FAIL because guard/persistence functions and the E2E suite implementation are missing.

- [ ] **Step 4: Implement ownership inspection and exact cleanup order**

`inspectOwnedRows` must query every deterministic ID and compare immutable ownership evidence: employee number/email suffix for users, source description/code for templates and indicators, source JSON for archives/notifications/flows, and exact names/creator IDs for cycles/objectives. Any mismatch throws before the transaction.

Within one `$transaction` with a 120-second timeout, delete owned rows in this order: indicator-objective links and visibility links; signatures; notifications and audit logs; appeals, interviews, improvement plans, flow records, grade results, self/manager summaries, indicator instances; tasks and archives; snapshots and cycles; confirmation applications, probation indicators, probation reviews; action items and objectives; template indicators, dimensions, templates, indicators; synthetic users; synthetic departments. Clear leadership references to owned users before user deletion. Every `deleteMany` includes `id: { in: ownedIds }` or an equally narrow owned foreign-key set.

- [ ] **Step 5: Implement batched transactional inserts**

```ts
async function insertBatches<T>(rows: T[], write: (batch: T[]) => Promise<unknown>, size = 500) {
  for (let index = 0; index < rows.length; index += size) {
    await write(rows.slice(index, index + size));
  }
}

export async function persistRealisticDemoDataset(
  prisma: PrismaClient,
  dataset: RealisticDemoDataset,
  passwordHash: string,
): Promise<DatabaseDemoSummary> {
  validateRealisticDemoDataset(dataset);
  await assertOwnedOrAbsent(prisma, dataset.manifest);
  return prisma.$transaction(async (tx) => {
    await removeOwnedRows(tx, dataset.manifest);
    await insertDatasetRows(tx, replacePasswordSentinels(dataset, passwordHash));
    await applyDepartmentLeadership(tx, dataset.departmentLeadership);
    return verifyRealisticDemoData(tx, dataset.manifest);
  }, { timeout: 120_000 });
}
```

Insert in the dependency order documented in the design: departments, users, leadership, catalog, objectives, cycles/snapshots/tasks, indicator and evaluation rows, results/flows/archives, workflows, signatures, notifications, and audit logs.

- [ ] **Step 6: Implement preview, write, verify, and cleanup CLIs**

`seed-realistic-demo.ts --dry-run` generates, validates, inspects collisions, and prints summary JSON without hashing a password or writing. Normal execution checks both seed environment variables, hashes the password with bcrypt cost 10, persists, prints counts, and never prints the password. `verify-realistic-demo.ts` is read-only and exits nonzero on any count or relation mismatch. `clean-realistic-demo.ts` prints owned counts by default and deletes only when the clean gate is enabled.

Add package scripts:

```json
{
  "db:seed:realistic:preview": "ts-node prisma/seed-realistic-demo.ts --dry-run",
  "db:seed:realistic": "ts-node prisma/seed-realistic-demo.ts",
  "db:seed:realistic:verify": "ts-node prisma/verify-realistic-demo.ts",
  "db:seed:realistic:clean": "ts-node prisma/clean-realistic-demo.ts"
}
```

- [ ] **Step 7: Run unit, integration, full E2E, and build verification**

Run:

```bash
cd api
npm run test:seed:realistic
npx jest --config ./test/jest-e2e.json --runInBand --runTestsByPath test/suites/13-realistic-demo-seed.e2e-spec.ts
npm run test:e2e
npm test -- --runInBand
npm run build
```

Expected: realistic unit tests PASS; integration suite PASS with identical first/second counts and preserved control row; all API E2E and unit suites PASS; build exits 0.

- [ ] **Step 8: Commit persistence and CLI**

```bash
git add api/package.json api/prisma/realistic-demo api/prisma/seed-realistic-demo.ts api/prisma/verify-realistic-demo.ts api/prisma/clean-realistic-demo.ts api/test/suites/13-realistic-demo-seed.e2e-spec.ts
git commit -m "feat(api): persist realistic demo data safely"
```

---

### Task 8: Runbook, Production-Mode Load, and Cross-Role Acceptance

**Files:**
- Create: `docs/operations/realistic-demo-data.md`
- Create during execution: `docs/acceptance/2026-08-11-realistic-demo-data.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 7 CLIs, the configured current database, API/web services, eight acceptance account numbers, and a securely supplied `REALISTIC_DEMO_ACCOUNT_PASSWORD` environment value.
- Produces: an operator-safe runbook, verified production-mode dataset, browser evidence, and final acceptance report.

- [ ] **Step 1: Write the runbook before touching the target database**

Document the exact PowerShell sequence without echoing secrets:

```powershell
Set-Location C:\Users\lwei\Documents\Claude\KeyFord\HRM\api
npm run db:seed:realistic:preview
if (-not $env:REALISTIC_DEMO_ACCOUNT_PASSWORD) { throw 'REALISTIC_DEMO_ACCOUNT_PASSWORD must be supplied securely before write' }
$env:ENABLE_REALISTIC_DEMO_SEED = 'true'
npm run db:seed:realistic
npm run db:seed:realistic:verify
Remove-Item Env:ENABLE_REALISTIC_DEMO_SEED
```

Explain preview/write/verify/clean gates, expected counts, account numbers, rollback behavior, and how to rotate the shared acceptance password by rerunning the seed.

- [ ] **Step 2: Link the runbook from README and verify docs**

Add a short “真实演示数据” section linking `docs/operations/realistic-demo-data.md`. Run `git diff --check` and verify commands/names match `api/package.json` exactly.

- [ ] **Step 3: Run all pre-write verification on fresh code**

Run:

```bash
cd api
npm run test:seed:realistic
npm test -- --runInBand
npm run test:e2e
npm run build
cd ../web
npm run test:contracts
npm run build
```

Expected: zero failing tests; both builds exit 0. Do not proceed to the target database if any command fails.

- [ ] **Step 4: Preview the currently configured target and inspect collision output**

Run: `cd api && npm run db:seed:realistic:preview`

Expected: validation success; 128 current people, 4 resigned people, 384 assessment tasks, 7 appeals, 23 improvement plans, 11 probation reviews, and 48 notifications; no foreign collision. If the secure password environment value is absent, pause before the write and ask the user to supply it without displaying it.

- [ ] **Step 5: Execute the explicitly authorized production-mode write and verify it**

Set `ENABLE_REALISTIC_DEMO_SEED=true`, run `npm run db:seed:realistic`, immediately remove the gate variable, then run `npm run db:seed:realistic:verify`. Run the seed a second time and verify identical deterministic IDs/counts to prove idempotency on the actual target.

- [ ] **Step 6: Start or reuse API/web services and perform browser acceptance**

Use the `browser:control-in-app-browser` skill during execution. For every role, attach `pageerror` and console-error inspection, visit the routes, refresh once, and confirm data remains visible:

| Role | Required routes and evidence |
| --- | --- |
| Admin | `/dashboard`, `/users`, `/cycles`, `/reports`; 128 current people and role menus. |
| HR | `/dashboard`, `/cycles`, `/calibration`, `/publish`, `/appeals`, `/users`, `/probation-reviews/manage`, `/confirmation-applications/manage`, `/reports`; Q1/Q2/Q3 and distribution totals. |
| VP | `/approval`, `/reports`, `/confirmation-applications/approvals`; assigned department scope and pending approvals. |
| Department head | `/tasks?scope=team`, `/reports`, `/appeals`; department-only people and mixed task statuses. |
| Manager | `/tasks?scope=team`, `/interviews`, `/objectives`, `/action-items`, `/probation-reviews/manager`; team size and actionable records. |
| Employee | `/dashboard`, `/tasks`; own Q1/Q2/Q3 history only. |
| Low performer | `/tasks`, `/improvement-plans`; C→D history and linked plan text. |
| Probation employee | `/probation-reviews/mine`, `/confirmation-applications/mine`; current probation stage and dates. |

Capture one screenshot per role plus detail screenshots for the modified appeal, consecutive-D improvement history, exemption, and transfer. No screenshot may contain a plaintext password.

- [ ] **Step 7: Write the acceptance report from observed evidence**

Create `docs/acceptance/2026-08-11-realistic-demo-data.md` with a table containing role, route, API call, business step, expected result, observed result, refresh result, console result, screenshot path, and blocker. Put acceptance result and blockers first. Include the final `db:seed:realistic:verify` JSON summary and exact test command totals; do not claim readiness from unit tests alone.

- [ ] **Step 8: Run final repository verification**

Run:

```bash
git diff --check
cd api && npm run test:seed:realistic && npm test -- --runInBand && npm run test:e2e && npm run build
cd ../web && npm run test:contracts && npm run build
```

Expected: all commands exit 0 and the acceptance report has no unresolved blocker. If a blocker remains, report it instead of marking implementation complete.

- [ ] **Step 9: Commit runbook and verified acceptance evidence**

```bash
git add README.md docs/operations/realistic-demo-data.md docs/acceptance/2026-08-11-realistic-demo-data.md
git commit -m "docs: verify realistic demo dataset"
```

---

## Final Verification Checklist

- [ ] `git status --short` contains no unintended staged or modified files.
- [ ] `npm run test:seed:realistic` passes twice with identical generator snapshots.
- [ ] API unit, E2E, and build commands pass with fresh output.
- [ ] Web contract tests and build pass with fresh output.
- [ ] Preview reports no collision before the target write.
- [ ] Actual target seed succeeds twice with identical deterministic IDs/counts.
- [ ] Verify CLI confirms 128 current people, 4 resigned people, 384 tasks, 7 appeals, 23 improvement plans, 11 probation reviews, and 48 notifications.
- [ ] Only eight accounts have password hashes and no plaintext password appears in logs, files, or screenshots.
- [ ] All eight roles pass route, refresh, scope, and console checks.
- [ ] The acceptance report leads with result and blockers and links observed evidence.
