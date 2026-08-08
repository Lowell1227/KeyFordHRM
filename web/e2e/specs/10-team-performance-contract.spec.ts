import { expect, test } from '@playwright/test';
import type { Router } from 'vue-router';
import { createTasksApi, type TasksApiClient } from '../../src/api/tasks.api';
import type {
  BatchReviewResult,
  IndicatorInstance,
  IndicatorReferenceItem,
  Paginated,
  TaskDetail,
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

const shouldCaptureTask7Evidence = () => (
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.TASK7_CAPTURE_EVIDENCE === '1'
);

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

const offPageTaskFixture: TaskDetail = {
  id: 'task-off-page',
  cycleId: 'cycle-1',
  cycleName: '2026 H1',
  snapshotId: 'snapshot-1',
  employeeId: 'employee-off-page',
  employeeName: 'Off Page Member',
  deptId: 'dept-2',
  deptName: 'Operations',
  managerId: 'manager-1',
  status: 'indicator_reviewing',
  isExempt: false,
  updatedAt: '2026-08-06T00:00:00.000Z',
  indicatorInstances: [],
};

function teamPageWith(
  items: TeamTaskPage['items'],
  options: { page?: number; total?: number } = {},
): TeamTaskPage {
  return {
    ...teamPageFixture,
    page: options.page ?? 1,
    total: options.total ?? items.length,
    items,
    counts: {
      all: options.total ?? items.length,
      notStarted: 0,
      pending: options.total ?? items.length,
      completed: 0,
      exempted: 0,
    },
  };
}

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
    body: JSON.stringify(apiResponse({
      total: 1,
      page: 1,
      pageSize: 50,
      items: [{
        id: 'cycle-1',
        name: '2026 H1',
        type: 'semi_annual',
        status: 'in_progress',
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      }],
    })),
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

  test('selection is page-local and clears on search, department, employee, cycle, and page changes', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    const requests: URL[] = [];
    await page.route('**/api/v1/tasks/team**', (route) => {
      const url = new URL(route.request().url());
      requests.push(url);
      const pageNumber = Number(url.searchParams.get('page') || 1);
      const items = pageNumber === 2 ? [teamPageFixture.items[2]] : teamPageFixture.items.slice(0, 2);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageWith(items, { page: pageNumber, total: 21 }))),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending');

    await expect(page.getByRole('combobox', { name: '考核周期' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '部门' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '员工' })).toBeVisible();
    await expect(page.getByLabel('搜索姓名或工号')).toBeVisible();

    const selectAda = async () => {
      await page.getByRole('row').filter({ hasText: 'Ada Chen' }).locator('.el-checkbox').click();
      await expect(page.getByTestId('team-selected-count')).toContainText('1');
    };

    await selectAda();
    await page.getByRole('button', { name: '主管评分', exact: true }).click();
    await expect(page).toHaveURL(/stage=manager-eval/);
    await expect(page.getByTestId('team-batch-approve')).toHaveCount(0);
    await page.getByRole('button', { name: '指标审核', exact: true }).click();
    await page.getByTestId('team-count-pending').click();
    await expect(page.getByTestId('team-batch-approve')).toBeDisabled();

    await selectAda();
    await page.getByLabel('搜索姓名或工号').fill('Ada');
    await page.getByLabel('搜索姓名或工号').press('Enter');
    await expect(page.getByTestId('team-batch-approve')).toBeDisabled();

    await page.getByRole('combobox', { name: '部门' }).click();
    await page.getByRole('option', { name: 'Engineering', exact: true }).click();
    await expect(page).toHaveURL(/deptId=dept-1/);
    await expect(page.getByTestId('team-batch-approve')).toBeDisabled();

    await page.getByRole('combobox', { name: '员工' }).click();
    await page.getByRole('option', { name: /Ada Chen/ }).click();
    await expect(page).toHaveURL(/employeeId=employee-1/);

    await page.getByTestId('team-cycle-filter').click();
    await page.getByRole('option', { name: '2026 H1', exact: true }).click();
    await expect(page).toHaveURL(/cycleId=cycle-1/);
    await selectAda();
    await page.getByTestId('team-count-completed').click();
    await expect(page.getByTestId('team-batch-approve')).toHaveCount(0);
    await page.getByTestId('team-count-pending').click();
    await expect(page.getByTestId('team-batch-approve')).toBeDisabled();

    await page.getByTestId('team-keyword-filter').fill('');
    await page.getByTestId('team-keyword-filter').press('Enter');
    await page.getByTestId('team-department-filter').click();
    await page.getByRole('option', { name: '全部部门', exact: true }).click();
    await page.getByTestId('team-employee-filter').click();
    await page.getByRole('option', { name: '全部员工', exact: true }).click();
    await selectAda();
    await page.locator('.team-task-list__footer .btn-next').click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByTestId('team-task-row-task-3')).toBeVisible();
    await expect(page.getByTestId('team-batch-approve')).toBeDisabled();
    await expect.poll(() => requests[requests.length - 1]?.searchParams.get('page')).toBe('2');
  });

  test('partial batch result clears succeeded rows and preserves visible failed rows', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    let afterBatch = false;
    let batchAttempt = 0;
    await page.route('**/api/v1/tasks/team/indicator-review/batch-approve', (route) => {
      batchAttempt += 1;
      afterBatch = true;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(batchAttempt === 1 ? {
          succeeded: [{ taskId: 'task-1', status: 'indicator_confirming' }],
          failed: [{ taskId: 'task-2', reason: '任务已被其他操作更新' }],
        } : {
          succeeded: [{ taskId: 'task-2', status: 'indicator_confirming' }],
          failed: [],
        })),
      });
    });
    await page.route('**/api/v1/tasks/team**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageWith(
          afterBatch ? [teamPageFixture.items[1]] : teamPageFixture.items.slice(0, 2),
        ))),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending');
    await page.getByRole('row').filter({ hasText: 'Ada Chen' }).locator('.el-checkbox').click();
    await page.getByRole('row').filter({ hasText: 'Grace Lin' }).locator('.el-checkbox').click();
    await page.getByTestId('team-batch-approve').click();
    await page.getByRole('button', { name: '通过', exact: true }).click();

    const result = page.getByTestId('team-batch-result');
    await expect(result.getByTestId('team-batch-succeeded')).toContainText('Ada Chen');
    await expect(result.getByTestId('team-batch-failed')).toContainText('Grace Lin');
    await expect(result.getByTestId('team-batch-failed')).toContainText('任务已被其他操作更新');
    await expect(page.getByTestId('team-selected-count')).toContainText('1');
    await expect(page.getByRole('row').filter({ hasText: 'Grace Lin' }).locator('.el-checkbox')).toBeChecked();

    await page.getByTestId('team-batch-approve').click();
    await page.getByRole('button', { name: '通过', exact: true }).click();
    await expect(page.getByTestId('team-batch-result')).toContainText('成功 1 项');
    await expect(page.getByTestId('team-batch-approve')).toBeDisabled();
  });

  test('total and HTTP batch failures remain selected and never report zero success', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    let batchAttempt = 0;
    await page.route('**/api/v1/tasks/team/indicator-review/batch-approve', (route) => {
      batchAttempt += 1;
      if (batchAttempt === 1) {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(apiResponse({
            succeeded: [],
            failed: [{ taskId: 'task-1', reason: '版本冲突' }],
          })),
        });
      }
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 503, message: '审核服务不可用', data: null, timestamp: Date.now() }),
      });
    });
    await page.route('**/api/v1/tasks/team**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageWith([teamPageFixture.items[0]]))),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending');
    await page.getByRole('row').filter({ hasText: 'Ada Chen' }).locator('.el-checkbox').click();
    await page.getByTestId('team-batch-approve').click();
    await page.getByRole('button', { name: '通过', exact: true }).click();
    await expect(page.getByTestId('team-batch-result')).toContainText('版本冲突');
    await expect(page.getByTestId('team-selected-count')).toContainText('1');
    await expect(page.locator('.el-message--success')).toHaveCount(0);
    await expect(page.locator('.el-message--error')).toBeVisible();

    await page.getByTestId('team-batch-approve').click();
    await page.getByRole('button', { name: '通过', exact: true }).click();
    await expect(page.getByTestId('team-batch-result')).toContainText('审核服务不可用');
    await expect(page.getByTestId('team-selected-count')).toContainText('1');
    await expect(page.locator('.el-message--success')).toHaveCount(0);
  });

  test('latest team request wins when an older response finishes last', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    let releaseFirst: (() => void) | undefined;
    const firstRequest = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    await page.route('**/api/v1/tasks/team**', async (route) => {
      const url = new URL(route.request().url());
      if (!url.searchParams.get('keyword')) {
        await firstRequest;
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(apiResponse(teamPageWith([teamPageFixture.items[0]]))),
        });
      }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageWith([teamPageFixture.items[1]]))),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending');
    await page.getByTestId('team-keyword-filter').fill('Grace');
    await page.getByTestId('team-keyword-filter').press('Enter');
    await expect(page.getByTestId('team-task-row-task-2')).toBeVisible();
    releaseFirst?.();
    await page.waitForTimeout(100);
    await expect(page.getByTestId('team-task-row-task-2')).toBeVisible();
    await expect(page.getByTestId('team-task-row-task-1')).toHaveCount(0);
  });

  test('deep-link refresh safely hydrates a selected task outside the current page', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    await page.route('**/api/v1/tasks/task-off-page', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(offPageTaskFixture)),
    }));
    await page.route('**/api/v1/tasks/team**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(teamPageWith([teamPageFixture.items[0]], { total: 21 }))),
    }));

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-off-page&page=2');
    await expect(page.getByTestId('team-member-rail')).toContainText('Off Page Member');
    await page.reload();
    await expect(page.getByTestId('team-member-rail')).toContainText('Off Page Member');
    await expect(page).toHaveURL(/taskId=task-off-page/);
  });

  test('returned page is canonicalized and error state excludes empty state', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    let shouldFail = false;
    await page.route('**/api/v1/tasks/team**', (route) => {
      if (shouldFail) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ code: 500, message: '团队任务不可用', data: null, timestamp: Date.now() }),
        });
      }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageWith([teamPageFixture.items[2]], { page: 2, total: 21 }))),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&page=99');
    await expect(page).toHaveURL(/page=2/);
    shouldFail = true;
    await page.getByTestId('team-keyword-filter').fill('failure');
    await page.getByTestId('team-keyword-filter').press('Enter');
    await expect(page.getByText('团队任务加载失败')).toBeVisible();
    await expect(page.getByTestId('team-task-empty')).toHaveCount(0);
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
      if (shouldCaptureTask7Evidence()) {
        await page.screenshot({
          path: `../.superpowers/sdd/2026-08-08-manager-team-performance-workspace/task-7-review-${viewport.name}-detail.png`,
          fullPage: true,
        });
      }
      if (viewport.name === 'mobile') {
        await expect(page.getByTestId('team-task-list')).toBeHidden();
        await expect(page.getByTestId('team-member-heading')).toBeFocused();
        await page.getByRole('button', { name: '关闭成员详情' }).click();
        await expect(page.getByTestId('team-task-list')).toBeFocused();
        if (shouldCaptureTask7Evidence()) {
          await page.screenshot({
            path: '../.superpowers/sdd/2026-08-08-manager-team-performance-workspace/task-7-review-mobile-list.png',
            fullPage: true,
          });
        }
      } else {
        await expect(page.getByTestId('team-task-list')).toBeVisible();
      }

      const tableFit = await page.getByTestId('team-task-table-wrap').evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(tableFit.scrollWidth).toBeLessThanOrEqual(tableFit.clientWidth + 2);
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
