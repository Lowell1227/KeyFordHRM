import { expect, test } from '@playwright/test';
import {
  TASK_STATUS_STAGE,
  getTaskStageState,
} from '../../src/views/task/task-stage';
import {
  countObjectivesByScope,
  layoutObjectives,
  selectObjectiveScope,
} from '../../src/views/objectives/objective-map-layout';
import {
  DEFAULT_OBJECTIVE_MAP_DISPLAY,
  OBJECTIVE_MAP_DISPLAY_STORAGE_KEY,
  parseObjectiveMapDisplay,
} from '../../src/views/objectives/objective-map-settings';
import type { Objective } from '../../src/types/api.types';
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
    await expect(page.getByTestId('objective-map-filters')).toBeVisible();
    await expect(page.getByTestId('objective-map-surface')).toBeVisible();
    await expect(page.getByTestId('objective-create')).toBeVisible();
  });

  test('objective map exposes reference-style floating controls', async ({ page }) => {
    await page.goto('/dashboard');
    await page.evaluate((storageKey) => localStorage.removeItem(storageKey), OBJECTIVE_MAP_DISPLAY_STORAGE_KEY);
    await page.goto('/objectives');

    await expect(page.getByTestId('objective-map-filters')).toBeVisible();
    await expect(page.getByRole('button', { name: '我的目标', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '我团队成员的目标', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '我负责组织的目标', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '其他目标', exact: true })).toBeVisible();
    await expect(page.getByText('排序：按对齐数量')).toBeVisible();

    await page.getByTestId('objective-map-display-settings').click();
    const ownerSetting = page.getByRole('checkbox', { name: '显示负责人' });
    await expect(ownerSetting).toBeChecked();
    await page.getByText('显示负责人', { exact: true }).click();
    await expect(ownerSetting).not.toBeChecked();
    await page.reload();
    await page.getByTestId('objective-map-display-settings').click();
    await expect(page.getByRole('checkbox', { name: '显示负责人' })).not.toBeChecked();
  });

  test('target tracking exposes objective context and action workspace', async ({ page }) => {
    await page.goto('/action-items');

    await expect(page.getByTestId('tracking-context')).toBeVisible();
    await expect(page.getByTestId('tracking-objective-search')).toBeVisible();
    await expect(page.getByTestId('tracking-assignee-filter')).toBeVisible();
    await expect(page.getByTestId('tracking-surface')).toBeVisible();
  });
});

test.describe('09-performance-workspace read-only leadership', () => {
  test.use({ storageState: 'e2e/auth-state/approver.json' });

  test('VP can inspect goals without seeing write commands', async ({ page }) => {
    await page.goto('/objectives');
    await expect(page.getByTestId('objective-map-surface')).toBeVisible();
    await expect(page.getByTestId('objective-create')).toHaveCount(0);

    await page.goto('/action-items');
    await expect(page.getByTestId('tracking-surface')).toBeVisible();
    await expect(page.getByTestId('action-item-create')).toHaveCount(0);
  });
});

