import { expect, test } from '@playwright/test';
import type { AssessmentCycle } from '../../src/types/api.types';
import {
  localDateKey,
  orderPerformanceCycles,
  resolvePerformanceCycle,
} from '../../src/utils/performance-cycle';

function cycle(id: string, startDate: string, endDate: string): AssessmentCycle {
  return {
    id,
    name: id,
    type: 'quarterly',
    startDate,
    endDate,
    status: 'self_eval',
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
  };
}

test('preserves a valid requested historical cycle', () => {
  const result = resolvePerformanceCycle([
    cycle('past', '2026-01-01', '2026-03-31'),
    cycle('current', '2026-07-01', '2026-09-30'),
  ], 'past', '2026-08-16');

  expect(result.selectedCycle?.id).toBe('past');
  expect(result.requestedCycleIsValid).toBe(true);
});

test('defaults to the latest-starting in-progress cycle', () => {
  const result = resolvePerformanceCycle([
    cycle('current-old', '2026-01-01', '2026-12-31'),
    cycle('current-new', '2026-07-01', '2026-09-30'),
    cycle('future', '2026-10-01', '2026-12-31'),
  ], undefined, '2026-08-16');

  expect(result.selectedCycle?.id).toBe('current-new');
});

test('falls back to the most recently ended cycle', () => {
  const result = resolvePerformanceCycle([
    cycle('old', '2025-10-01', '2025-12-31'),
    cycle('recent', '2026-04-01', '2026-06-30'),
  ], undefined, '2026-08-16');

  expect(result.selectedCycle?.id).toBe('recent');
});

test('uses the earliest upcoming cycle when no cycle has started', () => {
  const result = resolvePerformanceCycle([
    cycle('later', '2027-01-01', '2027-03-31'),
    cycle('next', '2026-10-01', '2026-12-31'),
  ], undefined, '2026-08-16');

  expect(result.selectedCycle?.id).toBe('next');
});

test('handles inclusive boundaries, invalid dates, empty candidates, and local dates', () => {
  expect(resolvePerformanceCycle([
    cycle('boundary', '2026-08-16', '2026-08-16'),
    cycle('invalid', 'invalid', 'invalid'),
  ], undefined, '2026-08-16').selectedCycle?.id).toBe('boundary');
  expect(resolvePerformanceCycle([], 'missing', '2026-08-16').selectedCycle).toBeNull();
  expect(localDateKey(new Date(2026, 7, 16, 0, 30))).toBe('2026-08-16');
  expect(orderPerformanceCycles([
    cycle('invalid-first', 'invalid', 'invalid'),
  ], '2026-08-16')[0]?.id).toBe('invalid-first');
});

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

async function mockTaskCycleShell(
  page: import('@playwright/test').Page,
  cycleItems: AssessmentCycle[],
  taskRequests: URL[],
) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-cycle-context-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'manager-1',
      name: 'Cycle Manager',
      deptId: 'dept-1',
      deptName: 'Engineering',
      sysRole: 'manager',
      isAssessorOnly: false,
      canViewAll: false,
    })),
  }));
  await page.route('**/api/v1/cycles**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/cycles/mine')
      ? cycleItems
      : { total: cycleItems.length, page: 1, pageSize: 50, items: cycleItems };
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(data)),
    });
  });
  await page.route('**/api/v1/tasks/mine**', (route) => {
    taskRequests.push(new URL(route.request().url()));
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 100, items: [] })),
    });
  });
  await page.route('**/api/v1/tasks/team**', (route) => {
    taskRequests.push(new URL(route.request().url()));
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        total: 0,
        page: 1,
        pageSize: 20,
        items: [],
        counts: { all: 0, notStarted: 0, pending: 0, completed: 0, exempted: 0 },
        facets: { departments: [], employees: [] },
      })),
    });
  });
  await page.route('**/api/v1/tasks/*', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/tasks/mine') || path.endsWith('/tasks/team')) return route.fallback();
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'TASK_NOT_FOUND', message: 'Task not found', data: null }),
    });
  });
}

