# Goal Tracking Reference Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the action-item management page at `/action-items` with a reference-aligned, read-only “person → cycle → assessment indicators” goal-tracking workspace that employees and managers can use without widening existing data scope.

**Architecture:** Add one employee-accessible, read-only goal-tracking endpoint that reuses `ObjectivesService.buildWhere()` and returns each visible objective with its latest viewer-visible action-item summary. On the web side, keep `PerformanceWorkspace`, add focused people and indicator panels, and isolate URL/request orchestration in a composable so selection, deep links, stale-response protection, persistence, and responsive rendering remain testable.

**Tech Stack:** NestJS 10, Prisma 5, Jest 29, Vue 3 Composition API, TypeScript 5.6, Element Plus 2.8, Vue Router 4, Playwright 1.61.

## Global Constraints

- Keep the HRM global blue navigation rail and top user header unchanged.
- Keep the public path `/action-items` for compatibility, but remove action-item create/edit/delete/progress controls from that page.
- Do not show a “创建群聊” button and do not add DingTalk group-chat capability.
- Expose goal tracking to every authenticated role; keep the target-map route and its navigation permission unchanged.
- Show only “我” and “直接上级” in the people panel; do not add company-wide employee search.
- Selecting a direct manager must not bypass the existing objective visibility predicate.
- The latest-progress aggregate must not expose an action item that the existing objective/action-item visibility rules would hide.
- Keep all existing objective, cycle, and action-item write APIs and database tables unchanged.
- Persist only validated, allow-listed UI state under `kayford.goalTracking.collapsedPeopleGroups` and `kayford.goalTracking.visibleColumns`.
- Type-check/build success is not sufficient: complete real employee/manager browser acceptance, console inspection, refresh/history checks, and desktop/mobile screenshots.

---

## File Structure

### API

- Create `api/src/objectives/dto/goal-tracking-query.dto.ts`: validated `ownerId`, `cycleId`, and `objectiveId` query contract.
- Create `api/src/objectives/objectives.controller.spec.ts`: locks employee access to only the goal-tracking read method.
- Modify `api/src/objectives/objectives.controller.ts`: register `GET /objectives/tracking` before `GET /objectives/:id`.
- Create `api/src/action-items/action-item-visibility.ts`: centralize the existing action-item read predicate without changing its semantics.
- Create `api/src/action-items/action-item-visibility.spec.ts`: lock the current non-admin and HR/system-admin visibility behavior.
- Modify `api/src/action-items/action-items.service.ts`: reuse the shared action-item visibility predicate.
- Modify `api/src/objectives/objectives.service.ts`: add the bounded objective query plus latest-visible-action aggregation and mapping.
- Modify `api/src/objectives/objectives.service.spec.ts`: cover visibility composition, aggregation, mapping, and invalid queries.

### Web domain and orchestration

- Modify `web/src/types/api.types.ts`: add `GoalTrackingQuery`, `GoalTrackingItem`, `GoalTrackingLatestProgress`, and `GoalTrackingResult`.
- Modify `web/src/api/objectives.api.ts`: add `getTracking(query)`.
- Create `web/src/views/objectives/goal-tracking.ts`: pure people/cycle/status/storage helpers and constants.
- Create `web/src/views/objectives/use-goal-tracking.ts`: URL state, API orchestration, stale-response protection, retry, and deep-link resolution.
- Create `web/e2e/specs/12-goal-tracking-model.spec.ts`: node-only contract tests for the pure helpers.
- Modify `web/tsconfig.contracts.json` and `web/playwright.contract.config.ts`: include the new contract spec.

### Web UI

- Create `web/src/views/objectives/GoalTrackingPeoplePanel.vue`: search, “我/直接上级” groups, persisted collapse state, and selection.
- Create `web/src/views/objectives/GoalTrackingIndicatorPanel.vue`: person/cycle header, total weight, custom columns, rows, skeleton, empty, and error states.
- Create `web/src/views/objectives/GoalTrackingView.vue`: compose `PerformanceWorkspace`, the people panel, and the indicator panel.
- Modify `web/src/router/routes.ts`: route `/action-items` to `GoalTrackingView.vue` and include `employee` in its role list.
- Modify `web/src/views/task/TaskListView.vue`: employee local performance sections become `tracking + tasks`; managers keep all three.
- Modify `web/src/views/objectives/ObjectiveMapView.vue`: rename the row link to “目标跟进” and keep the `objectiveId` compatibility query.
- Delete `web/src/views/objectives/ActionItemsView.vue` after the new route and tests no longer reference it.

### Verification

- Verify `web/e2e/specs/02-role-menu-visibility.spec.ts` unchanged: the global sidebar still does not gain a target-tracking item.
- Modify `web/e2e/specs/06-role-page-smoke.spec.ts`: add employee `/action-items` smoke coverage.
- Modify `web/e2e/specs/07-peripheral-actions.spec.ts`: remove obsolete action-item UI creation assertions while retaining objective-write coverage.
- Modify `web/e2e/specs/09-performance-workspace.spec.ts`: replace old action-item tests with the complete goal-tracking interaction contract.
- Verify `web/e2e/specs/11-navigation-entrypoints.spec.ts` unchanged: route classification and global navigation contracts remain valid.
- Create `docs/acceptance/2026-08-15-goal-tracking.md`: record commands, real-role checks, console result, and screenshot links.
- Create screenshots under `docs/acceptance/2026-08-15-goal-tracking/`.

---

### Task 1: Add the read-only goal-tracking API

**Files:**
- Create: `api/src/action-items/action-item-visibility.ts`
- Create: `api/src/action-items/action-item-visibility.spec.ts`
- Modify: `api/src/action-items/action-items.service.ts:1-15, 227-249`
- Create: `api/src/objectives/dto/goal-tracking-query.dto.ts`
- Create: `api/src/objectives/objectives.controller.spec.ts`
- Modify: `api/src/objectives/objectives.controller.ts:1-83`
- Modify: `api/src/objectives/objectives.service.ts:16-60, 67-145, 280-370`
- Test: `api/src/objectives/objectives.service.spec.ts`

**Interfaces:**
- Consumes: existing `ObjectivesService.buildWhere(query, viewer)` data-scope predicate and the exact action-item predicate currently embedded in `ActionItemsService.buildWhere()`.
- Produces: `ObjectivesService.findTracking(query: GoalTrackingQueryDto, viewer: AuthUser): Promise<GoalTrackingResult>` and `GET /objectives/tracking?ownerId=<uuid>&cycleId=<uuid>` or `?objectiveId=<uuid>`.

- [ ] **Step 1: Write failing service tests for aggregation and permissions**

Extend the Prisma mock with `actionItem.findMany`, return the objective and action-item records separately, and add these tests to `objectives.service.spec.ts`:

```ts
let prisma: {
  objective: { count: jest.Mock; findMany: jest.Mock };
  actionItem: { findMany: jest.Mock };
  user: { findMany: jest.Mock };
};

// Inside beforeEach():
prisma = {
  objective: { count: jest.fn(), findMany: jest.fn() },
  actionItem: { findMany: jest.fn() },
  user: {
    findMany: jest.fn().mockResolvedValue([
      { id: 'manager-1' },
      { id: 'employee-1' },
    ]),
  },
};
```

```ts
it('returns visible owner-cycle objectives with one latest progress summary', async () => {
  prisma.objective.findMany.mockResolvedValue([visibleObjective]);
  prisma.actionItem.findMany.mockResolvedValue([
    {
      id: 'action-latest',
      objectiveId: 'objective-visible',
      title: '完成方案评审',
      progress: 60,
      updatedAt: new Date('2026-08-15T08:00:00.000Z'),
    },
    {
      id: 'action-older',
      objectiveId: 'objective-visible',
      title: '旧进展',
      progress: 30,
      updatedAt: new Date('2026-08-14T08:00:00.000Z'),
    },
  ]);

  const result = await service.findTracking(
    { ownerId: 'employee-1', cycleId: 'cycle-1' },
    viewer,
  );

  expect(prisma.objective.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      ownerId: 'employee-1',
      cycleId: 'cycle-1',
      OR: expect.any(Array),
    }),
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  }));
  expect(prisma.actionItem.findMany).toHaveBeenCalledWith({
    where: {
      AND: [
        {
          OR: [
            { assigneeId: viewer.id },
            { createdBy: viewer.id },
            { objective: { ownerId: viewer.id } },
            { objective: { level: 'company' } },
          ],
        },
        { objectiveId: { in: ['objective-visible'] } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      objectiveId: true,
      title: true,
      progress: true,
      updatedAt: true,
    },
  });
  expect(result).toEqual({
    totalWeight: 50,
    items: [expect.objectContaining({
      id: 'objective-visible',
      latestProgress: {
        id: 'action-latest',
        title: '完成方案评审',
        progress: 60,
        updatedAt: new Date('2026-08-15T08:00:00.000Z'),
      },
    })],
  });
});

it('resolves a deep link through the same visibility predicate', async () => {
  prisma.objective.findMany.mockResolvedValue([]);

  await service.findTracking({ objectiveId: 'objective-visible' }, viewer);

  expect(prisma.objective.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: {
      AND: [
        expect.objectContaining({ OR: expect.any(Array) }),
        { id: 'objective-visible' },
      ],
    },
  }));
});

it('rejects tracking requests without a deep link or owner-cycle pair', async () => {
  await expect(service.findTracking({ ownerId: 'employee-1' }, viewer))
    .rejects.toMatchObject({ response: expect.objectContaining({ message: '请选择人员和考核周期' }) });
});
```

