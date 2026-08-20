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

const blockedPreflight: LaunchPreflightResult = {
  ...readyPreflight,
  ready: false,
  planHash: null,
  participants: [{
    employeeId: 'employee-1',
    employeeName: '林晓',
    deptId: 'sales',
    deptName: '销售部',
    managerId: 'manager-1',
    managerName: '周强',
    deptHeadId: 'manager-1',
    approverId: 'approver-1',
    templateId: '',
    templateName: '未匹配',
    templateVersion: 0,
    isExempt: false,
    exemptReason: null,
  }],
  blockers: [{
    code: 'TEMPLATE_UNCOVERED',
    message: '1 名员工未匹配到绩效模板',
  }],
};

const immediatelyOpenablePreflight: LaunchPreflightResult = {
  ...readyPreflight,
  cycle: {
    ...readyPreflight.cycle,
    goalSettingOpenAt: '2026-01-01T09:00:00.000Z',
  },
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
  await page.route('**/api/v1/templates**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 20, items: [] })),
  }));
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
    await expect.poll(() => preflightRequests).toEqual(['cycle-draft']);
  });

  test('opens a full-page five-stage workspace and restores list context on return', async ({ page }) => {
    await mockCyclePage(page);
    await page.goto('/cycles?group=attention&keyword=2026&page=2');

    await page.getByRole('button', { name: '2026 Q4 季度考核' }).click();

    await expect(page).toHaveURL(/cycleId=cycle-draft/);
    await expect(page.getByTestId('cycle-workspace')).toBeVisible();
    await expect(page.getByTestId('cycle-current-action')).toBeVisible();
    for (let index = 0; index < 5; index += 1) {
      await expect(page.getByTestId(`cycle-stage-${index}`)).toBeVisible();
    }
    await expect(page.getByRole('columnheader', { name: '周期' })).toHaveCount(0);

    await page.getByTestId('cycle-workspace-back').click();
    await expect(page).not.toHaveURL(/cycleId=/);
    await expect(page).toHaveURL(/keyword=2026/);
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByRole('columnheader', { name: '周期' })).toBeVisible();
  });

  test('shows only business blockers first and provides a returnable fix path', async ({ page }) => {
    await mockCyclePage(page, [], { preflight: blockedPreflight });
    await page.goto('/cycles?group=attention&keyword=2026');

    await page.getByTestId('cycle-primary-cycle-draft').click();

    await expect(page.getByTestId('cycle-preflight-blockers')).toContainText('1 名员工未匹配到绩效模板');
    await expect(page.getByText('TEMPLATE_UNCOVERED')).toHaveCount(0);
    await expect(page.getByText('林晓')).not.toBeVisible();
    await page.getByRole('button', { name: '去配置模板' }).click();
    await expect(page).toHaveURL((url) => (
      url.pathname === '/templates'
      && (url.searchParams.get('returnTo') || '').includes('/cycles?')
    ));
  });

  test('keeps the existing immediate and scheduled opening choices when checks pass', async ({ page }) => {
    await mockCyclePage(page, [], { preflight: immediatelyOpenablePreflight });
    await page.goto('/cycles?group=attention');

    await page.getByTestId('cycle-primary-cycle-draft').click();

    await expect(page.getByRole('button', { name: '立即开放' })).toBeVisible();
    await expect(page.getByRole('button', { name: '按开放时间预约' })).toBeVisible();
  });

  test('keeps list, creation, and workspace primary actions usable at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCyclePage(page);
    await page.goto('/cycles?group=attention');

    await expect(page.getByTestId('cycle-compact-card-cycle-draft')).toBeVisible();
    await expect(page.getByTestId('cycle-primary-mobile-cycle-draft')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByTestId('cycle-create').click();
    await expect(page.getByTestId('cycle-create-and-check')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: '取消' }).click();

    await page.getByTestId('cycle-compact-card-cycle-draft').click();
    await expect(page.getByTestId('cycle-workspace-back')).toBeVisible();
    await expect(page.getByTestId('cycle-current-action')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('warns before discarding edits from the compact creation form', async ({ page }) => {
    await mockCyclePage(page);
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    await page.getByPlaceholder('如 2026 Q2 季度考核').fill('临时修改的周期名称');
    await page.getByTestId('cycle-create-dialog').getByRole('button', { name: '取消', exact: true }).click();

    await expect(page.getByRole('dialog', { name: '放弃未保存内容？' })).toBeVisible();
    await page.getByRole('button', { name: '继续关闭' }).click();
    await expect(page.getByTestId('cycle-create-dialog')).not.toBeVisible();
  });
});