test.describe('cycle-first task contracts', () => {
  test.use({
    baseURL: 'http://localhost:5173',
    storageState: 'e2e/auth-state/manager.json',
  });

  test('canonicalizes the nearest cycle before loading personal and team tasks', async ({ page }) => {
    const taskRequests: URL[] = [];
    await mockTaskCycleShell(page, [
      cycle('past', '2026-01-01', '2026-03-31'),
      cycle('current', '2026-07-01', '2026-09-30'),
      cycle('future', '2026-10-01', '2026-12-31'),
    ], taskRequests);

    await page.goto('/tasks?scope=team&stage=goal-review&employeeId=old&taskId=old&page=3');

    await expect(page).toHaveURL(/cycleId=current/);
    await expect(page).not.toHaveURL(/employeeId=|taskId=|page=/);
    await expect.poll(() => taskRequests.length).toBeGreaterThan(0);
    expect(taskRequests.every((url) => url.searchParams.get('cycleId') === 'current')).toBe(true);
  });

  test('shows only real cycles and reset preserves the historical cycle', async ({ page }) => {
    const taskRequests: URL[] = [];
    await mockTaskCycleShell(page, [
      cycle('past', '2026-01-01', '2026-03-31'),
      cycle('current', '2026-07-01', '2026-09-30'),
    ], taskRequests);

    await page.goto('/tasks?scope=team&stage=goal-review&cycleId=past&deptId=dept-1');
    await expect(page.getByTestId('team-cycle-filter')).toHaveAttribute('data-testid', 'team-cycle-filter');
    await page.getByTestId('team-cycle-filter').click();
    await expect(page.locator('.el-select-dropdown__item').filter({ hasText: '全部考核周期' })).toHaveCount(0);
    await expect(page.locator('.el-select-dropdown__item').filter({ hasText: '仅看待办任务' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.locator('.team-toolbar__reset').click();
    await expect(page).toHaveURL(/cycleId=past/);
    await expect(page).not.toHaveURL(/deptId=/);
  });

  test('does not request task data when no cycle is available', async ({ page }) => {
    const taskRequests: URL[] = [];
    await mockTaskCycleShell(page, [], taskRequests);

    await page.goto('/tasks');

    await expect(page.getByText('暂无考核周期').first()).toBeVisible();
    expect(taskRequests).toHaveLength(0);
  });
});

async function mockObjectiveCycleShell(
  page: import('@playwright/test').Page,
  cycleItems: AssessmentCycle[],
  treeCycles: Array<string | null>,
) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-objective-cycle-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'manager-1',
      name: 'Cycle Manager',
      deptId: 'dept-1',
      deptName: 'Engineering',
      sysRole: 'manager',
      isAssessorOnly: false,
      canViewAll: false,
    })),
  }));
  await page.route('**/api/v1/cycles**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      total: cycleItems.length,
      page: 1,
      pageSize: 100,
      items: cycleItems,
    })),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([])),
  }));
  await page.route('**/api/v1/indicators**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 100, items: [] })),
  }));
  await page.route('**/api/v1/users/manager-1/subordinates', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([])),
  }));
  await page.route('**/api/v1/objectives/tree**', (route) => {
    treeCycles.push(new URL(route.request().url()).searchParams.get('cycleId'));
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse([])),
    });
  });
}

test.describe('cycle-first objective map contracts', () => {
  test.use({ baseURL: 'http://localhost:5173' });

  test('writes the current cycle before requesting the objective tree', async ({ page }) => {
    const treeCycles: Array<string | null> = [];
    await mockObjectiveCycleShell(page, [
      cycle('past', '2026-01-01', '2026-03-31'),
      cycle('current', '2026-07-01', '2026-09-30'),
    ], treeCycles);

    await page.goto('/objectives');

    await expect(page).toHaveURL(/cycleId=current/);
    await expect.poll(() => treeCycles.length).toBe(1);
    expect(treeCycles).toEqual(['current']);
  });

  test('preserves a valid historical objective cycle and offers no all-cycle option', async ({ page }) => {
    const treeCycles: Array<string | null> = [];
    await mockObjectiveCycleShell(page, [
      cycle('past', '2026-01-01', '2026-03-31'),
      cycle('current', '2026-07-01', '2026-09-30'),
    ], treeCycles);

    await page.goto('/objectives?cycleId=past');

    await expect(page).toHaveURL(/cycleId=past/);
    await page.getByTestId('objective-map-cycle').click();
    await expect(page.locator('.el-select-dropdown__item').filter({ hasText: '全部周期' })).toHaveCount(0);
    expect(treeCycles.every((cycleId) => cycleId === 'past')).toBe(true);
  });

  test('does not request an objective tree when no cycle is available', async ({ page }) => {
    const treeCycles: Array<string | null> = [];
    await mockObjectiveCycleShell(page, [], treeCycles);

    await page.goto('/objectives');

    await expect(page.getByText('暂无考核周期').first()).toBeVisible();
    expect(treeCycles).toHaveLength(0);
  });
});