- [ ] **Step 2: Write failing tests for the shared action-item visibility predicate**

Create `action-item-visibility.spec.ts`:

```ts
import { SysRole } from '@prisma/client';
import { AuthUser } from '@/common/types/auth.types';
import { buildActionItemVisibilityWhere } from './action-item-visibility';

const viewer: AuthUser = {
  id: 'employee-1',
  name: 'Employee',
  sysRole: SysRole.employee,
  deptId: 'dept-1',
  isAssessorOnly: false,
  canViewAll: false,
};

describe('buildActionItemVisibilityWhere', () => {
  it('preserves the existing non-admin read predicate', () => {
    expect(buildActionItemVisibilityWhere(viewer)).toEqual({
      OR: [
        { assigneeId: 'employee-1' },
        { createdBy: 'employee-1' },
        { objective: { ownerId: 'employee-1' } },
        { objective: { level: 'company' } },
      ],
    });
  });

  it.each([SysRole.hr, SysRole.system_admin])(
    'keeps %s unrestricted',
    (sysRole) => {
      expect(buildActionItemVisibilityWhere({ ...viewer, sysRole })).toEqual({});
    },
  );
});
```

- [ ] **Step 3: Write the failing controller role-metadata test**

Create `objectives.controller.spec.ts`:

```ts
import { SysRole } from '@prisma/client';
import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import { ObjectivesController } from './objectives.controller';

describe('ObjectivesController tracking access', () => {
  it('overrides the manager-only controller role list for every authenticated role', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      ObjectivesController.prototype.findTracking,
    );
    expect(roles).toEqual([
      SysRole.employee,
      SysRole.manager,
      SysRole.dept_head,
      SysRole.vp,
      SysRole.hr,
      SysRole.chairman,
      SysRole.system_admin,
    ]);
  });
});
```

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```powershell
cd api
npm test -- action-item-visibility.spec.ts objectives.service.spec.ts objectives.controller.spec.ts --runInBand
```

Expected: FAIL because the shared visibility helper, `findTracking`, and `ObjectivesController.prototype.findTracking` do not exist.

- [ ] **Step 5: Extract and reuse the current action-item visibility predicate**

Create `action-item-visibility.ts` with the same four non-admin branches and the same HR/system-admin bypass currently used by `ActionItemsService`:

```ts
import { Prisma, SysRole } from '@prisma/client';
import { AuthUser } from '@/common/types/auth.types';

export function buildActionItemVisibilityWhere(
  viewer: AuthUser,
): Prisma.ActionItemWhereInput {
  if ([SysRole.hr, SysRole.system_admin].includes(viewer.sysRole)) return {};

  return {
    OR: [
      { assigneeId: viewer.id },
      { createdBy: viewer.id },
      { objective: { ownerId: viewer.id } },
      { objective: { level: 'company' } },
    ],
  };
}
```

Import it in `action-items.service.ts` and replace only the existing inline role block inside `buildWhere()`:

```ts
Object.assign(where, buildActionItemVisibilityWhere(viewer));
```

Do not change the query-field filters or the service's existing write authorization methods.

- [ ] **Step 6: Add the validated query DTO**

Create `goal-tracking-query.dto.ts`:

```ts
import { IsOptional, IsUUID } from 'class-validator';

export class GoalTrackingQueryDto {
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsUUID()
  cycleId?: string;

  @IsOptional()
  @IsUUID()
  objectiveId?: string;
}
```

- [ ] **Step 7: Implement the bounded tracking projection in `ObjectivesService`**

Add dedicated interfaces and an objective include that does not change `ObjectiveNode`:

```ts
const goalTrackingInclude = {
  owner: { select: { id: true, name: true } },
  cycle: { select: { id: true, name: true } },
} as const;

type GoalTrackingObjective = Prisma.ObjectiveGetPayload<{
  include: typeof goalTrackingInclude;
}>;

export interface GoalTrackingLatestProgress {
  id: string;
  title: string;
  progress: number;
  updatedAt: Date;
}

export interface GoalTrackingItem {
  id: string;
  title: string;
  ownerId: string | null;
  ownerName: string | null;
  cycleId: string | null;
  cycleName: string | null;
  priority: number;
  status: ObjectiveStatus;
  progress: number;
  weight: number | null;
  latestProgress: GoalTrackingLatestProgress | null;
}

export interface GoalTrackingResult {
  totalWeight: number;
  items: GoalTrackingItem[];
}
```

Implement the method with the existing visibility builder:

```ts
async findTracking(
  query: GoalTrackingQueryDto,
  viewer: AuthUser,
): Promise<GoalTrackingResult> {
  if (!query.objectiveId && (!query.ownerId || !query.cycleId)) {
    throw new BadRequestException({
      code: ERROR_CODE.PARAM_INVALID,
      message: '请选择人员和考核周期',
    });
  }

  const visibilityWhere = await this.buildWhere(
    query.objectiveId
      ? {}
      : { ownerId: query.ownerId, cycleId: query.cycleId },
    viewer,
  );
  const where = query.objectiveId
    ? { AND: [visibilityWhere, { id: query.objectiveId }] }
    : visibilityWhere;
  const objectives = await this.prisma.objective.findMany({
    where,
    include: goalTrackingInclude,
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });
  const objectiveIds = objectives.map((objective) => objective.id);
  const visibleActions = objectiveIds.length === 0
    ? []
    : await this.prisma.actionItem.findMany({
        where: {
          AND: [
            buildActionItemVisibilityWhere(viewer),
            { objectiveId: { in: objectiveIds } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          objectiveId: true,
          title: true,
          progress: true,
          updatedAt: true,
        },
      });
  const latestByObjective = new Map<string, GoalTrackingLatestProgress>();
  for (const action of visibleActions) {
    if (!latestByObjective.has(action.objectiveId)) {
      latestByObjective.set(action.objectiveId, {
        id: action.id,
        title: action.title,
        progress: action.progress,
        updatedAt: action.updatedAt,
      });
    }
  }
  const items = objectives.map((objective: GoalTrackingObjective): GoalTrackingItem => ({
    id: objective.id,
    title: objective.title,
    ownerId: objective.ownerId,
    ownerName: objective.owner?.name ?? null,
    cycleId: objective.cycleId,
    cycleName: objective.cycle?.name ?? null,
    priority: objective.priority,
    status: objective.status,
    progress: objective.progress,
    weight: objective.weight?.toNumber() ?? null,
    latestProgress: latestByObjective.get(objective.id) ?? null,
  }));
  return {
    totalWeight: items.reduce((sum, item) => sum + (item.weight ?? 0), 0),
    items,
  };
}
```

Import `buildActionItemVisibilityWhere` from `@/action-items/action-item-visibility`. This deliberately uses one objective query plus one batched action-item query. It avoids N+1 behavior while ensuring that “最新进展” is chosen only from action items the viewer could already read through `ActionItemsService`.

Import `GoalTrackingQueryDto` and keep the endpoint before `@Get(':id')`:

```ts
@Get('tracking')
@Roles(
  SysRole.employee,
  SysRole.manager,
  SysRole.dept_head,
  SysRole.vp,
  SysRole.hr,
  SysRole.chairman,
  SysRole.system_admin,
)
findTracking(
  @Query() query: GoalTrackingQueryDto,
  @CurrentUser() viewer: AuthUser,
) {
  return this.objectivesService.findTracking(query, viewer);
}
```

- [ ] **Step 8: Run the focused tests and verify GREEN**

Run:

```powershell
cd api
npm test -- action-item-visibility.spec.ts objectives.service.spec.ts objectives.controller.spec.ts --runInBand
```

Expected: all three suites PASS with zero failures.

- [ ] **Step 9: Commit the API slice**

