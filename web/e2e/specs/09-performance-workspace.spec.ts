import { expect, test, type Page } from '@playwright/test';
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

function objectiveMapTreeFixture(): Objective[] {
  const company = objectiveFixture({
    id: 'company-1',
    title: '提升年度经营质量',
    level: 'company',
    ownerId: 'vp-1',
    ownerName: '褚浩然',
    progress: 58,
  });
  const department = objectiveFixture({
    id: 'department-1',
    title: '提升产品与服务交付质量',
    level: 'department',
    parentId: 'company-1',
    deptId: 'dept-1',
    deptName: '孚德北京办公室',
    ownerId: 'manager-1',
    ownerName: '周强',
    progress: 56,
  });
  const individual = objectiveFixture({
    id: 'individual-1',
    title: '用户问题支持',
    description: '持续响应客户反馈并按期关闭支持工单。',
    level: 'individual',
    parentId: 'department-1',
    deptId: 'dept-1',
    deptName: '孚德北京办公室',
    ownerId: 'employee-1',
    ownerName: '刘伟',
    weight: 40,
    priority: 2,
    progress: 30,
    relatedIndicatorId: 'indicator-1',
    relatedIndicatorName: '支持工单按期关闭率',
  });
  const mine = objectiveFixture({
    id: 'manager-goal-1',
    title: '团队关键交付目标',
    level: 'individual',
    parentId: 'department-1',
    deptId: 'dept-1',
    deptName: '孚德北京办公室',
    ownerId: 'manager-1',
    ownerName: '周强',
    progress: 70,
  });
  return [{ ...company, children: [{ ...department, children: [individual, mine] }] }];
}

