import { expect, test } from '@playwright/test';
import type { Router } from 'vue-router';
import { createTasksApi, type TasksApiClient } from '../../src/api/tasks.api';
import type {
  BatchReviewResult,
  IndicatorInstance,
  IndicatorReferenceItem,
  Paginated,
  TeamTaskPage,
} from '../../src/types/api.types';
import {
  parseTaskWorkspaceQuery,
  updateTaskWorkspaceQuery,
} from '../../src/views/task/use-task-workspace-query';

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

const teamPageFixture: TeamTaskPage = {
  total: 3,
  page: 1,
  pageSize: 20,
  items: [
    {
      id: 'task-1',
      cycleId: 'cycle-1',
      cycleName: '2026 H1',
      employeeId: 'employee-1',
      employeeName: 'Ada Chen',
      deptId: 'dept-1',
      deptName: 'Engineering',
      managerId: 'manager-1',
      status: 'indicator_reviewing',
      totalScore: null,
      rawGrade: null,
      updatedAt: '2026-08-09T00:00:00.000Z',
      employeeNo: 'E001',
      avatarUrl: null,
      position: 'Senior Engineer',
      stageState: 'pending',
    },
    {
      id: 'task-2',
      cycleId: 'cycle-1',
      cycleName: '2026 H1',
      employeeId: 'employee-2',
      employeeName: 'Grace Lin',
      deptId: 'dept-1',
      deptName: 'Engineering',
      managerId: 'manager-1',
      status: 'indicator_reviewing',
      totalScore: null,
      rawGrade: null,
      updatedAt: '2026-08-08T00:00:00.000Z',
      employeeNo: 'E002',
      avatarUrl: null,
      position: 'Product Manager',
      stageState: 'pending',
    },
    {
      id: 'task-3',
      cycleId: 'cycle-1',
      cycleName: '2026 H1',
      employeeId: 'employee-3',
      employeeName: 'Lin Wei',
      deptId: 'dept-2',
      deptName: 'Operations',
      managerId: 'manager-1',
      status: 'indicator_confirming',
      totalScore: null,
      rawGrade: null,
      updatedAt: '2026-08-07T00:00:00.000Z',
      employeeNo: 'E003',
      avatarUrl: null,
      position: 'Operations Lead',
      stageState: 'completed',
    },
  ],
  counts: { all: 3, notStarted: 0, pending: 2, completed: 1, exempted: 0 },
  facets: {
    departments: [
      { id: 'dept-1', name: 'Engineering' },
      { id: 'dept-2', name: 'Operations' },
    ],
    employees: [
      { id: 'employee-1', name: 'Ada Chen', employeeNo: 'E001', deptId: 'dept-1' },
      { id: 'employee-2', name: 'Grace Lin', employeeNo: 'E002', deptId: 'dept-1' },
      { id: 'employee-3', name: 'Lin Wei', employeeNo: 'E003', deptId: 'dept-2' },
    ],
  },
};

async function mockTaskWorkspaceIdentity(page: import('@playwright/test').Page, sysRole: 'manager' | 'employee') {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: `${sysRole}-1`,
      name: sysRole === 'manager' ? 'Test Manager' : 'Test Employee',
      deptId: 'dept-1',
      deptName: 'Engineering',
      sysRole,
      isAssessorOnly: false,
      canViewAll: false,
    })),
  }));
  await page.route('**/api/v1/cycles**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 50, items: [] })),
  }));
  await page.route('**/api/v1/tasks/mine**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 100, items: [] })),
  }));
}

test.describe('team list manager workspace', () => {
  test.use({
    baseURL: 'http://localhost:5173',
    storageState: 'e2e/auth-state/manager.json',
  });

  test('team list exposes filters, counts, and selected member URL state', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    await page.route('**/api/v1/tasks/team**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(teamPageFixture)),
    }));

    await page.goto('/tasks?scope=team&stage=goal-review&cycleId=cycle-1');

    await expect(page.getByTestId('task-scope-team')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('team-count-pending')).toContainText('2');
    await expect(page.getByTestId('team-department-filter')).toBeVisible();
    await expect(page.getByTestId('team-employee-filter')).toBeVisible();
    await page.getByTestId('team-task-row-task-1').click();
    await expect(page).toHaveURL(/taskId=task-1/);
    await expect(page.getByTestId('team-member-rail')).toContainText('Ada Chen');
  });

  test('team list applies URL filters and limits batch commands to pending goal reviews', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    const teamRequests: URL[] = [];
    await page.route('**/api/v1/tasks/team**', (route) => {
      teamRequests.push(new URL(route.request().url()));
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageFixture)),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&cycleId=cycle-1');
    await page.getByTestId('team-count-pending').click();

    await expect(page).toHaveURL(/stageState=pending/);
    await expect(page.getByTestId('team-batch-approve')).toBeDisabled();
    await expect(page.getByTestId('team-batch-reject')).toBeDisabled();

    const adaRow = page.getByRole('row').filter({ hasText: 'Ada Chen' });
    await adaRow.locator('.el-checkbox').click();
    await expect(page.getByTestId('team-batch-approve')).toBeEnabled();
    await expect(page.getByTestId('team-batch-reject')).toBeEnabled();

    await page.getByTestId('team-keyword-filter').fill('Ada');
    await page.getByTestId('team-keyword-filter').press('Enter');
    await expect(page).toHaveURL(/keyword=Ada/);
    await expect
      .poll(() => teamRequests[teamRequests.length - 1]?.searchParams.get('keyword'))
      .toBe('Ada');

    await page.locator('.team-stage-tabs').getByRole('button', { name: '主管评分' }).click();
    await expect(page).toHaveURL(/stage=manager-eval/);
    await expect(page.getByTestId('team-batch-approve')).toHaveCount(0);
    await expect
      .poll(() => teamRequests[teamRequests.length - 1]?.searchParams.get('stage'))
      .toBe('manager-eval');
  });

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    test(`team list has no document overflow at ${viewport.name} width`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockTaskWorkspaceIdentity(page, 'manager');
      await page.route('**/api/v1/tasks/team**', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageFixture)),
      }));

      await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending');
      await expect(page.getByTestId('team-task-list')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(8);

      await page.getByTestId('team-task-row-task-1').click();
      await expect(page.getByTestId('team-member-rail')).toBeVisible();
      if (viewport.name === 'mobile') {
        await expect(page.getByTestId('team-task-list')).toBeHidden();
      } else {
        await expect(page.getByTestId('team-task-list')).toBeVisible();
      }
    });
  }
});