```powershell
git add api/src/action-items/action-item-visibility.ts api/src/action-items/action-item-visibility.spec.ts api/src/action-items/action-items.service.ts api/src/objectives/dto/goal-tracking-query.dto.ts api/src/objectives/objectives.controller.ts api/src/objectives/objectives.controller.spec.ts api/src/objectives/objectives.service.ts api/src/objectives/objectives.service.spec.ts
git commit -m "feat(api): add goal tracking read model"
```

---

### Task 2: Add frontend contracts and pure goal-tracking state helpers

**Files:**
- Modify: `web/src/types/api.types.ts:1365-1425`
- Modify: `web/src/api/objectives.api.ts:1-52`
- Create: `web/src/views/objectives/goal-tracking.ts`
- Create: `web/e2e/specs/12-goal-tracking-model.spec.ts`
- Modify: `web/tsconfig.contracts.json`
- Modify: `web/playwright.contract.config.ts`

**Interfaces:**
- Consumes: `AssessmentCycle`, `CurrentUser`, `ObjectiveStatus`, and Task 1's JSON response.
- Produces: `objectivesApi.getTracking(query)`, `buildTrackingPeople`, `selectDefaultTrackingCycle`, `goalTrackingStatus`, `parseVisibleColumns`, and `parseCollapsedPeopleGroups`.

- [ ] **Step 1: Write the failing node-only contract tests**

Create `12-goal-tracking-model.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import type { AssessmentCycle } from '../../src/types/api.types';
import {
  buildTrackingPeople,
  goalTrackingStatus,
  parseCollapsedPeopleGroups,
  parseVisibleColumns,
  selectDefaultTrackingCycle,
} from '../../src/views/objectives/goal-tracking';

test('builds only self and direct-manager people groups', () => {
  const groups = buildTrackingPeople({
    id: 'employee-1',
    name: '刘伟',
    sysRole: 'employee',
    deptId: 'dept-1',
    isAssessorOnly: false,
    canViewAll: false,
    directManagerId: 'manager-1',
    directManagerName: '林治',
  });
  expect(groups.map((group) => [group.key, group.people.map((person) => person.name)]))
    .toEqual([['self', ['刘伟']], ['manager', ['林治']]]);
  expect(buildTrackingPeople({
    id: 'employee-2',
    name: '无上级员工',
    sysRole: 'employee',
    deptId: 'dept-1',
    isAssessorOnly: false,
    canViewAll: false,
  }).map((group) => group.key)).toEqual(['self']);
});

test('chooses the newest in-flight cycle before drafts and closed cycles', () => {
  const cycle = (
    id: string,
    name: string,
    status: AssessmentCycle['status'],
    startDate: string,
    endDate: string,
  ): AssessmentCycle => ({
    id, name, status, startDate, endDate, type: 'quarterly',
    publishVisibleFields: {
      totalScore: true,
      grade: true,
      indicatorScores: true,
      managerComment: true,
      coefficient: false,
    },
    gradeAMaxRatio: 0.2,
    gradeBMaxRatio: 0.4,
    gradeCMaxRatio: 0.3,
    gradeDMaxRatio: 0.1,
  });
  const selected = selectDefaultTrackingCycle([
    cycle('draft', '草稿', 'draft', '2026-08-01', '2026-09-01'),
    cycle('active-old', '进行中一', 'self_eval', '2026-01-01', '2026-03-31'),
    cycle('active-new', '进行中二', 'manager_score', '2026-04-01', '2026-06-30'),
  ]);
  expect(selected?.id).toBe('active-new');
});

test('maps objective status from archive and progress semantics', () => {
  expect(goalTrackingStatus({ status: 'active', progress: 0 })).toBe('未开始');
  expect(goalTrackingStatus({ status: 'draft', progress: 60 })).toBe('未开始');
  expect(goalTrackingStatus({ status: 'active', progress: 60 })).toBe('进行中');
  expect(goalTrackingStatus({ status: 'active', progress: 100 })).toBe('已完成');
  expect(goalTrackingStatus({ status: 'archived', progress: 60 })).toBe('已归档');
});

test('validates persisted visible columns and collapse booleans', () => {
  expect(parseVisibleColumns('["status","weight","unknown"]'))
    .toEqual(['status', 'weight']);
  expect(parseVisibleColumns('{broken')).toEqual([
    'latestProgress', 'status', 'progress', 'weight',
  ]);
  expect(parseCollapsedPeopleGroups('{"self":true,"manager":false,"x":"bad"}'))
    .toEqual({ self: true, manager: false });
});
```

- [ ] **Step 2: Include the new contract spec and verify RED**

Add `e2e/specs/12-goal-tracking-model.spec.ts` to `tsconfig.contracts.json` and change `testMatch` to:

```ts
testMatch: [
  '10-team-performance-contract.spec.ts',
  '12-goal-tracking-model.spec.ts',
],
```

Run:

```powershell
cd web
npm run test:contracts -- --grep "goal tracking|builds only|chooses the newest|maps objective|validates persisted"
```

Expected: FAIL because `goal-tracking.ts` does not exist.

- [ ] **Step 3: Add the frontend API types and client method**

Add these interfaces to `api.types.ts`:

```ts
export interface GoalTrackingLatestProgress {
  id: string;
  title: string;
  progress: number;
  updatedAt: string;
}

export interface GoalTrackingItem {
  id: string;
  title: string;
  ownerId: string | null;
  ownerName: string | null;
  cycleId: string | null;
  cycleName: string | null;
  priority: number;
  status: ObjectiveStatus;
  progress: number;
  weight: number | null;
  latestProgress: GoalTrackingLatestProgress | null;
}

export interface GoalTrackingResult {
  totalWeight: number;
  items: GoalTrackingItem[];
}

export interface GoalTrackingQuery {
  ownerId?: string;
  cycleId?: string;
  objectiveId?: string;
}
```

Add to `objectives.api.ts`:

```ts
getTracking(query: GoalTrackingQuery): Promise<GoalTrackingResult> {
  return apiGet('/objectives/tracking', query as Record<string, unknown>);
},
```

- [ ] **Step 4: Implement the pure helpers**

Create `goal-tracking.ts` with these public names and allow lists:

```ts
import type { AssessmentCycle, CurrentUser } from '@/types/api.types';
import type { ObjectiveStatus } from '@/types/enums';

export const GOAL_TRACKING_COLUMNS = [
  'latestProgress', 'status', 'progress', 'weight',
] as const;
export type GoalTrackingColumn = (typeof GOAL_TRACKING_COLUMNS)[number];
export type GoalTrackingPerson = { id: string; name: string; avatarUrl?: string };
export type GoalTrackingPeopleGroup = {
  key: 'self' | 'manager';
  label: '我' | '直接上级';
  people: GoalTrackingPerson[];
};

const ACTIVE_CYCLE_STATUSES = new Set([
  'indicator_setting', 'self_eval', 'manager_score',
  'hr_calibration', 'approval', 'appeal',
]);

export function buildTrackingPeople(user: CurrentUser): GoalTrackingPeopleGroup[] {
  const groups: GoalTrackingPeopleGroup[] = [{
    key: 'self',
    label: '我',
    people: [{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }],
  }];
  if (user.directManagerId && user.directManagerName) {
    groups.push({
      key: 'manager',
      label: '直接上级',
      people: [{ id: user.directManagerId, name: user.directManagerName }],
    });
  }
  return groups;
}

export function selectDefaultTrackingCycle(cycles: AssessmentCycle[]) {
  const sorted = [...cycles].sort((left, right) =>
    right.startDate.localeCompare(left.startDate));
  return sorted.find((cycle) => ACTIVE_CYCLE_STATUSES.has(cycle.status)) ?? sorted[0] ?? null;
}

export function goalTrackingStatus(item: { status: ObjectiveStatus; progress: number }) {
  if (item.status === 'archived') return '已归档';
  if (item.status === 'draft') return '未开始';
  if (item.progress >= 100) return '已完成';
  if (item.progress > 0) return '进行中';
  return '未开始';
}

export function parseVisibleColumns(raw: string | null): GoalTrackingColumn[] {
  if (!raw) return [...GOAL_TRACKING_COLUMNS];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...GOAL_TRACKING_COLUMNS];
    return parsed.filter((value): value is GoalTrackingColumn =>
      GOAL_TRACKING_COLUMNS.includes(value as GoalTrackingColumn));
  } catch {
    return [...GOAL_TRACKING_COLUMNS];
  }
}

export function parseCollapsedPeopleGroups(raw: string | null) {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([key, value]) =>
        ['self', 'manager'].includes(key) && typeof value === 'boolean'),
    ) as Partial<Record<'self' | 'manager', boolean>>;
  } catch {
    return {};
  }
}
```