async function routeObjectiveMap(page: Page, role: 'manager' | 'vp' = 'manager') {
  const user = role === 'manager'
    ? {
        id: 'manager-1', name: '周强', employeeNo: 'E2E_MGR', deptId: 'dept-1',
        deptName: '孚德北京办公室', sysRole: 'manager', isAssessorOnly: false, canViewAll: false,
      }
    : {
        id: 'vp-1', name: '褚浩然', employeeNo: 'E2E_VP', deptId: null,
        deptName: '孚德集团', sysRole: 'vp', isAssessorOnly: false, canViewAll: true,
      };

  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(user)),
  }));
  await page.route('**/api/v1/users/manager-1/subordinates', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([{
      id: 'employee-1', name: '刘伟', employeeNo: 'EMP-001', deptId: 'dept-1',
      deptName: '孚德北京办公室', employmentType: 'full_time', status: 'active',
      sysRole: 'employee', isAssessorOnly: false, canViewAll: false,
    }])),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([{
      id: 'dept-1', name: '孚德北京办公室', leaderId: 'manager-1', company: 'kayford',
      sortOrder: 1, isActive: true,
    }])),
  }));
  await page.route('**/api/v1/cycles**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      total: 1, page: 1, pageSize: 100,
      items: [{
        id: 'cycle-1', name: '2026 年度', type: 'annual', status: 'active',
        startDate: '2026-01-01', endDate: '2026-12-31',
        publishVisibleFields: {
          totalScore: true, grade: true, indicatorScores: true,
          managerComment: true, coefficient: true,
        },
        gradeAMaxRatio: 0.2, gradeBMaxRatio: 0.4,
        gradeCMaxRatio: 0.3, gradeDMaxRatio: 0.1,
      }],
    })),
  }));
  await page.route('**/api/v1/indicators**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 100, items: [] })),
  }));
  await page.route('**/api/v1/objectives**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(objectiveMapTreeFixture())),
  }));
}

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
    const visibleOptions = page.locator('.el-select-dropdown__item:visible');
    await expect(visibleOptions.first()).toBeVisible();
    const options = await visibleOptions.allTextContents();
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

  test('objective cards render the team alignment chain and management actions', async ({ page }) => {
    await routeObjectiveMap(page);
    await page.goto('/objectives');

    await expect(page.getByTestId('objective-map-scope-team')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('objective-map-card-company-1')).toContainText('提升年度经营质量');
    await expect(page.getByTestId('objective-map-card-department-1')).toContainText('提升产品与服务交付质量');
    const card = page.getByTestId('objective-map-card-individual-1');
    await expect(card).toContainText('个人');
    await expect(card).toContainText('刘伟');
    await expect(card).toContainText('用户问题支持');
    await expect(card).toContainText('30%');
    await card.focus();
    await card.press('Enter');
    await expect(page.getByTestId('objective-map-detail')).toContainText('用户问题支持');
    await page.keyboard.press('Escape');

    await card.getByRole('button', { name: '更多操作' }).click();
    await expect(page.getByRole('menuitem', { name: '编辑目标' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '更新进度' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '目标跟进' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: '删除目标' })).toBeVisible();
  });

  test('objective scope switching keeps visible ancestors and removes teammate-only goals', async ({ page }) => {
    await routeObjectiveMap(page);
    await page.goto('/objectives');

    await page.getByTestId('objective-map-scope-mine').click();
    await expect(page.getByTestId('objective-map-card-company-1')).toBeVisible();
    await expect(page.getByTestId('objective-map-card-department-1')).toBeVisible();
    await expect(page.getByTestId('objective-map-card-manager-goal-1')).toBeVisible();
    await expect(page.getByTestId('objective-map-card-individual-1')).toHaveCount(0);
    await expect(page.getByTestId('objective-map-surface').locator('.el-table')).toHaveCount(0);
  });

  test('objective detail exposes all business fields and manager operations', async ({ page }) => {
    await routeObjectiveMap(page);
    await page.goto('/objectives');

    const card = page.getByTestId('objective-map-card-individual-1');
    await card.click();
    const detail = page.getByTestId('objective-map-detail');
    await expect(detail).toContainText('用户问题支持');
    await expect(detail).toContainText('持续响应客户反馈并按期关闭支持工单。');
    await expect(detail).toContainText('个人');
    await expect(detail).toContainText('刘伟');
    await expect(detail).toContainText('孚德北京办公室');
    await expect(detail).toContainText('2026 年度');
    await expect(detail).toContainText('40%');
    await expect(detail).toContainText('优先级 2');
    await expect(detail).toContainText('30%');
    await expect(detail).toContainText('进行中');
    await expect(detail).toContainText('支持工单按期关闭率');

    await detail.getByRole('button', { name: '编辑目标' }).click();
    await expect(page.getByTestId('objective-dialog')).toBeVisible();
    await expect(page.getByTestId('objective-title')).toHaveValue('用户问题支持');
    await page.keyboard.press('Escape');

    await card.getByRole('button', { name: '更多操作' }).click();
    await page.getByRole('menuitem', { name: '更新进度' }).click();
    await expect(page.getByTestId('objective-progress-dialog')).toBeVisible();
    await page.keyboard.press('Escape');

    await card.getByRole('button', { name: '更多操作' }).click();
    await page.getByRole('menuitem', { name: '删除目标' }).click();
    await expect(page.getByRole('dialog', { name: '删除确认' })).toBeVisible();
    await page.getByRole('button', { name: '取消' }).click();

    await card.getByRole('button', { name: '更多操作' }).click();
    await expect(page.getByRole('menuitem', { name: '目标跟进' })).toHaveCount(0);
  });

  test('objective map ignores a stale cycle response', async ({ page }) => {
    await routeObjectiveMap(page);
    let oldCycleRequested = false;
    await page.unroute('**/api/v1/cycles**');
    await page.route('**/api/v1/cycles**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        total: 2, page: 1, pageSize: 100,
        items: [
          { id: 'cycle-old', name: '旧周期', type: 'annual', status: 'published', startDate: '2026-01-01', endDate: '2026-12-31', publishVisibleFields: {}, gradeAMaxRatio: 0.2, gradeBMaxRatio: 0.4, gradeCMaxRatio: 0.3, gradeDMaxRatio: 0.1 },
          { id: 'cycle-new', name: '新周期', type: 'annual', status: 'draft', startDate: '2027-01-01', endDate: '2027-12-31', publishVisibleFields: {}, gradeAMaxRatio: 0.2, gradeBMaxRatio: 0.4, gradeCMaxRatio: 0.3, gradeDMaxRatio: 0.1 },
        ],
      })),
    }));
    await page.unroute('**/api/v1/objectives**');
    await page.route('**/api/v1/objectives/tree**', async (route) => {
      const cycleId = new URL(route.request().url()).searchParams.get('cycleId');
      if (cycleId === 'cycle-old') {
        oldCycleRequested = true;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      const title = cycleId === 'cycle-new' ? '新周期目标' : '旧周期目标';
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse([objectiveFixture({
          id: cycleId === 'cycle-new' ? 'new-goal' : 'old-goal',
          title,
          level: 'individual',
          ownerId: 'manager-1',
        })])),
      });
    });

    await page.goto('/objectives');
    await expect.poll(() => oldCycleRequested).toBe(true);
    await page.getByTestId('objective-map-filters').locator('.el-select').click();
    await page.getByRole('option', { name: '新周期' }).click();
    await expect(page.getByText('新周期目标')).toBeVisible();
    await page.waitForTimeout(450);
    await expect(page.getByText('旧周期目标')).toHaveCount(0);
  });

  test('objective canvas draws real edges and supports zoom, pan, and fit', async ({ page }) => {
    await routeObjectiveMap(page);
    await page.goto('/objectives');

    const canvas = page.getByTestId('objective-map-canvas');
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId('objective-map-edges').locator('path')).toHaveCount(2);
    await expect(page.getByTestId('objective-map-zoom-value')).toHaveText('100%');

    await page.getByRole('button', { name: '放大目标地图' }).click();
    await expect(page.getByTestId('objective-map-zoom-value')).toHaveText('110%');
    await page.getByRole('button', { name: '缩小目标地图' }).click();
    await expect(page.getByTestId('objective-map-zoom-value')).toHaveText('100%');

    const before = await page.getByTestId('objective-map-world').getAttribute('style');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width - 40, box!.y + box!.height - 60);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width - 100, box!.y + box!.height - 110);
    await page.mouse.up();
    const after = await page.getByTestId('objective-map-world').getAttribute('style');
    expect(after).not.toBe(before);

    await page.getByRole('button', { name: '定位全部目标' }).click();
    await expect(page.getByTestId('objective-map-card-company-1')).toBeInViewport();
  });

  test('objective map only offers a goal-tracking deep link for a resolvable owner and cycle', async ({ page }) => {
    await routeObjectiveMap(page);

    await page.goto('/objectives');

    const subordinateCard = page.getByTestId('objective-map-card-individual-1');
    await subordinateCard.getByRole('button', { name: '更多操作' }).click();
    await expect(page.getByRole('menuitem', { name: '目标跟进' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByTestId('objective-map-scope-mine').click();
    const ownCard = page.getByTestId('objective-map-card-manager-goal-1');
    await ownCard.getByRole('button', { name: '更多操作' }).click();
    await expect(page.getByRole('menuitem', { name: '目标跟进' })).toBeVisible();
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
  { id: 'cycle-1', name: '2026-Q1', type: 'quarterly', startDate: '2026-01-01', endDate: '2026-03-31', status: 'self_eval', publishVisibleFields: {}, gradeAMaxRatio: 0.2, gradeBMaxRatio: 0.4, gradeCMaxRatio: 0.3, gradeDMaxRatio: 0.1 },
  { id: 'cycle-2', name: '2026-Q2', type: 'quarterly', startDate: '2026-04-01', endDate: '2026-06-30', status: 'manager_score', publishVisibleFields: {}, gradeAMaxRatio: 0.2, gradeBMaxRatio: 0.4, gradeCMaxRatio: 0.3, gradeDMaxRatio: 0.1 },
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

async function installDelayedDeepLinkLoadRoutes(page: Page) {
  await authenticateMockSession(page);
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(trackingUser)),
  }));
  await page.route('**/api/v1/cycles?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 2, page: 1, pageSize: 100, items: trackingCycles })),
  }));
  await page.route('**/api/v1/tasks/mine?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 20, items: [] })),
  }));
  let announceTrackingLoad!: () => void;
  const trackingLoadStarted = new Promise<void>((resolve) => { announceTrackingLoad = resolve; });
  await page.route('**/api/v1/objectives/tracking?**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('objectiveId') === 'objective-1') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(trackingRows.self)),
      });
      return;
    }
    announceTrackingLoad();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(trackingRows.self)),
    });
  });
  return { trackingLoadStarted };
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

  test('VP can inspect objective cards without management actions', async ({ page }) => {
    await routeObjectiveMap(page, 'vp');
    await page.goto('/objectives');

    const card = page.getByTestId('objective-map-card-individual-1');
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: '更多操作' })).toHaveCount(0);
    await card.press('Enter');
    const detail = page.getByTestId('objective-map-detail');
    await expect(detail).toContainText('用户问题支持');
    await expect(detail.getByRole('button', { name: '编辑目标' })).toHaveCount(0);
    await expect(detail.getByRole('button', { name: '更新进度' })).toHaveCount(0);
    await expect(detail.getByRole('button', { name: '删除目标' })).toHaveCount(0);
    await expect(detail.getByRole('button', { name: '目标跟进' })).toHaveCount(0);
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
  test.use({ storageState: 'e2e/auth-state/employee.json' });

  test('shows only formal real quarters and normalizes a hidden validation cycle', async ({ page }) => {
    const formalAndValidationCycles = [
      { ...trackingCycles[0], id: 'canonical-q1', status: 'closed' },
      { ...trackingCycles[1], id: 'canonical-q2' },
      { ...trackingCycles[1], id: 'canonical-q3', name: '2026-Q3', startDate: '2026-07-01', endDate: '2026-09-30', status: 'self_eval' },
      { ...trackingCycles[0], id: 'history-q4', name: '2025 Q4 绩效考核（历史）', startDate: '2025-10-01', endDate: '2025-12-31', status: 'published' },
      { ...trackingCycles[0], id: 'history-q3', name: '2025 Q3 绩效考核（历史）', startDate: '2025-07-01', endDate: '2025-09-30', status: 'published' },
      { ...trackingCycles[1], id: 'validation-cycle', name: '2026年二季度绩效考核（全流程验证 20260620-1037-15）' },
      { ...trackingCycles[0], id: 'annual-cycle', name: '2026年度绩效考核', type: 'annual' },
    ];
    await mockGoalTrackingShell(page, { cycles: formalAndValidationCycles });
    const trackingRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith('/objectives/tracking')
        && url.searchParams.get('cycleId') === 'canonical-q3';
    });

    await page.goto('/action-items?employeeId=employee-1&cycleId=validation-cycle');

    const cycleSelect = page.getByTestId('goal-tracking-cycle');
    await expect(cycleSelect.locator('option')).toHaveText([
      '2026 第三季度',
      '2026 第二季度',
      '2026 第一季度',
      '2025 第四季度',
      '2025 第三季度',
    ]);
    await expect(cycleSelect).toHaveValue('canonical-q3');
    await expect(page).toHaveURL(/cycleId=canonical-q3/);
    await trackingRequest;
  });

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

  test('rejects a deep-link tracking load after the page unmounts', async ({ page }) => {
    const requests = await installDelayedDeepLinkLoadRoutes(page);
    const trackingResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/objectives/tracking')
        && url.searchParams.get('ownerId') === 'employee-1';
    });
    await page.goto('/action-items?objectiveId=objective-1');
    await requests.trackingLoadStarted;
    await page.evaluate(() => {
      type VueInstance = {
        parent?: VueInstance;
        setupState?: Record<string, unknown>;
      };
      const surface = document.querySelector('[data-testid="goal-tracking-surface"]') as
        (Element & { __vueParentComponent?: VueInstance }) | null;
      let instance = surface?.__vueParentComponent;
      while (instance && !instance.setupState?.workspace) instance = instance.parent;
      if (!instance?.setupState?.workspace) throw new Error('Goal tracking workspace was not found');
      (window as typeof window & { __retainedGoalTrackingWorkspace?: unknown })
        .__retainedGoalTrackingWorkspace = instance.setupState.workspace;
    });

    await page.getByRole('link', { name: '绩效待办' }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await trackingResponse;
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));

    const retainedState = await page.evaluate(() => {
      type RetainedWorkspace = {
        result: { value: typeof trackingRows.self };
        loading: { value: boolean };
        error: { value: string };
      };
      const workspace = (window as typeof window & { __retainedGoalTrackingWorkspace?: unknown })
        .__retainedGoalTrackingWorkspace as RetainedWorkspace | undefined;
      if (!workspace) throw new Error('Retained goal tracking workspace was not found');
      return {
        itemIds: workspace.result.value.items.map((item) => item.id),
        loading: workspace.loading.value,
        error: workspace.error.value,
      };
    });
    expect(retainedState).toEqual({ itemIds: [], loading: true, error: '' });
  });

  test('does not resume initial cycle loading after the page unmounts', async ({ page }) => {
    await authenticateMockSession(page);
    await page.route('**/api/v1/auth/me', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(trackingUser)),
    }));
    await page.route('**/api/v1/tasks/mine?**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 20, items: [] })),
    }));
    let announceCycles!: () => void;
    let releaseCycles!: () => void;
    let fulfilledCycles = 0;
    const cyclesStarted = new Promise<void>((resolve) => { announceCycles = resolve; });
    const cyclesGate = new Promise<void>((resolve) => { releaseCycles = resolve; });
    await page.route('**/api/v1/cycles?**', async (route) => {
      announceCycles();
      await cyclesGate;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          total: 2, page: 1, pageSize: 100, items: trackingCycles,
        })),
      });
      fulfilledCycles += 1;
    });
    let trackingRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/objectives/tracking')) trackingRequests += 1;
    });

    await page.goto('/action-items');
    await cyclesStarted;
    await page.evaluate(() => {
      type VueInstance = {
        parent?: VueInstance;
        setupState?: Record<string, unknown>;
      };
      const surface = document.querySelector('[data-testid="goal-tracking-surface"]') as
        (Element & { __vueParentComponent?: VueInstance }) | null;
      let instance = surface?.__vueParentComponent;
      while (instance && !instance.setupState?.workspace) instance = instance.parent;
      if (!instance?.setupState?.workspace) throw new Error('Goal tracking workspace was not found');
      (window as typeof window & { __retainedGoalTrackingWorkspace?: unknown })
        .__retainedGoalTrackingWorkspace = instance.setupState.workspace;
    });

    await page.getByRole('link', { name: '绩效待办' }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    releaseCycles();
    await expect.poll(() => fulfilledCycles).toBeGreaterThan(0);
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));

    await expect(page).toHaveURL(/\/tasks$/);
    expect(trackingRequests).toBe(0);
    const retainedState = await page.evaluate(() => {
      type RetainedWorkspace = {
        cycles: { value: Array<{ id: string }> };
        cyclesLoading: { value: boolean };
        selectedPersonId: { value: string };
        selectedCycleId: { value: string };
      };
      const workspace = (window as typeof window & { __retainedGoalTrackingWorkspace?: unknown })
        .__retainedGoalTrackingWorkspace as RetainedWorkspace | undefined;
      if (!workspace) throw new Error('Retained goal tracking workspace was not found');
      return {
        cycleIds: workspace.cycles.value.map((cycle) => cycle.id),
        cyclesLoading: workspace.cyclesLoading.value,
        selectedPersonId: workspace.selectedPersonId.value,
        selectedCycleId: workspace.selectedCycleId.value,
      };
    });
    expect(retainedState).toEqual({
      cycleIds: [],
      cyclesLoading: true,
      selectedPersonId: '',
      selectedCycleId: '',
    });
  });

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

  for (const width of [900, 1024]) {
    test(`keeps four optional indicator columns inside the surface at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await mockGoalTrackingShell(page);
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

  test('employee sees the reference goal-tracking workspace for self and manager', async ({ page }) => {
    await authenticateMockSession(page);
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
          id: 'cycle-1', name: '2026-Q2', type: 'quarterly',
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
          { id: 'objective-2', title: '新产品', ownerId: 'employee-1', ownerName: '刘伟', cycleId: 'cycle-1', cycleName: '2026 第二季度', priority: 1, status: 'active', progress: 35, weight: 50, latestProgress: { id: 'item-2', title: '完成方案评审', progress: 60, updatedAt: '2026-08-15T08:00:00.000Z' } },
          { id: 'objective-3', title: '启动目标', ownerId: 'employee-1', ownerName: '刘伟', cycleId: 'cycle-1', cycleName: '2026 第二季度', priority: 3, status: 'active', progress: 0, weight: 0, latestProgress: { id: 'item-3', title: '启动准备', progress: 0, updatedAt: '2026-08-14T08:00:00.000Z' } },
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
    await expect(page.getByText('完成方案评审 · 60%', { exact: true })).toBeVisible();
    await expect(page.getByText('启动准备 · 0%', { exact: true })).toBeVisible();
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

  test('objective map responsive layout keeps floating controls and a card reachable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await routeObjectiveMap(page);
    await page.goto('/objectives');

    const surface = page.getByTestId('objective-map-surface');
    const canvas = page.getByTestId('objective-map-canvas');
    await expect(page.getByTestId('objective-map-filters')).toBeVisible();
    await expect(page.getByTestId('objective-map-display-settings')).toBeVisible();
    await expect(canvas).toBeVisible();
    await expect(page.getByRole('button', { name: '定位全部目标' })).toBeVisible();
    await expect(page.getByTestId('objective-map-card-individual-1')).toBeVisible();
    expect(await surface.evaluate((element) => getComputedStyle(element).overflowX)).toBe('hidden');
    expect(await canvas.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(420);
  });

  test('objective map accessibility supports focus, keyboard detail, and reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await routeObjectiveMap(page);
    await page.goto('/objectives');

    const scope = page.getByTestId('objective-map-scope-team');
    await scope.focus();
    await expect(scope).toHaveCSS('outline-width', '2px');

    const card = page.getByTestId('objective-map-card-individual-1');
    await card.focus();
    await expect(card).toHaveCSS('outline-width', '2px');
    await card.press('Enter');
    await expect(page.getByTestId('objective-map-detail')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('objective-map-detail')).not.toBeVisible();
    await expect(page.getByTestId('objective-map-world')).toHaveCSS('transition-duration', '0s');
  });

  test('objective map desktop controls float over the full canvas', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await routeObjectiveMap(page);
    await page.goto('/objectives');

    await expect(page.getByTestId('objective-map-toolbar')).toHaveCSS('position', 'absolute');
    await expect(page.getByTestId('objective-map-canvas')).toHaveCSS('background-color', 'rgb(243, 246, 252)');
  });

  test('objective map medium layout keeps display settings inside the canvas', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await routeObjectiveMap(page);
    await page.goto('/objectives');

    const surfaceBox = await page.getByTestId('objective-map-surface').boundingBox();
    const settingsBox = await page.getByTestId('objective-map-display-settings').boundingBox();
    expect(surfaceBox).not.toBeNull();
    expect(settingsBox).not.toBeNull();
    expect(settingsBox!.x + settingsBox!.width).toBeLessThanOrEqual(surfaceBox!.x + surfaceBox!.width);
  });

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