test.describe('team list employee visibility', () => {
  test.use({
    baseURL: 'http://localhost:5173',
    storageState: 'e2e/auth-state/employee.json',
  });

  test('employee storage state does not expose team scope', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'employee');
    await page.goto('/tasks?scope=team&stage=goal-review');

    await expect(page.getByTestId('task-scope-team')).toHaveCount(0);
    await expect(page.getByTestId('task-surface')).toBeVisible();
  });
});

test('normalizes team workspace query', () => {
  expect(
    parseTaskWorkspaceQuery({
      scope: 'team',
      stage: 'manager-eval',
      cycleId: 'cycle-1',
      taskId: 'task-1',
    }),
  ).toEqual(
    expect.objectContaining({
      scope: 'team',
      stage: 'manager-eval',
      cycleId: 'cycle-1',
      taskId: 'task-1',
    }),
  );
});

test('validates stage state and drops unknown query keys', () => {
  expect(
    parseTaskWorkspaceQuery({
      scope: 'bad',
      stage: 'bad',
      stageState: 'not-a-stage-state',
      unknown: 'discard-me',
    }),
  ).toEqual(
    expect.objectContaining({
      scope: 'mine',
      stage: 'goal-review',
      stageState: undefined,
    }),
  );
});

test('serializes a patched workspace query in stable order, removes unknown keys, and resets page for filters', async () => {
  let replacement: unknown;
  const replace = async (location: unknown) => {
    replacement = location;
  };
  const router = { replace } as unknown as Router;

  await updateTaskWorkspaceQuery(
    router,
    {
      keyword: 'Ada',
      taskId: 'task-1',
      page: '3',
      stage: 'manager-eval',
      scope: 'team',
      ignored: 'value',
    },
    { keyword: '', cycleId: 'cycle-1' },
  );

  const query = (replacement as { query: Record<string, string> }).query;
  expect(query).toEqual({
    scope: 'team',
    stage: 'manager-eval',
    cycleId: 'cycle-1',
    taskId: 'task-1',
  });
  expect(Object.keys(query)).toEqual(['scope', 'stage', 'cycleId', 'taskId']);
});

test('does not replace the route when its canonical query is unchanged', async () => {
  let calls = 0;
  const router = {
    replace: async () => {
      calls += 1;
    },
  } as unknown as Router;

  await updateTaskWorkspaceQuery(
    router,
    {
      scope: 'team',
      stage: 'manager-eval',
      cycleId: 'cycle-1',
      taskId: 'task-1',
      stageState: 'pending',
      keyword: 'Ada',
      page: '2',
    },
    {},
  );

  expect(calls).toBe(0);
});

test('preserves a valid page for task selection while resetting it for filters', async () => {
  let replacement: unknown;
  const router = {
    replace: async (location: unknown) => {
      replacement = location;
    },
  } as unknown as Router;

  await updateTaskWorkspaceQuery(
    router,
    { scope: 'team', stage: 'manager-eval', page: '2' },
    { taskId: 'task-1' },
  );

  expect(replacement).toEqual({
    query: {
      scope: 'team',
      stage: 'manager-eval',
      taskId: 'task-1',
      page: '2',
    },
  });
});