- [ ] **Step 5: Run the contract suite and verify GREEN**

Run:

```powershell
cd web
npm run test:contracts
```

Expected: all contract tests PASS, including `12-goal-tracking-model.spec.ts`.

- [ ] **Step 6: Commit the frontend contracts**

```powershell
git add web/src/types/api.types.ts web/src/api/objectives.api.ts web/src/views/objectives/goal-tracking.ts web/e2e/specs/12-goal-tracking-model.spec.ts web/tsconfig.contracts.json web/playwright.contract.config.ts
git commit -m "feat(web): define goal tracking view model"
```

---

### Task 3: Build the reference-aligned people and indicator workspace

**Files:**
- Create: `web/src/views/objectives/GoalTrackingPeoplePanel.vue`
- Create: `web/src/views/objectives/GoalTrackingIndicatorPanel.vue`
- Create: `web/src/views/objectives/GoalTrackingView.vue`
- Create: `web/src/views/objectives/use-goal-tracking.ts`
- Modify: `web/src/router/routes.ts:252-263`
- Modify: `web/src/views/task/TaskListView.vue:160-170`
- Modify: `web/e2e/specs/06-role-page-smoke.spec.ts:22-37`
- Modify: `web/e2e/specs/09-performance-workspace.spec.ts:38-105, 180-238`

**Interfaces:**
- Consumes: Task 2's helpers and `objectivesApi.getTracking`.
- Produces: `useGoalTracking()` state/actions, people-panel `select` emit, indicator-panel `cycle-change` and `retry` emits, and stable `data-testid` hooks.

- [ ] **Step 1: Replace the old page assertions with a failing reference-layout test**

In `09-performance-workspace.spec.ts`, replace the old action-item workspace test with:

```ts
test('employee sees the reference goal-tracking workspace for self and manager', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'employee-1', name: '刘伟', sysRole: 'employee', deptId: 'dept-1',
      isAssessorOnly: false, canViewAll: false,
      directManagerId: 'manager-1', directManagerName: '林治',
    })),
  }));
  await page.route('**/api/v1/cycles?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      total: 1, page: 1, pageSize: 100,
      items: [{
        id: 'cycle-1', name: '2026 第二季度', type: 'quarterly',
        startDate: '2026-04-01', endDate: '2026-06-30', status: 'self_eval',
        publishVisibleFields: {}, gradeAMaxRatio: 0.2, gradeBMaxRatio: 0.4,
        gradeCMaxRatio: 0.3, gradeDMaxRatio: 0.1,
      }],
    })),
  }));
  await page.route('**/api/v1/objectives/tracking?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      totalWeight: 100,
      items: [
        { id: 'objective-1', title: '产品项目', ownerId: 'employee-1', ownerName: '刘伟', cycleId: 'cycle-1', cycleName: '2026 第二季度', priority: 2, status: 'active', progress: 0, weight: 50, latestProgress: null },
        { id: 'objective-2', title: '新产品', ownerId: 'employee-1', ownerName: '刘伟', cycleId: 'cycle-1', cycleName: '2026 第二季度', priority: 1, status: 'active', progress: 35, weight: 50, latestProgress: { id: 'item-2', title: '完成需求评审', progress: 35, updatedAt: '2026-08-15T08:00:00.000Z' } },
      ],
    })),
  }));

  await page.goto('/action-items');

  await expect(page.getByTestId('performance-workspace-title')).toHaveText('目标跟进');
  await expect(page.getByTestId('goal-tracking-people')).toContainText('我');
  await expect(page.getByTestId('goal-tracking-people')).toContainText('直接上级');
  await expect(page.getByRole('button', { name: /刘伟/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('goal-tracking-cycle')).toContainText('2026 第二季度');
  await expect(page.getByTestId('goal-tracking-surface')).toContainText('考核指标');
  await expect(page.getByText('产品项目')).toBeVisible();
  await expect(page.getByText('暂无进展')).toBeVisible();
  await expect(page.getByText('完成需求评审')).toBeVisible();
  await expect(page.getByText('维度权重：100%')).toBeVisible();
  await expect(page.getByText('创建群聊')).toHaveCount(0);
  await expect(page.getByTestId('action-item-create')).toHaveCount(0);
  for (const obsoleteControl of ['全部状态', '全部负责人', '刷新', '列表', '看板', '新建行动项']) {
    await expect(page.getByText(obsoleteControl, { exact: true })).toHaveCount(0);
  }
  await page.getByTestId('goal-tracking-person-search').fill('林治');
  await expect(page.getByRole('button', { name: /林治/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /刘伟/ })).toHaveCount(0);
  await page.getByTestId('goal-tracking-person-search').fill('不存在');
  await expect(page.getByText('未找到匹配人员')).toBeVisible();
});
```

Also change the employee local-navigation assertion to expect “目标跟进” and “绩效待办”, but not “目标地图”, and add `/action-items` to the employee smoke list.

- [ ] **Step 2: Run the focused browser tests and verify RED**

Run:

```powershell
cd web
npx playwright test e2e/specs/09-performance-workspace.spec.ts e2e/specs/06-role-page-smoke.spec.ts --grep "reference goal-tracking|employee only|employee page works: /action-items"
```

Expected: FAIL because the employee route is forbidden and the goal-tracking test IDs do not exist.

- [ ] **Step 3: Implement the orchestration composable**

Create `use-goal-tracking.ts` with this public contract:

```ts
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { cyclesApi } from '@/api/cycles.api';
import { objectivesApi } from '@/api/objectives.api';
import { useAuthStore } from '@/stores/auth.store';
import type { AssessmentCycle, GoalTrackingResult } from '@/types/api.types';
import { buildTrackingPeople, selectDefaultTrackingCycle } from './goal-tracking';

export function useGoalTracking() {
  const route = useRoute();
  const router = useRouter();
  const auth = useAuthStore();
  const cycles = ref<AssessmentCycle[]>([]);
  const selectedPersonId = ref('');
  const selectedCycleId = ref('');
  const result = ref<GoalTrackingResult>({ totalWeight: 0, items: [] });
  const loading = ref(false);
  const error = ref('');
  let requestSerial = 0;

  const peopleGroups = computed(() => auth.user ? buildTrackingPeople(auth.user) : []);
  const people = computed(() => peopleGroups.value.flatMap((group) => group.people));
  const selectedPerson = computed(() =>
    people.value.find((person) => person.id === selectedPersonId.value) ?? people.value[0] ?? null);

  async function replaceQuery() {
    await router.replace({
      query: {
        employeeId: selectedPersonId.value || undefined,
        cycleId: selectedCycleId.value || undefined,
      },
    });
  }

  async function loadTracking() {
    if (!selectedPersonId.value || !selectedCycleId.value) return;
    const serial = ++requestSerial;
    loading.value = true;
    error.value = '';
    try {
      const next = await objectivesApi.getTracking({
        ownerId: selectedPersonId.value,
        cycleId: selectedCycleId.value,
      });
      if (serial === requestSerial) result.value = next;
    } catch {
      if (serial === requestSerial) error.value = '考核指标加载失败';
    } finally {
      if (serial === requestSerial) loading.value = false;
    }
  }

  async function selectPerson(id: string) {
    selectedPersonId.value = id;
    await replaceQuery();
    await loadTracking();
  }

  async function selectCycle(id: string) {
    selectedCycleId.value = id;
    await replaceQuery();
    await loadTracking();
  }

  onMounted(async () => {
    await auth.ensureLoaded();
    const page = await cyclesApi.findAll({ page: 1, pageSize: 100 });
    cycles.value = page.items;
    const defaultCycle = selectDefaultTrackingCycle(cycles.value);
    selectedPersonId.value = typeof route.query.employeeId === 'string'
      && people.value.some((person) => person.id === route.query.employeeId)
      ? route.query.employeeId
      : auth.user?.id ?? '';
    selectedCycleId.value = typeof route.query.cycleId === 'string'
      && cycles.value.some((cycle) => cycle.id === route.query.cycleId)
      ? route.query.cycleId
      : defaultCycle?.id ?? '';
    await replaceQuery();
    await loadTracking();
  });

  return {
    cycles, peopleGroups, selectedPerson, selectedPersonId, selectedCycleId,
    result, loading, error, selectPerson, selectCycle, retry: loadTracking,
  };
}
```

- [ ] **Step 4: Build the people and indicator panels**

`GoalTrackingPeoplePanel.vue` must expose:

```ts
const props = defineProps<{
  groups: GoalTrackingPeopleGroup[];
  selectedId: string;
}>();
const emit = defineEmits<{ select: [id: string] }>();
const keyword = ref('');
const filteredGroups = computed(() => props.groups.map((group) => ({
  ...group,
  people: group.people.filter((person) => person.name.includes(keyword.value.trim())),
})));
```