const emptyReportSummary = {
  stats: {
    total: 0,
    grades: {
      A: { count: 0, ratio: 0 },
      B: { count: 0, ratio: 0 },
      C: { count: 0, ratio: 0 },
      D: { count: 0, ratio: 0 },
    },
  },
  items: [],
};

async function authenticateCyclePage(
  page: import('@playwright/test').Page,
  role: 'manager' | 'hr',
) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-report-cycle-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: `${role}-1`,
      name: `Cycle ${role}`,
      deptId: 'dept-1',
      deptName: 'Engineering',
      sysRole: role,
      isAssessorOnly: false,
      canViewAll: role === 'hr',
    })),
  }));
}

async function mockReportCycleShell(
  page: import('@playwright/test').Page,
  cycleItems: AssessmentCycle[],
  summaryCycles: string[],
) {
  await authenticateCyclePage(page, 'hr');
  await page.route('**/api/v1/cycles**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      total: cycleItems.length,
      page: 1,
      pageSize: 100,
      items: cycleItems,
    })),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([])),
  }));
  await page.route('**/api/v1/reports/cycle/*/summary**', (route) => {
    const match = new URL(route.request().url()).pathname.match(/\/reports\/cycle\/([^/]+)\/summary/);
    if (match?.[1]) summaryCycles.push(match[1]);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(emptyReportSummary)),
    });
  });
}

test.describe('cycle-first report contracts', () => {
  test.use({ baseURL: 'http://localhost:5173' });

  test('canonicalizes one report cycle before loading summary data', async ({ page }) => {
    const summaryCycles: string[] = [];
    await mockReportCycleShell(page, [
      cycle('current', '2026-07-01', '2026-09-30'),
      cycle('past', '2026-01-01', '2026-03-31'),
    ], summaryCycles);

    await page.goto('/reports');

    await expect(page).toHaveURL(/cycleId=current/);
    await expect.poll(() => summaryCycles.length).toBe(1);
    expect(summaryCycles).toEqual(['current']);
  });

  test('preserves a valid historical report cycle', async ({ page }) => {
    const summaryCycles: string[] = [];
    await mockReportCycleShell(page, [
      cycle('current', '2026-07-01', '2026-09-30'),
      cycle('past', '2026-01-01', '2026-03-31'),
    ], summaryCycles);

    await page.goto('/reports?cycleId=past');

    await expect(page.getByTestId('report-cycle-select')).toContainText('past');
    await expect.poll(() => summaryCycles.length).toBe(1);
    expect(summaryCycles).toEqual(['past']);
  });
});

test('management dashboard uses the nearest eligible result cycle', async ({ page }) => {
  const summaryCycles: string[] = [];
  await authenticateCyclePage(page, 'manager');
  const cycleItems = [
    { ...cycle('recent-result', '2026-04-01', '2026-06-30'), status: 'closed' as const },
    { ...cycle('current-non-result', '2026-07-01', '2026-09-30'), status: 'self_eval' as const },
    { ...cycle('current-result', '2026-07-15', '2026-09-15'), status: 'published' as const },
  ];
  await page.route('**/api/v1/cycles**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: cycleItems.length, page: 1, pageSize: 50, items: cycleItems })),
  }));
  await page.route('**/api/v1/tasks/mine**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 20, items: [] })),
  }));
  await page.route('**/api/v1/tasks/team**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      total: 0,
      page: 1,
      pageSize: 1,
      items: [],
      counts: { all: 0, notStarted: 0, pending: 0, completed: 0, exempted: 0 },
      facets: { departments: [], employees: [] },
    })),
  }));
  await page.route('**/api/v1/reports/cycle/*/summary**', (route) => {
    const match = new URL(route.request().url()).pathname.match(/\/reports\/cycle\/([^/]+)\/summary/);
    if (match?.[1]) summaryCycles.push(match[1]);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(emptyReportSummary)),
    });
  });

  await page.goto('http://localhost:5173/dashboard');

  await expect(page.getByTestId('dashboard-result-cycle')).toHaveText('current-result');
  expect(summaryCycles).toEqual(['current-result']);
});