test('uses the six team workspace API contracts without a server or login', async () => {
  const teamPage: TeamTaskPage = {
    total: 1,
    page: 1,
    pageSize: 20,
    items: [
      {
        id: 'task-1',
        cycleId: 'cycle-1',
        cycleName: '2026 H1',
        employeeId: 'employee-1',
        employeeName: 'Ada',
        deptId: null,
        deptName: null,
        managerId: 'manager-1',
        status: 'self_eval',
        totalScore: null,
        rawGrade: null,
        updatedAt: '2026-08-09T00:00:00.000Z',
        employeeNo: null,
        avatarUrl: null,
        position: null,
        stageState: 'pending',
      },
    ],
    counts: { all: 1, notStarted: 0, pending: 1, completed: 0, exempted: 0 },
    facets: {
      departments: [{ id: 'dept-1', name: 'Engineering' }],
      employees: [{ id: 'employee-1', name: 'Ada', employeeNo: null, deptId: null }],
    },
  };
  const referencePage: Paginated<IndicatorReferenceItem> = {
    total: 1,
    page: 1,
    pageSize: 20,
    items: [
      {
        id: 'indicator-1',
        taskId: 'task-1',
        cycleId: 'cycle-1',
        employeeId: 'employee-1',
        employeeName: 'Ada',
        name: 'Delivery',
        weight: 100,
        visibilityScope: 'supervisors',
      },
    ],
  };
  const approvalResult: BatchReviewResult = {
    succeeded: [{ taskId: 'task-1', status: 'indicator_confirming' }],
    failed: [],
  };
  const rejectionResult: BatchReviewResult = {
    succeeded: [{ taskId: 'task-1', status: 'indicator_drafting' }],
    failed: [],
  };
  const alignedObjective: Pick<IndicatorInstance, 'alignedObjectives'> = {
    alignedObjectives: [{ id: 'objective-1', title: 'Ship', level: 'company', ownerId: null }],
  };
  const calls: Array<{ method: string; url: string; body?: unknown; params?: unknown }> = [];
  const responses: unknown[] = [
    teamPage,
    referencePage,
    approvalResult,
    rejectionResult,
    { id: 'task-1', status: 'manager_scoring' },
    { id: 'task-1', status: 'manager_scoring' },
  ];
  const client: TasksApiClient = {
    get: async (url, config) => {
      calls.push({ method: 'GET', url, params: config?.params });
      return responses.shift();
    },
    post: async (url, body) => {
      calls.push({ method: 'POST', url, body });
      return responses.shift();
    },
    put: async (url, body) => {
      calls.push({ method: 'PUT', url, body });
      return responses.shift();
    },
    patch: async (url, body) => {
      throw new Error(`Unexpected PATCH ${url}: ${String(body)}`);
    },
    delete: async (url) => {
      throw new Error(`Unexpected DELETE ${url}`);
    },
  };
  const api = createTasksApi(client);

  const team = await api.findTeam({ stage: 'manager-eval', stageState: 'pending' });
  const references = await api.findReferenceIndicators({ cycleId: 'cycle-1' });
  const approved = await api.batchApproveIndicators({
    tasks: [{ taskId: 'task-1', updatedAt: '2026-08-09T00:00:00.000Z' }],
  });
  const rejected = await api.batchRejectIndicators({
    tasks: [{ taskId: 'task-1', updatedAt: '2026-08-09T00:00:00.000Z' }],
    reason: 'Needs evidence',
  });
  const draft = await api.saveManagerEvaluationDraft('task-1', {
    expectedUpdatedAt: '2026-08-09T00:00:00.000Z',
    indicators: [{ id: 'indicator-1', managerScore: 95, managerComment: 'Strong delivery' }],
    evalSummary: { strengths: 'Execution' },
  });
  const withdrawn = await api.withdrawManagerScore('task-1', {
    expectedUpdatedAt: '2026-08-09T00:00:01.000Z',
  });

  expect(team.items[0].employeeNo).toBeNull();
  expect(team.items[0].deptId).toBeNull();
  expect(references.items[0].visibilityScope).toBe('supervisors');
  expect(approved.succeeded[0].status).toBe('indicator_confirming');
  expect(rejected.succeeded[0].status).toBe('indicator_drafting');
  expect(draft).toEqual({ id: 'task-1', status: 'manager_scoring' });
  expect(withdrawn).toEqual({ id: 'task-1', status: 'manager_scoring' });
  expect(alignedObjective.alignedObjectives[0].ownerId).toBeNull();
  expect(calls).toEqual([
    { method: 'GET', url: '/tasks/team', params: { stage: 'manager-eval', stageState: 'pending' } },
    { method: 'GET', url: '/tasks/reference-indicators', params: { cycleId: 'cycle-1' } },
    { method: 'POST', url: '/tasks/team/indicator-review/batch-approve', body: { tasks: [{ taskId: 'task-1', updatedAt: '2026-08-09T00:00:00.000Z' }] } },
    { method: 'POST', url: '/tasks/team/indicator-review/batch-reject', body: { tasks: [{ taskId: 'task-1', updatedAt: '2026-08-09T00:00:00.000Z' }], reason: 'Needs evidence' } },
    { method: 'PUT', url: '/tasks/task-1/manager-evaluation-draft', body: { expectedUpdatedAt: '2026-08-09T00:00:00.000Z', indicators: [{ id: 'indicator-1', managerScore: 95, managerComment: 'Strong delivery' }], evalSummary: { strengths: 'Execution' } } },
    { method: 'POST', url: '/tasks/task-1/manager-score/withdraw', body: { expectedUpdatedAt: '2026-08-09T00:00:01.000Z' } },
  ]);
});
