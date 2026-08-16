import { expect, test } from '@playwright/test';
import type { AssessmentCycle, LaunchPreflightResult } from '../../src/types/api.types';
import {
  cyclePrimaryActionLabel,
  cycleStageIndex,
  cycleStatusGroup,
} from '../../src/views/admin/cycle-management';

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

const draftCycle: AssessmentCycle = {
  id: 'cycle-draft',
  name: '2026 Q4 季度考核',
  type: 'quarterly',
  startDate: '2026-10-01',
  endDate: '2026-12-31',
  goalSettingOpenAt: '2026-09-21T09:00:00.000Z',
  selfEvalOpenAt: '2027-01-01T09:00:00.000Z',
  deadlineIndicatorSetting: '2026-09-28T18:00:00.000Z',
  deadlineIndicatorConfirm: '2026-09-30T18:00:00.000Z',
  deadlineSelfEval: '2027-01-05T18:00:00.000Z',
  deadlineManagerScore: '2027-01-08T18:00:00.000Z',
  deadlineHrCalibration: '2027-01-11T18:00:00.000Z',
  deadlineApproval: '2027-01-13T18:00:00.000Z',
  deadlinePublish: '2027-01-14T18:00:00.000Z',
  status: 'draft',
  hrOwnerId: 'hr-1',
  participantDeptIds: [],
  participantUserIds: [],
  explicitExemptUserIds: [],
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

const readyPreflight: LaunchPreflightResult = {
  ready: true,
  planHash: 'ready-plan-hash',
  cycle: {
    id: draftCycle.id,
    name: draftCycle.name,
    status: draftCycle.status,
    goalSettingOpenAt: draftCycle.goalSettingOpenAt,
  },
  participantCount: 128,
  templateCount: 9,
  participants: [],
  blockers: [],
  warnings: [],
};

interface CycleMockOptions {
  createBodies?: unknown[];
  preflightRequests?: string[];
  preflight?: LaunchPreflightResult;
}

async function mockCyclePage(
  page: import('@playwright/test').Page,
  cycleRequests: URL[] = [],
  options: CycleMockOptions = {},
) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-cycle-management-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'hr-1',
      name: '姚瑶',
      employeeNo: 'HR001',
      deptId: 'hr-dept',
      deptName: '人力资源部',
      sysRole: 'hr',
      isAssessorOnly: false,
      canViewAll: true,
    })),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([])),
  }));
  await page.route('**/api/v1/users**', (route) => {
    const user = {
      id: 'hr-1',
      name: '姚瑶',
      employeeNo: 'HR001',
      sysRole: 'hr',
      status: 'active',
      deptId: 'hr-dept',
      deptName: '人力资源部',
    };
    const data = new URL(route.request().url()).pathname.endsWith('/users/hr-1')
      ? user
      : { total: 1, page: 1, pageSize: 50, items: [user] };
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(data)),
    });
  });
  await page.route('**/api/v1/cycles**', (route) => {
    const url = new URL(route.request().url());
    cycleRequests.push(url);
    if (route.request().method() === 'POST' && url.pathname.endsWith('/cycles')) {
      options.createBodies?.push(route.request().postDataJSON());
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(draftCycle)),
      });
    }
    const preflightId = url.pathname.match(/\/cycles\/([^/]+)\/preflight$/)?.[1];
    if (preflightId) {
      options.preflightRequests?.push(preflightId);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(options.preflight ?? readyPreflight)),
      });
    }
    const requestedId = url.pathname.match(/\/cycles\/([^/]+)$/)?.[1];
    const data = requestedId
      ? draftCycle
      : { total: 1, page: 1, pageSize: 10, items: [draftCycle] };
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(data)),
    });
  });
}

test('maps cycle states to the compact group, action, and five-stage workflow', () => {
  expect(cycleStatusGroup('draft')).toBe('attention');
  expect(cycleStatusGroup('manager_score')).toBe('active');
  expect(cycleStatusGroup('closed')).toBe('finished');
  expect(cyclePrimaryActionLabel('launch_blocked')).toBe('重新检查');
  expect(cycleStageIndex('approval')).toBe(3);
});

test.describe('compact cycle management list', () => {
  test.use({ baseURL: 'http://localhost:5173' });

  test('shows grouped compact columns and sends the selected group to the API', async ({ page }) => {
    const cycleRequests: URL[] = [];
    await mockCyclePage(page, cycleRequests);

    await page.goto('/cycles?group=attention');

    await expect(page.getByTestId('cycle-group-attention')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('columnheader', { name: '周期' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '当前状态' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '下一步' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '操作' })).toBeVisible();
    await expect(page.getByTestId('cycle-primary-cycle-draft')).toHaveText('开放检查');
    expect(cycleRequests.some((url) => url.searchParams.get('group') === 'attention')).toBe(true);
  });

  test('keeps generated schedule and result rules collapsed until HR opens advanced settings', async ({ page }) => {
    await mockCyclePage(page);
    await page.goto('/cycles?group=attention');

    await page.getByTestId('cycle-create').click();

    await expect(page.getByTestId('cycle-create-advanced')).toBeVisible();
    await expect(page.getByTestId('cycle-advanced-fields')).not.toBeVisible();
    await page.getByTestId('cycle-create-advanced').click();
    await expect(page.getByTestId('cycle-advanced-fields')).toBeVisible();
    await expect(page.getByTestId('cycle-create-save-draft')).toBeVisible();
    await expect(page.getByTestId('cycle-create-and-check')).toBeVisible();
  });

  test('creates a draft and immediately enters its open-check context', async ({ page }) => {
    const createBodies: unknown[] = [];
    const preflightRequests: string[] = [];
    await mockCyclePage(page, [], { createBodies, preflightRequests });
    await page.goto('/cycles?group=attention');

    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-create-and-check').click();

    await expect(page).toHaveURL(/cycleId=cycle-draft/);
    expect(createBodies).toHaveLength(1);
    expect(preflightRequests).toEqual(['cycle-draft']);
  });
});