test.describe('09-performance-workspace employee tasks', () => {
  test.use({ storageState: 'e2e/auth-state/employee.json' });

  test('employee only sees the permitted performance entrance', async ({ page }) => {
    await page.goto('/tasks');

    const nav = page.getByTestId('performance-secondary-nav');
    await expect(nav.getByRole('link', { name: '绩效待办' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '目标跟进' })).toHaveCount(0);
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

function objectiveFixture(
  value: Partial<Objective> & Pick<Objective, 'id' | 'title' | 'level'>,
): Objective {
  return {
    description: null,
    deptId: null,
    deptName: null,
    ownerId: null,
    ownerName: null,
    parentId: null,
    cycleId: 'cycle-1',
    cycleName: '2026 年度',
    weight: 100,
    priority: 1,
    progress: 50,
    status: 'active',
    relatedIndicatorId: null,
    relatedIndicatorName: null,
    createdBy: null,
    creatorName: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...value,
  };
}

test.describe('09-performance-workspace objective map layout model', () => {
  const company = objectiveFixture({
    id: 'company',
    title: '提升年度经营质量',
    level: 'company',
    ownerId: 'vp-1',
  });
  const department = objectiveFixture({
    id: 'department',
    title: '研发交付目标',
    level: 'department',
    parentId: 'company',
    deptId: 'dept-1',
    ownerId: 'manager-1',
  });
  const mine = objectiveFixture({
    id: 'mine',
    title: '我的交付目标',
    level: 'individual',
    parentId: 'department',
    deptId: 'dept-1',
    ownerId: 'manager-1',
  });
  const teammate = objectiveFixture({
    id: 'teammate',
    title: '成员交付目标',
    level: 'individual',
    parentId: 'department',
    deptId: 'dept-1',
    ownerId: 'employee-1',
  });
  const otherDepartment = objectiveFixture({
    id: 'other-department',
    title: '其他部门目标',
    level: 'department',
    parentId: 'company',
    deptId: 'dept-2',
    ownerId: 'manager-2',
  });
  const outsider = objectiveFixture({
    id: 'outsider',
    title: '其他成员目标',
    level: 'individual',
    parentId: 'other-department',
    deptId: 'dept-2',
    ownerId: 'employee-2',
  });
  const roots: Objective[] = [{
    ...company,
    children: [{ ...department, children: [mine, teammate] }],
  }];
  const extendedRoots: Objective[] = [{
    ...company,
    children: [
      { ...department, children: [mine, teammate] },
      { ...otherDepartment, children: [outsider] },
    ],
  }];
  const actor = {
    userId: 'manager-1',
    teamOwnerIds: ['employee-1'],
    managedDeptIds: ['dept-1'],
  };

  test('keeps visible ancestors when selecting my and team objectives', () => {
    expect(selectObjectiveScope(roots, 'mine', actor).map((item) => item.id).sort())
      .toEqual(['company', 'department', 'mine']);
    expect(selectObjectiveScope(roots, 'team', actor).map((item) => item.id).sort())
      .toEqual(['company', 'department', 'teammate']);
    expect(countObjectivesByScope(roots, actor).team).toBe(1);
  });

  test('separates managed organization objectives from other visible objectives', () => {
    expect(selectObjectiveScope(extendedRoots, 'organization', actor).map((item) => item.id).sort())
      .toEqual(['company', 'department', 'mine', 'teammate']);
    expect(selectObjectiveScope(extendedRoots, 'other', actor).map((item) => item.id).sort())
      .toEqual(['company', 'other-department', 'outsider']);
  });

  test('positions three levels without overlap and connects only real parents', () => {
    const layout = layoutObjectives([company, department, mine, teammate], {
      showCompany: true,
      showDepartment: true,
    });
    expect(layout.edges.map((edge) => edge.id).sort()).toEqual([
      'company->department',
      'department->mine',
      'department->teammate',
    ]);
    const byId = new Map(layout.nodes.map((node) => [node.objective.id, node]));
    expect(byId.get('company')!.y).toBeLessThan(byId.get('department')!.y);
    expect(byId.get('department')!.y).toBeLessThan(byId.get('mine')!.y);
    expect(byId.get('mine')!.x).not.toBe(byId.get('teammate')!.x);
  });

  test('does not invent hidden ancestors and compacts disabled levels', () => {
    const orphan = { ...teammate, parentId: 'hidden-department' };
    expect(layoutObjectives([orphan], {
      showCompany: true,
      showDepartment: true,
    }).edges).toEqual([]);

    const compact = layoutObjectives([company, department, mine], {
      showCompany: false,
      showDepartment: false,
    });
    expect(compact.nodes.map((node) => node.objective.id)).toEqual(['mine']);
    expect(compact.nodes[0].y).toBeGreaterThanOrEqual(0);
  });
});

test.describe('09-performance-workspace objective map display settings model', () => {
  test('accepts a complete boolean payload', () => {
    const parsed = parseObjectiveMapDisplay(JSON.stringify({
      showCompany: false,
      showDepartment: true,
      showOwner: false,
      showProgress: true,
      showConnections: false,
    }));

    expect(parsed).toEqual({
      showCompany: false,
      showDepartment: true,
      showOwner: false,
      showProgress: true,
      showConnections: false,
    });
  });

  test('falls back for malformed or incomplete storage', () => {
    expect(parseObjectiveMapDisplay('{bad json')).toEqual(DEFAULT_OBJECTIVE_MAP_DISPLAY);
    expect(parseObjectiveMapDisplay(JSON.stringify({ showCompany: false })))
      .toEqual(DEFAULT_OBJECTIVE_MAP_DISPLAY);
  });
});

test.describe('09-performance-workspace tracking behavior', () => {
  test.use({ storageState: 'e2e/auth-state/manager.json' });

  test('restores objective from URL and applies the same status filter to list rows', async ({ page }) => {
    const objectives = [
      { id: 'obj-1', title: '第一目标', progress: 10, ownerName: '测试主管' },
      { id: 'obj-2', title: '第二目标', progress: 50, ownerName: '测试主管' },
    ];
    const actionItems = [
      { id: 'item-todo', objectiveId: 'obj-2', title: '待办行动项', status: 'todo', progress: 0, children: [] },
      { id: 'item-done', objectiveId: 'obj-2', title: '已完成行动项', status: 'done', progress: 100, children: [] },
    ];

    await page.route('**/api/v1/objectives?**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(objectives)),
    }));
    await page.route('**/api/v1/action-items/tree?**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(actionItems)),
    }));

    await page.goto('/action-items?objectiveId=obj-2');
    await expect(page.getByRole('button', { name: /第二目标/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('待办行动项')).toBeVisible();
    await expect(page.getByText('已完成行动项')).toBeVisible();

    await page.getByTestId('tracking-status-filter').click();
    await page.getByRole('option', { name: '已完成' }).click();

    await expect(page.getByText('已完成行动项')).toBeVisible();
    await expect(page.getByText('待办行动项')).toHaveCount(0);
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
