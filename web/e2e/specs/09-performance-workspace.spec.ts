import { expect, test } from '@playwright/test';
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