Its root is `data-testid="goal-tracking-people"`; its search is `data-testid="goal-tracking-person-search"`; each person is a real `<button>` with `:aria-pressed="person.id === selectedId"`.

When every filtered group is empty, keep the selected person unchanged and render the compact text `未找到匹配人员` inside the people panel.

`GoalTrackingIndicatorPanel.vue` must accept:

```ts
defineProps<{
  person: GoalTrackingPerson | null;
  cycles: AssessmentCycle[];
  selectedCycleId: string;
  result: GoalTrackingResult;
  loading: boolean;
  error: string;
}>();
const emit = defineEmits<{
  cycleChange: [cycleId: string];
  retry: [];
}>();
```

Render `data-testid="goal-tracking-surface"` with `role="table"`; the header uses `role="row"` and `role="columnheader"`, and every objective uses `role="row"` with labeled `role="cell"` values. This keeps the CSS-grid presentation queryable as a table without using Element Plus's heavy default table chrome.

Render the fixed columns with CSS grid:

```css
.goal-indicator-grid {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(180px, .7fr) 120px 120px 80px;
  align-items: center;
  column-gap: 20px;
}
```

Use `goalTrackingStatus(item)`, show `item.latestProgress?.title ?? '暂无进展'`, format progress as `${item.progress}%`, and format a null weight as `--`.

- [ ] **Step 5: Compose the page and open the employee route**

Create `GoalTrackingView.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth.store';
import PerformanceWorkspace from '@/components/performance/PerformanceWorkspace.vue';
import GoalTrackingPeoplePanel from './GoalTrackingPeoplePanel.vue';
import GoalTrackingIndicatorPanel from './GoalTrackingIndicatorPanel.vue';
import { useGoalTracking } from './use-goal-tracking';

const auth = useAuthStore();
const workspace = useGoalTracking();
const sections = computed(() => auth.user?.sysRole === 'employee'
  ? (['tracking', 'tasks'] as const)
  : (['tracking', 'map', 'tasks'] as const));
</script>

<template>
  <PerformanceWorkspace title="目标跟进" active-section="tracking" :sections="sections">
    <template #context>
      <GoalTrackingPeoplePanel
        :groups="workspace.peopleGroups.value"
        :selected-id="workspace.selectedPersonId.value"
        @select="workspace.selectPerson"
      />
    </template>
    <div class="goal-tracking-view">
      <GoalTrackingIndicatorPanel
        :person="workspace.selectedPerson.value"
        :cycles="workspace.cycles.value"
        :selected-cycle-id="workspace.selectedCycleId.value"
        :result="workspace.result.value"
        :loading="workspace.loading.value"
        :error="workspace.error.value"
        @cycle-change="workspace.selectCycle"
        @retry="workspace.retry"
      />
    </div>
  </PerformanceWorkspace>
</template>
```

In `routes.ts`, point `/action-items` at `GoalTrackingView.vue` and add `'employee'` to `roles`. In `TaskListView.vue`, change the employee sections to `['tracking', 'tasks']`.

- [ ] **Step 6: Run the focused browser tests and verify GREEN**

Run:

```powershell
cd web
npx playwright test e2e/specs/09-performance-workspace.spec.ts e2e/specs/06-role-page-smoke.spec.ts --grep "reference goal-tracking|employee only|employee page works: /action-items"
```

Expected: all selected tests PASS.

- [ ] **Step 7: Commit the reference workspace slice**

```powershell
git add web/src/views/objectives/GoalTrackingPeoplePanel.vue web/src/views/objectives/GoalTrackingIndicatorPanel.vue web/src/views/objectives/GoalTrackingView.vue web/src/views/objectives/use-goal-tracking.ts web/src/router/routes.ts web/src/views/task/TaskListView.vue web/e2e/specs/06-role-page-smoke.spec.ts web/e2e/specs/09-performance-workspace.spec.ts
git commit -m "feat(web): rebuild goal tracking workspace"
```

---

### Task 4: Add URL restoration, history, deep-link compatibility, and race safety

**Files:**
- Modify: `web/src/views/objectives/use-goal-tracking.ts`
- Modify: `web/src/views/objectives/GoalTrackingIndicatorPanel.vue`
- Modify: `web/src/views/objectives/ObjectiveMapView.vue:423-443`
- Modify: `web/e2e/specs/07-peripheral-actions.spec.ts:65-118`
- Modify: `web/e2e/specs/09-performance-workspace.spec.ts`

**Interfaces:**
- Consumes: Task 1's `objectiveId` query mode and Task 3's composable.
- Produces: canonical `employeeId + cycleId` URL state, highlighted objective ID, back/forward restoration, and stale-response rejection.

- [ ] **Step 1: Write failing URL, history, deep-link, and race tests**

Add these scenarios to `09-performance-workspace.spec.ts` with mocked `auth/me`, cycles, and tracking responses:

```ts
test('restores person and cycle from URL and follows browser history', async ({ page }) => {
  await mockGoalTrackingShell(page);
  await page.goto('/action-items?employeeId=manager-1&cycleId=cycle-2');
  await expect(page.getByRole('button', { name: /林治/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('goal-tracking-cycle')).toContainText('2026 第二季度');
  await page.getByRole('button', { name: /刘伟/ }).click();
  await expect(page).toHaveURL(/employeeId=employee-1/);
  await page.goBack();
  await expect(page.getByRole('button', { name: /林治/ })).toHaveAttribute('aria-pressed', 'true');
});

test('switches cycle and reloads indicators for the selected person', async ({ page }) => {
  await mockGoalTrackingShell(page);
  await page.goto('/action-items?employeeId=manager-1&cycleId=cycle-2');
  const cycleRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/objectives/tracking')
      && url.searchParams.get('ownerId') === 'manager-1'
      && url.searchParams.get('cycleId') === 'cycle-1';
  });
  await page.getByTestId('goal-tracking-cycle').click();
  await page.getByRole('option', { name: '2026 第一季度' }).click();
  await cycleRequest;
  await expect(page).toHaveURL(/employeeId=manager-1.*cycleId=cycle-1/);
});

test('canonicalizes an objective deep link and highlights the resolved row', async ({ page }) => {
  await mockGoalTrackingShell(page, { deepLinkObjectiveId: 'objective-2' });
  await page.goto('/action-items?objectiveId=objective-2');
  await expect(page).toHaveURL(/employeeId=manager-1.*cycleId=cycle-2/);
  await expect(page.getByTestId('goal-tracking-row-objective-2')).toHaveClass(/is-highlighted/);
});

test('falls back safely when an objective deep link is missing or invisible', async ({ page }) => {
  await mockGoalTrackingShell(page, {
    deepLinkObjectiveId: 'objective-missing',
    deepLinkResult: { totalWeight: 0, items: [] },
  });
  await page.goto('/action-items?objectiveId=objective-missing');
  await expect(page.getByText('无法定位该目标所属人员和考核周期')).toBeVisible();
  await expect(page).toHaveURL(/employeeId=employee-1/);
  await expect(page).toHaveURL(/cycleId=cycle-2/);
});

test('normalizes invalid person and cycle query values to safe defaults', async ({ page }) => {
  await mockGoalTrackingShell(page);
  await page.goto('/action-items?employeeId=outsider&cycleId=missing');
  await expect(page).toHaveURL(/employeeId=employee-1/);
  await expect(page).toHaveURL(/cycleId=cycle-2/);
  await expect(page.getByRole('button', { name: /刘伟/ })).toHaveAttribute('aria-pressed', 'true');
});

test('ignores a slow response after the user changes person', async ({ page }) => {
  const requests = await installDelayedTrackingRoutes(page);
  await page.goto('/action-items');
  await requests.selfStarted;
  await page.getByRole('button', { name: /林治/ }).click();
  await requests.managerFulfilled;
  requests.releaseSelf();
  await expect(page.getByTestId('goal-tracking-surface')).toContainText('上级目标');
  await expect(page.getByTestId('goal-tracking-surface')).not.toContainText('本人旧目标');
});
```

Change the existing Playwright import to include `Page`, then add these concrete helpers above the tracking tests in the same spec:

