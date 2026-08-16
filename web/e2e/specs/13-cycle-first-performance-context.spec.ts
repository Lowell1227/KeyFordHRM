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
