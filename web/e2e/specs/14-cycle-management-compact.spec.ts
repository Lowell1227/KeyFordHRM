import { expect, test } from '@playwright/test';
import type { AssessmentCycle } from '../../src/types/api.types';
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

async function mockCyclePage(
  page: import('@playwright/test').Page,
  cycleRequests: URL[] = [],
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
  await page.route('**/api/v1/cycles**', (route) => {
    const url = new URL(route.request().url());
    cycleRequests.push(url);
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
});