```ts
import { expect, test, type Page } from '@playwright/test';

const trackingUser = {
  id: 'employee-1', name: '刘伟', sysRole: 'employee', deptId: 'dept-1',
  isAssessorOnly: false, canViewAll: false,
  directManagerId: 'manager-1', directManagerName: '林治',
};
const trackingCycles = [
  { id: 'cycle-1', name: '2026 第一季度', type: 'quarterly', startDate: '2026-01-01', endDate: '2026-03-31', status: 'self_eval', publishVisibleFields: {}, gradeAMaxRatio: 0.2, gradeBMaxRatio: 0.4, gradeCMaxRatio: 0.3, gradeDMaxRatio: 0.1 },
  { id: 'cycle-2', name: '2026 第二季度', type: 'quarterly', startDate: '2026-04-01', endDate: '2026-06-30', status: 'manager_score', publishVisibleFields: {}, gradeAMaxRatio: 0.2, gradeBMaxRatio: 0.4, gradeCMaxRatio: 0.3, gradeDMaxRatio: 0.1 },
];
const trackingRows = {
  self: { totalWeight: 50, items: [{ id: 'objective-1', title: '本人目标', ownerId: 'employee-1', ownerName: '刘伟', cycleId: 'cycle-2', cycleName: '2026 第二季度', priority: 1, status: 'active', progress: 20, weight: 50, latestProgress: null }] },
  manager: { totalWeight: 60, items: [{ id: 'objective-2', title: '上级目标', ownerId: 'manager-1', ownerName: '林治', cycleId: 'cycle-2', cycleName: '2026 第二季度', priority: 1, status: 'active', progress: 40, weight: 60, latestProgress: null }] },
};

async function mockGoalTrackingShell(
  page: Page,
  overrides: {
    cycles?: typeof trackingCycles;
    tracking?: typeof trackingRows.self;
    deepLinkObjectiveId?: string;
    deepLinkResult?: typeof trackingRows.self;
  } = {},
) {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(trackingUser)),
  }));
  await page.route('**/api/v1/cycles?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      total: (overrides.cycles ?? trackingCycles).length,
      page: 1,
      pageSize: 100,
      items: overrides.cycles ?? trackingCycles,
    })),
  }));
  await page.route('**/api/v1/objectives/tracking?**', (route) => {
    const url = new URL(route.request().url());
    const objectiveId = url.searchParams.get('objectiveId');
    const ownerId = url.searchParams.get('ownerId');
    const data = objectiveId === overrides.deepLinkObjectiveId
      ? overrides.deepLinkResult ?? trackingRows.manager
      : overrides.tracking ?? (ownerId === 'manager-1' ? trackingRows.manager : trackingRows.self);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(data)),
    });
  });
}

async function installDelayedTrackingRoutes(page: Page) {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(trackingUser)),
  }));
  await page.route('**/api/v1/cycles?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 2, page: 1, pageSize: 100, items: trackingCycles })),
  }));
  let announceSelf!: () => void;
  let releaseSelf!: () => void;
  let announceManager!: () => void;
  const selfStarted = new Promise<void>((resolve) => { announceSelf = resolve; });
  const selfGate = new Promise<void>((resolve) => { releaseSelf = resolve; });
  const managerFulfilled = new Promise<void>((resolve) => { announceManager = resolve; });
  await page.route('**/api/v1/objectives/tracking?**', async (route) => {
    const ownerId = new URL(route.request().url()).searchParams.get('ownerId');
    if (ownerId === 'employee-1') {
      announceSelf();
      await selfGate;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          totalWeight: 50,
          items: [{ ...trackingRows.self.items[0], title: '本人旧目标' }],
        })),
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(trackingRows.manager)),
    });
    announceManager();
  });
  return { selfStarted, managerFulfilled, releaseSelf };
}
```

- [ ] **Step 2: Run the three tests and verify RED**

Run:

```powershell
cd web
npx playwright test e2e/specs/09-performance-workspace.spec.ts --grep "restores person|switches cycle|canonicalizes an objective|falls back safely|normalizes invalid|ignores a slow"
```

Expected: FAIL because query watchers, deep-link resolution, highlighting, and push-history behavior are not implemented.

- [ ] **Step 3: Extend the composable with canonical history and deep links**

Add `highlightedObjectiveId` and use `router.push` for user actions, `router.replace` only for initial normalization:

```ts
const highlightedObjectiveId = ref('');
const notice = ref('');

async function writeQuery(mode: 'push' | 'replace') {
  const navigate = mode === 'push' ? router.push : router.replace;
  await navigate({
    query: {
      employeeId: selectedPersonId.value || undefined,
      cycleId: selectedCycleId.value || undefined,
    },
  });
}

async function resolveObjectiveDeepLink(objectiveId: string) {
  let objective: GoalTrackingItem | undefined;
  try {
    const deepLink = await objectivesApi.getTracking({ objectiveId });
    objective = deepLink.items[0];
  } catch {
    notice.value = '无法定位该目标所属人员和考核周期';
    return false;
  }
  if (
    !objective?.ownerId
    || !objective.cycleId
    || !people.value.some((person) => person.id === objective.ownerId)
    || !cycles.value.some((cycle) => cycle.id === objective.cycleId)
  ) {
    notice.value = '无法定位该目标所属人员和考核周期';
    return false;
  }
  notice.value = '';
  selectedPersonId.value = objective.ownerId;
  selectedCycleId.value = objective.cycleId;
  highlightedObjectiveId.value = objective.id;
  await writeQuery('replace');
  await loadTracking();
  return true;
}
```

In the existing mount sequence, resolve a historical deep link after authentication and cycles load but before normal defaults:

```ts
const objectiveId = typeof route.query.objectiveId === 'string'
  ? route.query.objectiveId
  : '';
if (objectiveId && await resolveObjectiveDeepLink(objectiveId)) return;
```

Watch `route.query.employeeId` and `route.query.cycleId`; when both are legal and differ from current state, assign them directly, load once, and never write the query back from that watcher:

```ts
watch(
  () => [route.query.employeeId, route.query.cycleId] as const,
  async ([employeeId, cycleId]) => {
    if (typeof employeeId !== 'string' || typeof cycleId !== 'string') return;
    if (!people.value.some((person) => person.id === employeeId)) return;
    if (!cycles.value.some((cycle) => cycle.id === cycleId)) return;
    if (employeeId === selectedPersonId.value && cycleId === selectedCycleId.value) return;
    selectedPersonId.value = employeeId;
    selectedCycleId.value = cycleId;
    await loadTracking();
  },
);
```

Keep the existing request serial check around every tracking response. `selectPerson` and `selectCycle` call `writeQuery('push')`; initial defaults and deep-link canonicalization call `writeQuery('replace')`.

Import the `GoalTrackingItem` type, return both `notice` and `highlightedObjectiveId` from the composable, pass them to `GoalTrackingIndicatorPanel`, and render `notice` as a compact warning above the indicator surface. A normal tracking refresh clears `error` but does not erase this deep-link notice. Set `notice.value = ''` and `highlightedObjectiveId.value = ''` inside both `selectPerson` and `selectCycle`, so a valid explicit user selection clears the historical warning/highlight.

- [ ] **Step 4: Highlight deep links and correct the objective-map label**

Pass `highlightedObjectiveId` into `GoalTrackingIndicatorPanel`, render each row with `data-testid="goal-tracking-row-${item.id}"`, and apply `is-highlighted` while the IDs match. In `ObjectiveMapView.vue`, only expose the renamed “目标跟进” link for a target owned by the current user or their direct manager and carrying a cycle:

```ts
function canOpenTracking(row: Objective) {
  return Boolean(
    row.ownerId
    && row.cycleId
    && [auth.user?.id, auth.user?.directManagerId].includes(row.ownerId),
  );
}

function openTracking(row: Objective) {
  router.push({ path: '/action-items', query: { objectiveId: row.id } });
}
```

Bind the button with `v-if="canOpenTracking(scope.row as Objective)"` and `@click="openTracking(scope.row as Objective)"`. Other map rows have no misleading tracking link.

- [ ] **Step 5: Remove obsolete action-item UI acceptance and replace it with deep-link acceptance**

In `07-peripheral-actions.spec.ts`, retain the objective creation UI test and delete the assertions for `action-item-create`, `action-item-dialog`, and `action-item-save`. Replace them with this owned, cycle-bound deep-link journey:

```ts
test('HR can create an owned objective and open its goal-tracking deep link', async ({ page }) => {
  const token = await login(ACCEPTANCE_ACCOUNTS.hr);
  const me = await api('GET', '/auth/me', token);
  const cycles = await api('GET', '/cycles?page=1&pageSize=1', token);
  const objective = await api('POST', '/objectives', token, {
    title: `E2E goal tracking objective ${Date.now()}`,
    level: 'individual',
    ownerId: me.id,
    deptId: me.deptId,
    cycleId: cycles.items[0].id,
    priority: 1,
  });

  await page.goto(`/action-items?objectiveId=${objective.id}`);

  await expect(page.getByTestId('goal-tracking-surface')).toBeVisible();
  await expect(page.getByTestId(`goal-tracking-row-${objective.id}`))
    .toHaveClass(/is-highlighted/);
});
```

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run:

```powershell
cd web
npx playwright test e2e/specs/09-performance-workspace.spec.ts e2e/specs/07-peripheral-actions.spec.ts --grep "restores person|switches cycle|canonicalizes an objective|falls back safely|normalizes invalid|ignores a slow|objective.*deep link"
```

Expected: all selected tests PASS.

- [ ] **Step 7: Commit navigation-state compatibility**

```powershell
git add web/src/views/objectives/use-goal-tracking.ts web/src/views/objectives/GoalTrackingIndicatorPanel.vue web/src/views/objectives/ObjectiveMapView.vue web/e2e/specs/07-peripheral-actions.spec.ts web/e2e/specs/09-performance-workspace.spec.ts
git commit -m "feat(web): preserve goal tracking navigation state"
```

---

### Task 5: Add persisted controls, complete states, and responsive fidelity

**Files:**
- Modify: `web/src/views/objectives/GoalTrackingPeoplePanel.vue`
- Modify: `web/src/views/objectives/GoalTrackingIndicatorPanel.vue`
- Modify: `web/src/views/objectives/GoalTrackingView.vue`
- Modify: `web/src/views/objectives/use-goal-tracking.ts`
- Delete: `web/src/views/objectives/ActionItemsView.vue`
- Modify: `web/e2e/specs/09-performance-workspace.spec.ts`

**Interfaces:**
- Consumes: Task 2's storage parsers and Task 3's panel props.
- Produces: persistent collapse/column controls, separate cycle/indicator loading and retry states, complete empty/error states, and a 390×844 layout without document overflow.

- [ ] **Step 1: Write failing persistence, error, empty, and mobile tests**

Add these behavioral assertions to `09-performance-workspace.spec.ts`:

```ts
test('persists people groups and custom columns across refresh', async ({ page }) => {
  await mockGoalTrackingShell(page);
  await page.goto('/action-items');
  const managerGroup = page.getByTestId('goal-tracking-group-manager');
  await managerGroup.getByRole('button', { name: '收起直接上级' }).click();
  await page.getByRole('button', { name: '自定义列' }).click();
  await expect(page.getByRole('checkbox', { name: '序号' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: '指标名称' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: '最新进展' }).uncheck();
  await page.reload();
  await expect(managerGroup).toHaveAttribute('data-collapsed', 'true');
  await expect(page.getByRole('columnheader', { name: '最新进展' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('kayford.goalTracking.visibleColumns')))
    .not.toContain('latestProgress');
});

test('shows the no-cycle state without requesting indicators', async ({ page }) => {
  let trackingRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/objectives/tracking')) trackingRequests += 1;
  });
  await mockGoalTrackingShell(page, { cycles: [] });
  await page.goto('/action-items');
  await expect(page.getByText('暂无可用考核周期')).toBeVisible();
  expect(trackingRequests).toBe(0);
});

test('shows the no-indicators state for an empty successful response', async ({ page }) => {
  await mockGoalTrackingShell(page, { tracking: { totalWeight: 0, items: [] } });
  await page.goto('/action-items');
  await expect(page.getByText('暂无考核指标')).toBeVisible();
});

test('retries cycle loading after a cycle request fails', async ({ page }) => {
  await mockGoalTrackingShell(page);
  let cycleCalls = 0;
  await page.route('**/api/v1/cycles?**', (route) => {
    cycleCalls += 1;
    return cycleCalls === 1
      ? route.fulfill({ status: 500 })
      : route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(apiResponse({
            total: trackingCycles.length, page: 1, pageSize: 100, items: trackingCycles,
          })),
        });
  });
  await page.goto('/action-items');
  await expect(page.getByText('考核周期加载失败')).toBeVisible();
  await page.getByRole('button', { name: '重新加载周期' }).click();
  await expect(page.getByTestId('goal-tracking-cycle')).toContainText('2026 第二季度');
});

test('retries indicator loading and replaces the failed state', async ({ page }) => {
  await mockGoalTrackingShell(page);
  let trackingCalls = 0;
  await page.route('**/api/v1/objectives/tracking?**', (route) => {
    trackingCalls += 1;
    return trackingCalls === 1
      ? route.fulfill({ status: 500 })
      : route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(apiResponse(trackingRows.self)),
        });
  });
  await page.goto('/action-items');
  await expect(page.getByText('考核指标加载失败')).toBeVisible();
  await page.getByRole('button', { name: '重新加载指标' }).click();
  await expect(page.getByText('本人目标')).toBeVisible();
  await expect(page.getByText('考核指标加载失败')).toHaveCount(0);
});

test('goal tracking remains usable without document overflow at 390x844', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockGoalTrackingShell(page);
  await page.goto('/action-items');
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('goal-tracking-person-search')).toBeVisible();
  await expect(page.getByTestId('goal-tracking-cycle')).toBeVisible();
  await expect(page.getByRole('button', { name: '自定义列' })).toBeVisible();
});
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```powershell
cd web
npx playwright test e2e/specs/09-performance-workspace.spec.ts --grep "persists people|no-cycle|no-indicators|retries cycle|retries indicator|390x844"
```

Expected: FAIL because persisted controls and complete responsive/error states are missing.

- [ ] **Step 3: Implement validated group-collapse persistence**

In `GoalTrackingPeoplePanel.vue`, initialize from `parseCollapsedPeopleGroups`, write immediately after toggles, and expose accurate ARIA:

```ts
const COLLAPSED_KEY = 'kayford.goalTracking.collapsedPeopleGroups';
const collapsed = ref(parseCollapsedPeopleGroups(localStorage.getItem(COLLAPSED_KEY)));

function toggleGroup(key: 'self' | 'manager') {
  collapsed.value = { ...collapsed.value, [key]: !collapsed.value[key] };
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed.value));
}
```

Each group root uses `data-testid="goal-tracking-group-${group.key}"` and `:data-collapsed="String(Boolean(collapsed[group.key]))"`; the toggle uses `:aria-expanded="!collapsed[group.key]"` and an action-specific label.

- [ ] **Step 4: Implement validated custom columns**

In `GoalTrackingIndicatorPanel.vue`:

```ts
const VISIBLE_COLUMNS_KEY = 'kayford.goalTracking.visibleColumns';
const visibleColumns = ref(parseVisibleColumns(localStorage.getItem(VISIBLE_COLUMNS_KEY)));

function setColumn(column: GoalTrackingColumn, visible: boolean) {
  visibleColumns.value = visible
    ? [...new Set([...visibleColumns.value, column])]
    : visibleColumns.value.filter((candidate) => candidate !== column);
  localStorage.setItem(VISIBLE_COLUMNS_KEY, JSON.stringify(visibleColumns.value));
}
```

Use an `el-popover` triggered by a button named “自定义列”. Render checkboxes for “最新进展、状态、进度、权重”; keep sequence and indicator name outside this optional list.

- [ ] **Step 5: Complete loading, empty, error, and reference-density styles**

In `use-goal-tracking.ts`, separate cycle state from indicator state and clear old indicator rows before each new request:

```ts
const cyclesLoading = ref(false);
const cyclesError = ref('');

async function loadCycles() {
  cyclesLoading.value = true;
  cyclesError.value = '';
  try {
    const page = await cyclesApi.findAll({ page: 1, pageSize: 100 });
    cycles.value = page.items;
  } catch {
    cycles.value = [];
    cyclesError.value = '考核周期加载失败';
  } finally {
    cyclesLoading.value = false;
  }
}

async function normalizeSelectionAndLoad() {
  const objectiveId = typeof route.query.objectiveId === 'string'
    ? route.query.objectiveId
    : '';
  if (objectiveId && await resolveObjectiveDeepLink(objectiveId)) return;

  const defaultCycle = selectDefaultTrackingCycle(cycles.value);
  selectedPersonId.value = typeof route.query.employeeId === 'string'
    && people.value.some((person) => person.id === route.query.employeeId)
    ? route.query.employeeId
    : auth.user?.id ?? '';
  selectedCycleId.value = typeof route.query.cycleId === 'string'
    && cycles.value.some((cycle) => cycle.id === route.query.cycleId)
    ? route.query.cycleId
    : defaultCycle?.id ?? '';
  await writeQuery('replace');
  await loadTracking();
}

async function retryCycles() {
  await loadCycles();
  if (cyclesError.value) return;
  await normalizeSelectionAndLoad();
}

