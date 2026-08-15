import { expect, test, type Page } from '@playwright/test';
import {
  TASK_STATUS_STAGE,
  getTaskStageState,
} from '../../src/views/task/task-stage';
import type { TaskStatus } from '../../src/types/enums';

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

test.describe('09-performance-workspace manager shell', () => {
  test.use({ storageState: 'e2e/auth-state/manager.json' });

  test('team employee selector exposes only the direct-manager API facet', async ({ page }) => {
    const teamResponse = page.waitForResponse((response) => (
      response.url().includes('/api/v1/tasks/team')
      && new URL(response.url()).searchParams.get('stage') === 'manager-eval'
      && response.status() === 200
    ));
    await page.goto('/tasks?scope=team&stage=manager-eval');
    const payload = await (await teamResponse).json() as {
      data: { facets: { employees: Array<{ name: string }> } };
    };
    const allowedNames = new Set(payload.data.facets.employees.map((employee) => employee.name));

    await page.getByTestId('team-employee-filter').click();
    const options = await page.locator('.el-select-dropdown__item:visible').allTextContents();
    expect(options.length).toBeGreaterThan(0);
    const renderedEmployeeNames = options
      .map((option) => option.trim())
      .filter((option) => option !== '全部员工')
      .map((option) => option.split(' · ')[0]);
    expect(new Set(renderedEmployeeNames)).toEqual(allowedNames);
  });

  for (const entry of [
    { path: '/action-items', current: '目标跟进' },
    { path: '/objectives', current: '目标地图' },
    { path: '/tasks', current: '绩效待办' },
  ]) {
    test(`${entry.current} uses shared performance navigation`, async ({ page }) => {
      await page.goto(entry.path);
      const nav = page.getByTestId('performance-secondary-nav');

      await expect(nav).toBeVisible();
      await expect(nav.getByRole('link', { name: '目标跟进' })).toBeVisible();
      await expect(nav.getByRole('link', { name: '目标地图' })).toBeVisible();
      await expect(nav.getByRole('link', { name: '绩效待办' })).toBeVisible();
      await expect(nav.getByRole('link', { name: entry.current })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
  }

  test('objective map exposes compact filters and one continuous data surface', async ({ page }) => {
    await page.goto('/objectives');

    await expect(page.getByTestId('objective-map-toolbar')).toBeVisible();
    await expect(page.getByTestId('objective-level-filter')).toBeVisible();
    await expect(page.getByTestId('objective-map-surface')).toBeVisible();
    await expect(page.getByTestId('objective-create')).toBeVisible();
  });

  test('objective map only offers a goal-tracking deep link for a resolvable owner and cycle', async ({ page }) => {
    await authenticateMockSession(page);
    await page.route('**/api/v1/auth/me', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ ...trackingUser, sysRole: 'manager' })),
    }));
    await page.route('**/api/v1/cycles?**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: 2, page: 1, pageSize: 100, items: trackingCycles })),
    }));
    await page.route('**/api/v1/departments**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse([])),
    }));
    await page.route('**/api/v1/indicators?**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 100, items: [] })),
    }));
    await page.route('**/api/v1/users/employee-1/subordinates', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse([])),
    }));
    await page.route(/\/api\/v1\/objectives(?:\?.*)?$/, (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        total: 2,
        page: 1,
        pageSize: 100,
        items: [
          { id: 'objective-2', title: '可跟进上级目标', description: null, level: 'individual', deptId: 'dept-1', deptName: '产品部', ownerId: 'manager-1', ownerName: '林治', parentId: null, cycleId: 'cycle-2', cycleName: '2026 第二季度', weight: 60, priority: 1, progress: 40, status: 'active', relatedIndicatorId: null, relatedIndicatorName: null, createdBy: 'manager-1', creatorName: '林治', createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z' },
          { id: 'objective-outsider', title: '不可跟进外部目标', description: null, level: 'individual', deptId: 'dept-2', deptName: '其他部门', ownerId: 'outsider', ownerName: '外部人员', parentId: null, cycleId: 'cycle-2', cycleName: '2026 第二季度', weight: 40, priority: 1, progress: 10, status: 'active', relatedIndicatorId: null, relatedIndicatorName: null, createdBy: 'outsider', creatorName: '外部人员', createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z' },
        ],
      })),
    }));

    await page.goto('/objectives');

    const permittedRow = page.locator('.el-table__row').filter({ hasText: '可跟进上级目标' });
    const forbiddenRow = page.locator('.el-table__row').filter({ hasText: '不可跟进外部目标' });
    await expect(permittedRow.getByRole('button', { name: '目标跟进' })).toBeVisible();
    await expect(forbiddenRow.getByRole('button', { name: '目标跟进' })).toHaveCount(0);
    await permittedRow.getByRole('button', { name: '目标跟进' }).click();
    await expect(page).toHaveURL(/\/action-items\?objectiveId=objective-2/);
  });

  test('target tracking exposes people context and indicator workspace', async ({ page }) => {
    await page.goto('/action-items');

    await expect(page.getByTestId('goal-tracking-people')).toBeVisible();
    await expect(page.getByTestId('goal-tracking-person-search')).toBeVisible();
    const surface = page.getByTestId('goal-tracking-surface');
    await expect(surface).toBeVisible();
    for (const column of ['考核指标', '最新进展', '状态', '进展', '权重']) {
      await expect(surface.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
    }
    const surfaceBox = await surface.boundingBox();
    const weightBox = await surface.getByRole('columnheader', { name: '权重' }).boundingBox();
    expect(surfaceBox).not.toBeNull();
    expect(weightBox).not.toBeNull();
    expect(Math.ceil(weightBox!.x + weightBox!.width)).toBeLessThanOrEqual(
      Math.ceil(surfaceBox!.x + surfaceBox!.width),
    );
  });

  for (const width of [900, 1024]) {
    test(`target tracking keeps every indicator column inside the surface at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/action-items');

      const surface = page.getByTestId('goal-tracking-surface');
      const surfaceBox = await surface.boundingBox();
      const weightBox = await surface.getByRole('columnheader', { name: '权重' }).boundingBox();
      expect(surfaceBox).not.toBeNull();
      expect(weightBox).not.toBeNull();
      expect(Math.ceil(weightBox!.x + weightBox!.width)).toBeLessThanOrEqual(
        Math.ceil(surfaceBox!.x + surfaceBox!.width),
      );
    });
  }
});

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

async function authenticateMockSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-goal-tracking-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(0)),
  }));
}

async function mockGoalTrackingShell(
  page: Page,
  overrides: {
    cycles?: typeof trackingCycles;
    tracking?: typeof trackingRows.self;
    deepLinkObjectiveId?: string;
    deepLinkResult?: typeof trackingRows.self;
  } = {},
) {
  await authenticateMockSession(page);
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
  await authenticateMockSession(page);
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

async function installDelayedObjectiveResolutionRoutes(page: Page) {
  await authenticateMockSession(page);
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(trackingUser)),
  }));
  await page.route('**/api/v1/cycles?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 2, page: 1, pageSize: 100, items: trackingCycles })),
  }));
  let announceObjectiveLookup!: () => void;
  const objectiveLookupStarted = new Promise<void>((resolve) => { announceObjectiveLookup = resolve; });
  const normalTrackingOwners: string[] = [];
  await page.route('**/api/v1/objectives/tracking?**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('objectiveId') === 'objective-1') {
      announceObjectiveLookup();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(trackingRows.self)),
      });
      return;
    }
    const ownerId = url.searchParams.get('ownerId') ?? '';
    normalTrackingOwners.push(ownerId);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(ownerId === 'manager-1' ? trackingRows.manager : trackingRows.self)),
    });
  });
  return { normalTrackingOwners, objectiveLookupStarted };
}

test.describe('09-performance-workspace read-only leadership', () => {
  test.use({ storageState: 'e2e/auth-state/approver.json' });

  test('VP can inspect goals without seeing write commands', async ({ page }) => {
    await page.goto('/objectives');
    await expect(page.getByTestId('objective-map-surface')).toBeVisible();
    await expect(page.getByTestId('objective-create')).toHaveCount(0);

    await page.goto('/action-items');
    await expect(page.getByTestId('goal-tracking-surface')).toBeVisible();
    await expect(page.getByTestId('action-item-create')).toHaveCount(0);
  });
});

test.describe('09-performance-workspace employee tasks', () => {
  test.use({ storageState: 'e2e/auth-state/employee.json' });

  test('employee only sees the permitted performance entrance', async ({ page }) => {
    await page.goto('/tasks');

    const nav = page.getByTestId('performance-secondary-nav');
    await expect(nav.getByRole('link', { name: '目标跟进' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '绩效待办' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '目标地图' })).toHaveCount(0);
  });

  test('performance tasks expose cycle and stage navigation', async ({ page }) => {
    await page.goto('/tasks');

    await expect(page.getByTestId('task-context')).toBeVisible();
    await expect(page.getByTestId('task-cycle-filter')).toBeVisible();
    const stage = page.getByTestId('task-stage-self-eval');
    await expect(stage).toBeVisible();
    await stage.click();
    await expect(stage).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('task-surface')).toBeVisible();
  });

  test('stage filtering includes matching tasks beyond the first ten records', async ({ page }) => {
    const tasks = Array.from({ length: 12 }, (_, index) => ({
      id: `mock-task-${index + 1}`,
      cycleId: `mock-cycle-${index + 1}`,
      cycleName: `Mock Cycle ${index + 1}`,
      employeeId: 'mock-employee',
      employeeName: '测试员工',
      status: index === 10 ? 'self_eval' : index === 11 ? 'confirmed' : 'indicator_setting',
      isExempt: false,
      updatedAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    }));

    await page.route('**/api/v1/tasks/mine**', async (route) => {
      const url = new URL(route.request().url());
      const requestedPage = Number(url.searchParams.get('page') || 1);
      const requestedPageSize = Number(url.searchParams.get('pageSize') || 10);
      const status = url.searchParams.get('status');
      const scoped = status ? tasks.filter((task) => task.status === status) : tasks;
      const start = (requestedPage - 1) * requestedPageSize;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          total: scoped.length,
          page: requestedPage,
          pageSize: requestedPageSize,
          items: scoped.slice(start, start + requestedPageSize),
        })),
      });
    });

    await page.goto('/tasks');
    await page.getByTestId('task-stage-self-eval').click();

    await expect(page.getByText('Mock Cycle 11 · 个人绩效')).toBeVisible();
    await expect(page.getByText('共 1 项')).toBeVisible();
  });
});

test.describe('09-performance-workspace stage semantics', () => {
  test('maps every task status and treats exempted tasks as completed', () => {
    const statuses: TaskStatus[] = [
      'pending',
      'indicator_drafting',
      'indicator_reviewing',
      'indicator_setting',
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
      'exempted',
    ];

    expect(Object.keys(TASK_STATUS_STAGE).sort()).toEqual([...statuses].sort());
    expect(TASK_STATUS_STAGE.pending).toBe('goal-setting');
    expect(TASK_STATUS_STAGE.manager_scoring).toBe('result');
    expect(TASK_STATUS_STAGE.exempted).toBe('result');
    expect(getTaskStageState(['exempted'])).toBe('completed');
    expect(getTaskStageState(['pending'])).toBe('not-started');
  });
});

test.describe('09-performance-workspace tracking behavior', () => {
  test.use({ storageState: 'e2e/auth-state/employee.json' });

  test('restores person and cycle from URL and follows browser history', async ({ page }) => {
    await mockGoalTrackingShell(page);
    const peoplePanel = page.getByTestId('goal-tracking-people');
    await page.goto('/action-items?employeeId=manager-1&cycleId=cycle-2');
    await expect(peoplePanel.getByRole('button', { name: /林治/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('goal-tracking-cycle')).toContainText('2026 第二季度');
    await peoplePanel.getByRole('button', { name: /刘伟/ }).click();
    await expect(page).toHaveURL(/employeeId=employee-1/);
    await page.goBack();
    await expect(peoplePanel.getByRole('button', { name: /林治/ })).toHaveAttribute('aria-pressed', 'true');
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
    await page.getByTestId('goal-tracking-cycle').selectOption('cycle-1');
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
    await expect(page.getByTestId('goal-tracking-people').getByRole('button', { name: /刘伟/ }))
      .toHaveAttribute('aria-pressed', 'true');
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

  test('ignores a slow objective deep link after the user changes person', async ({ page }) => {
    const requests = await installDelayedObjectiveResolutionRoutes(page);
    const objectiveResponse = page.waitForResponse((response) =>
      new URL(response.url()).searchParams.get('objectiveId') === 'objective-1');
    await page.goto('/action-items?objectiveId=objective-1');
    await requests.objectiveLookupStarted;
    const peoplePanel = page.getByTestId('goal-tracking-people');
    await peoplePanel.getByRole('button', { name: /林治/ }).click();
    await page.getByTestId('goal-tracking-cycle').selectOption('cycle-2');
    await objectiveResponse;
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));

    await expect(peoplePanel.getByRole('button', { name: /林治/ }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/employeeId=manager-1.*cycleId=cycle-2/);
    await expect(page).not.toHaveURL(/objectiveId=/);
    await expect(page.getByTestId('goal-tracking-surface')).toContainText('上级目标');
    await expect(page.locator('.tracking-indicators__notice')).toHaveCount(0);
    await expect(page.locator('.tracking-indicators__row.is-highlighted')).toHaveCount(0);
    expect(requests.normalTrackingOwners).toEqual(['manager-1']);
  });

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
    const peoplePanel = page.getByTestId('goal-tracking-people');
    await expect(peoplePanel).toContainText('我');
    await expect(peoplePanel).toContainText('直接上级');
    await expect(peoplePanel.getByRole('button', { name: /刘伟/ })).toHaveAttribute('aria-pressed', 'true');
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
    await expect(peoplePanel.getByRole('button', { name: /林治/ })).toBeVisible();
    await expect(peoplePanel.getByRole('button', { name: /刘伟/ })).toHaveCount(0);
    await page.getByTestId('goal-tracking-person-search').fill('不存在');
    await expect(page.getByText('未找到匹配人员')).toBeVisible();
  });
});

test.describe('09-performance-workspace responsive layout', () => {
  test.use({ storageState: 'e2e/auth-state/manager.json' });

  for (const path of ['/objectives', '/action-items', '/tasks']) {
    test(`${path} is usable at mobile width`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      const sidebarHeight = await page.locator('.app-sidebar').evaluate(
        (element) => element.getBoundingClientRect().height,
      );
      await expect(page.getByTestId('performance-secondary-nav')).toBeVisible();
      expect(overflow).toBeLessThanOrEqual(8);
      expect(sidebarHeight).toBeLessThanOrEqual(120);
    });
  }
});