// At the start of loadTracking(), after validating both selected IDs:
result.value = { totalWeight: 0, items: [] };
```

Refactor the mount sequence to call `loadCycles()` after authentication. If `cyclesError` is set, stop before URL normalization or indicator loading; otherwise call `normalizeSelectionAndLoad()`. Return `cyclesLoading`, `cyclesError`, and `retryCycles`, pass them to `GoalTrackingIndicatorPanel`, and expose separate buttons named `重新加载周期` and `重新加载指标`.

Use `el-skeleton` while cycles or indicators are loading. Render distinct blocks for `cyclesError`, `cycles.length === 0`, indicator `error`, and `!loading && result.items.length === 0`. Apply these desktop values:

```css
.goal-tracking-view { min-height: 100%; padding: 16px 22px; background: #f4f6fb; }
.goal-person-summary { min-height: 58px; display: flex; align-items: center; gap: 10px; }
.goal-indicator-surface { background: #fff; border-radius: 14px; overflow: hidden; }
.goal-indicator-header { min-height: 54px; padding: 0 18px; }
.goal-indicator-row { min-height: 64px; padding: 12px 18px; border-top: 1px solid #eef1f5; }
.goal-indicator-index { width: 24px; height: 24px; border-radius: 7px; background: #eaf4ff; color: #3f8cff; }
.goal-indicator-row.is-highlighted { background: #f0f7ff; }
.goal-person-avatar { width: 40px; height: 40px; border-radius: 10px; background: #13afc0; color: #fff; }
.goal-person-item { min-height: 42px; padding: 6px 10px; border-radius: 8px; color: #32405d; }
.goal-person-item:hover { background: #f2f7fc; }
.goal-person-item.is-active { color: #2f77dc; background: #dceeff; }
```

At `max-width: 768px`, use these concrete overrides in the owning scoped components:

```css
@media (max-width: 768px) {
  .goal-tracking-view { min-height: auto; padding: 10px; }
  .goal-people-list { display: flex; gap: 8px; overflow-x: auto; }
  .goal-person-item { width: 190px; min-width: 190px; }
  .goal-indicator-table-head { display: none; }
  .goal-indicator-row {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    row-gap: 8px;
    column-gap: 10px;
    padding: 14px;
  }
  .goal-indicator-cell::before {
    content: attr(data-label);
    color: #8a94a6;
    font-size: 12px;
  }
}
```

The existing `PerformanceWorkspace` mobile rule already moves context above content. Do not add a fixed pixel width wider than the viewport.

- [ ] **Step 6: Remove the dead action-item page and verify unchanged global-navigation contracts**

Confirm the old page has no remaining route or import references:

```powershell
rg -n "ActionItemsView" web
```

Expected: only `web/src/views/objectives/ActionItemsView.vue` itself is returned. Delete that file, then run the existing `02-role-menu-visibility.spec.ts` and `11-navigation-entrypoints.spec.ts` unchanged: the global sidebar must still omit “目标跟进”, while `/action-items` remains classified as a performance workspace.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```powershell
cd web
npm run test:contracts
npx playwright test e2e/specs/02-role-menu-visibility.spec.ts e2e/specs/09-performance-workspace.spec.ts e2e/specs/11-navigation-entrypoints.spec.ts --grep "goal tracking|目标跟进|persists people|no-cycle|no-indicators|retries cycle|retries indicator|390x844"
```

Expected: all selected tests PASS; the mobile overflow assertion is at most 1 pixel.

- [ ] **Step 8: Commit the completed UI states**

```powershell
git add web/src/views/objectives/GoalTrackingPeoplePanel.vue web/src/views/objectives/GoalTrackingIndicatorPanel.vue web/src/views/objectives/GoalTrackingView.vue web/src/views/objectives/use-goal-tracking.ts web/e2e/specs/09-performance-workspace.spec.ts
git add -u web/src/views/objectives/ActionItemsView.vue
git commit -m "feat(web): complete reference goal tracking interactions"
```

---

### Task 6: Run full verification and capture real-role visual evidence

**Files:**
- Create: `docs/acceptance/2026-08-15-goal-tracking.md`
- Create: `docs/acceptance/2026-08-15-goal-tracking/employee-desktop.png`
- Create: `docs/acceptance/2026-08-15-goal-tracking/manager-desktop.png`
- Create: `docs/acceptance/2026-08-15-goal-tracking/employee-mobile.png`

**Interfaces:**
- Consumes: Tasks 1-5 and the existing realistic E2E employee/manager accounts.
- Produces: fresh command output and browser evidence required for a completion claim.

- [ ] **Step 1: Run the complete API goal-tracking read-model test slice**

```powershell
cd api
npm test -- action-item-visibility.spec.ts objectives.service.spec.ts objectives.controller.spec.ts --runInBand
```

Expected: all three suites PASS with zero failures.

- [ ] **Step 2: Run frontend contract, type, and production-build gates**

```powershell
cd web
npm run test:contracts
npm run type-check
npm run build
```

Expected: every command exits 0; contract output has zero failed tests; Vue TypeScript and Vite report success.

- [ ] **Step 3: Run the complete affected Playwright suites**

```powershell
cd web
npx playwright test e2e/specs/02-role-menu-visibility.spec.ts e2e/specs/06-role-page-smoke.spec.ts e2e/specs/07-peripheral-actions.spec.ts e2e/specs/09-performance-workspace.spec.ts e2e/specs/11-navigation-entrypoints.spec.ts
```

Expected: all tests PASS with zero failures. Inspect output for console/page errors even when assertions pass.

- [ ] **Step 4: Perform employee desktop acceptance in the browser**

Using the employee role at a 1440×900 viewport:

1. Reopen the supplied target reference `C:\Users\lwei\AppData\Local\Temp\codex-clipboard-a421027d-4592-406b-8de0-706994a03d5a.png`. If it is no longer available, obtain the same reference again before claiming visual fidelity.
2. Open `/action-items` and verify the title, three internal columns, “我/直接上级”, selected-person blue state, period selector, white indicator card, columns, total weight, and lack of “创建群聊”. Compare navigation/people widths, gray-blue background, card radius, row height, typography, spacing, and selected state against the reference while preserving the confirmed HRM global shell.
3. Switch to the direct manager and a different period.
4. Search both visible people, collapse/expand both groups, hide and restore a custom column.
5. Refresh and confirm group/column persistence.
6. Use Back and Forward and confirm selected person/period restore from the URL.
7. Confirm the browser console has zero errors.
8. Capture `docs/acceptance/2026-08-15-goal-tracking/employee-desktop.png`.

- [ ] **Step 5: Perform manager desktop and employee mobile acceptance**

Using the manager role at 1440×900, repeat person/period selection and confirm target map remains available in local navigation; capture `manager-desktop.png`. Then use the employee role at 390×844, confirm no document-level horizontal overflow and all search/person/period/custom-column controls remain usable; capture `employee-mobile.png`.

- [ ] **Step 6: Write the acceptance record**

Create `docs/acceptance/2026-08-15-goal-tracking.md` with:

```markdown
# 目标跟进参考图改造验收记录

## 自动化结果

- API objectives tests: PASS
- Frontend contract tests: PASS
- Frontend type-check: PASS
- Frontend production build: PASS
- Affected Playwright suites: PASS

## 真实角色检查

- 普通员工：本人/直属上级、周期、搜索、折叠、自定义列、刷新、前进/后退均通过。
- 主管：本人/直属上级、周期及目标地图本地入口均通过。
- 权限：员工无目标地图入口；直属上级选择未扩大既有目标数据范围。
- 浏览器控制台：桌面与窄屏均无错误。

## 截图

- [员工桌面](./2026-08-15-goal-tracking/employee-desktop.png)
- [主管桌面](./2026-08-15-goal-tracking/manager-desktop.png)
- [员工窄屏](./2026-08-15-goal-tracking/employee-mobile.png)
```

Only write `PASS` for commands and browser checks that were freshly observed. Replace a failed line with the exact blocker instead of preserving the template claim.

- [ ] **Step 7: Commit the acceptance evidence**

```powershell
git add docs/acceptance/2026-08-15-goal-tracking.md docs/acceptance/2026-08-15-goal-tracking/employee-desktop.png docs/acceptance/2026-08-15-goal-tracking/manager-desktop.png docs/acceptance/2026-08-15-goal-tracking/employee-mobile.png
git commit -m "test: record goal tracking visual acceptance"
```

---

## Completion Gate

Before reporting completion, re-read `docs/superpowers/specs/2026-08-15-goal-tracking-reference-redesign-design.md` and verify every confirmed requirement against Tasks 1-6. Report any missing browser role, failed command, absent screenshot, console error, or permission mismatch as an explicit remaining blocker; do not substitute build success for visual acceptance.
