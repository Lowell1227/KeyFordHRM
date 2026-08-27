import { expect, test } from '@playwright/test';
import type { AssessmentCycle, Department, LaunchPreflightResult } from '../../src/types/api.types';
import {
  cyclePrimaryActionLabel,
  cycleNextStep,
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
  explicitExemptDeptIds: [],
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

const scheduledCycle: AssessmentCycle = {
  ...draftCycle,
  id: 'cycle-scheduled',
  name: '2027 Q1 预约周期',
  status: 'scheduled',
};

const scopeDepartments: Department[] = [{
  id: 'dept-parent',
  name: '研发中心',
  parentId: null,
  company: 'fuede',
  sortOrder: 1,
  isActive: true,
  children: [{
    id: 'dept-child-a',
    name: '平台组',
    parentId: 'dept-parent',
    company: 'fuede',
    sortOrder: 1,
    isActive: true,
  }, {
    id: 'dept-child-b',
    name: '应用组',
    parentId: 'dept-parent',
    company: 'fuede',
    sortOrder: 2,
    isActive: true,
  }],
}];

const allCompanyWithExclusions: AssessmentCycle = {
  ...draftCycle,
  id: 'cycle-all-exclusions',
  name: '2027 全公司考核',
  explicitExemptDeptIds: ['dept-parent', 'dept-child-a'],
  explicitExemptUserIds: ['user-1', 'user-2'],
};

const customScopeCycle: AssessmentCycle = {
  ...draftCycle,
  id: 'cycle-custom-scope',
  name: '2027 自定义范围考核',
  participantDeptIds: ['dept-parent', 'dept-child-a', 'dept-child-b'],
  participantUserIds: ['user-1', 'user-2'],
  explicitExemptDeptIds: ['dept-child-a'],
  explicitExemptUserIds: ['user-3'],
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
  cycles?: AssessmentCycle[];
  departments?: Department[];
  departmentsGate?: Promise<void>;
  departmentsFail?: boolean;
  createBodies?: unknown[];
  preflightRequests?: string[];
  launchRequests?: string[];
  scheduleRequests?: string[];
  preflight?: LaunchPreflightResult;
  deletedIds?: string[];
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
  await page.route('**/api/v1/notification-settings/dingtalk', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      available: true,
      enabled: false,
      effectiveEnabled: false,
    })),
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
  await page.route('**/api/v1/departments**', async (route) => {
    await options.departmentsGate;
    if (options.departmentsFail) {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 500, message: 'department tree unavailable' }),
      });
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(options.departments ?? [])),
    });
  });
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
    const requestedId = url.pathname.match(/\/cycles\/([^/]+)$/)?.[1];
    if (route.request().method() === 'DELETE' && requestedId) {
      options.deletedIds?.push(requestedId);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ id: requestedId })),
      });
    }
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
    const launchId = url.pathname.match(/\/cycles\/([^/]+)\/launch$/)?.[1];
    if (launchId) {
      options.launchRequests?.push(launchId);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ id: launchId })),
      });
    }
    const scheduleId = url.pathname.match(/\/cycles\/([^/]+)\/schedule$/)?.[1];
    if (scheduleId) {
      options.scheduleRequests?.push(scheduleId);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ id: scheduleId })),
      });
    }
    const visibleCycles = (options.cycles ?? [draftCycle])
      .filter((cycle) => !options.deletedIds?.includes(cycle.id));
    const data = requestedId
      ? visibleCycles.find((cycle) => cycle.id === requestedId) ?? draftCycle
      : { total: visibleCycles.length, page: 1, pageSize: 10, items: visibleCycles };
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
  expect(cyclePrimaryActionLabel('draft')).toBe('发起检查');
  expect(cyclePrimaryActionLabel('launch_blocked')).toBe('重新检查');
  expect(cycleNextStep({ ...draftCycle, status: 'launch_blocked' }).label).toBe('处理发起阻断项');
  expect(cycleStageIndex('approval')).toBe(3);
});

test.describe('compact cycle management list', () => {
  test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173' });

  test('shows stable assessment scope instead of a transient next step and sends the selected group to the API', async ({ page }) => {
    const cycleRequests: URL[] = [];
    await mockCyclePage(page, cycleRequests);

    await page.goto('/cycles?group=attention');

    await expect(page.getByTestId('cycle-group-attention')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('columnheader', { name: '周期' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '当前状态' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '考核范围' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '下一步' })).toHaveCount(0);
    await expect(page.getByTestId('cycle-scope-cycle-draft')).toContainText('全公司');
    await expect(page.getByTestId('cycle-scope-cycle-draft')).toContainText('无排除');
    await expect(page.getByText('待完成发起检查', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: '操作' })).toBeVisible();
    await expect(page.getByTestId('cycle-edit-cycle-draft')).toHaveText('编辑');
    await expect(page.getByTestId('cycle-delete-cycle-draft')).toHaveText('删除');
    await expect(page.getByTestId('cycle-primary-cycle-draft')).toHaveCount(0);
    expect(cycleRequests.some((url) => url.searchParams.get('group') === 'attention')).toBe(true);
  });

  test('summarizes persisted custom scope and exclusions with parent-child departments deduplicated', async ({ page }) => {
    await mockCyclePage(page, [], {
      cycles: [allCompanyWithExclusions, customScopeCycle],
      departments: scopeDepartments,
    });

    await page.goto('/cycles?group=attention');

    await expect(page.getByTestId('cycle-scope-cycle-all-exclusions')).toContainText('全公司');
    await expect(page.getByTestId('cycle-scope-cycle-all-exclusions')).toContainText('排除 1 个部门、2 名员工');
    await expect(page.getByTestId('cycle-scope-cycle-custom-scope')).toContainText('自定义范围');
    await expect(page.getByTestId('cycle-scope-cycle-custom-scope')).toContainText('1 个有效部门、另选 2 名员工');
    await expect(page.getByTestId('cycle-scope-cycle-custom-scope')).toContainText('排除 1 个部门、1 名员工');
  });

  test('does not show an unverified department count while the organization tree is loading', async ({ page }) => {
    let releaseDepartments!: () => void;
    const departmentsGate = new Promise<void>((resolve) => {
      releaseDepartments = resolve;
    });
    await mockCyclePage(page, [], {
      cycles: [customScopeCycle],
      departments: scopeDepartments,
      departmentsGate,
    });

    await page.goto('/cycles?group=attention');

    try {
      await expect(page.getByTestId('cycle-scope-cycle-custom-scope')).toContainText('考核范围加载中…');
      await expect(page.getByTestId('cycle-scope-cycle-custom-scope')).not.toContainText('3 个有效部门');
    } finally {
      releaseDepartments();
    }
    await expect(page.getByTestId('cycle-scope-cycle-custom-scope')).toContainText('1 个有效部门、另选 2 名员工');
  });

  test('asks HR to verify the scope instead of guessing when historical department lineage is unavailable', async ({ page }) => {
    const cycleWithUnavailableDepartment: AssessmentCycle = {
      ...customScopeCycle,
      id: 'cycle-historical-scope',
      participantDeptIds: ['dept-archived', 'dept-child-a'],
    };
    await mockCyclePage(page, [], {
      cycles: [cycleWithUnavailableDepartment],
      departments: scopeDepartments,
    });

    await page.goto('/cycles?group=attention');

    const scope = page.getByTestId('cycle-scope-cycle-historical-scope');
    await expect(scope).toContainText('自定义范围');
    await expect(scope).toContainText('部分历史部门信息不可用，请进入编辑核对');
    await expect(scope).not.toContainText('2 个有效部门');
  });

  test('does not double-count an active root and grandchild when an inactive middle department breaks the lineage', async ({ page }) => {
    const departmentsWithMissingMiddle: Department[] = [
      scopeDepartments[0],
      {
        id: 'dept-grandchild',
        name: '基础设施组',
        parentId: 'dept-inactive-middle',
        company: 'fuede',
        sortOrder: 3,
        isActive: true,
      },
    ];
    const cycleWithBrokenLineage: AssessmentCycle = {
      ...customScopeCycle,
      id: 'cycle-broken-lineage',
      participantDeptIds: ['dept-parent', 'dept-grandchild'],
      participantUserIds: [],
      explicitExemptDeptIds: [],
      explicitExemptUserIds: [],
    };
    await mockCyclePage(page, [], {
      cycles: [cycleWithBrokenLineage],
      departments: departmentsWithMissingMiddle,
    });

    await page.goto('/cycles?group=attention');

    const scope = page.getByTestId('cycle-scope-cycle-broken-lineage');
    await expect(scope).toContainText('部分历史部门信息不可用，请进入编辑核对');
    await expect(scope).not.toContainText('2 个有效部门');
  });

  test('opens the existing edit dialog from the direct draft action', async ({ page }) => {
    await mockCyclePage(page);
    await page.goto('/cycles?group=attention');

    await page.getByTestId('cycle-edit-cycle-draft').click();

    const dialog = page.getByRole('dialog', { name: '编辑绩效周期' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder('系统自动生成，可直接修改')).toHaveValue(draftCycle.name);
  });

  test('deletes a draft only after naming it in an explicit confirmation', async ({ page }) => {
    const deletedIds: string[] = [];
    await mockCyclePage(page, [], { deletedIds });
    await page.goto('/cycles?group=attention');

    await page.getByTestId('cycle-delete-cycle-draft').click();

    const dialog = page.getByRole('dialog', { name: '删除草稿周期' });
    await expect(dialog).toContainText('2026 Q4 季度考核');
    await dialog.getByRole('button', { name: '删除', exact: true }).click();

    await expect.poll(() => deletedIds).toEqual(['cycle-draft']);
    await expect(page.getByText('2026 Q4 季度考核', { exact: true })).toHaveCount(0);
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
    await expect(page.getByTestId('cycle-create-save-draft')).toHaveText('保存');
    await expect(page.getByTestId('cycle-create-submit')).toHaveText('提交');
  });

  test('creates a draft and immediately enters its open-check context', async ({ page }) => {
    const createBodies: unknown[] = [];
    const preflightRequests: string[] = [];
    await mockCyclePage(page, [], { createBodies, preflightRequests });
    await page.goto('/cycles?group=attention');

    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-create-submit').click();

    await expect(page).toHaveURL(/cycleId=cycle-draft/);
    expect(createBodies).toHaveLength(1);
    await expect.poll(() => preflightRequests).toEqual(['cycle-draft']);
    await expect(page.getByText('发起检查通过')).toBeVisible();
  });

  test('opens a full-page five-stage workspace and restores list context on return', async ({ page }) => {
    await mockCyclePage(page);
    await page.goto('/cycles?group=attention&keyword=2026&page=2');

    await page.getByRole('button', { name: '2026 Q4 季度考核' }).click();

    await expect(page).toHaveURL(/cycleId=cycle-draft/);
    await expect(page.getByTestId('cycle-workspace')).toBeVisible();
    await expect(page.getByTestId('cycle-current-action')).toBeVisible();
    await expect(page.getByTestId('cycle-workspace-edit')).toHaveText('编辑');
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

  test('opens the same edit dialog from a draft workspace', async ({ page }) => {
    await mockCyclePage(page);
    await page.goto('/cycles?group=attention&cycleId=cycle-draft');

    await page.getByTestId('cycle-workspace-edit').click();

    const dialog = page.getByRole('dialog', { name: '编辑绩效周期' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder('系统自动生成，可直接修改')).toHaveValue(draftCycle.name);
  });

  test('keeps only edit and submit in the draft workspace header', async ({ page }) => {
    await mockCyclePage(page);
    await page.goto('/cycles?group=attention&cycleId=cycle-draft');

    const actions = page.locator('.cycle-workspace__header-actions');
    await expect(actions.getByRole('button', { name: '编辑', exact: true })).toBeVisible();
    await expect(actions.getByRole('button', { name: '提交', exact: true })).toBeVisible();
    await expect(actions.getByRole('button', { name: '查看全部设置', exact: true })).toHaveCount(0);
    await expect(actions.getByRole('button', { name: '周期更多操作', exact: true })).toHaveCount(0);
  });

  test('runs the same launch preflight from workspace submit', async ({ page }) => {
    const preflightRequests: string[] = [];
    const launchRequests: string[] = [];
    const scheduleRequests: string[] = [];
    await mockCyclePage(page, [], { preflightRequests, launchRequests, scheduleRequests });
    await page.goto('/cycles?group=attention&cycleId=cycle-draft');

    await page.getByTestId('cycle-workspace-submit').click();

    await expect.poll(() => preflightRequests).toEqual(['cycle-draft']);
    await expect(page.getByText('发起检查通过')).toBeVisible();
    expect(launchRequests).toEqual([]);
    expect(scheduleRequests).toEqual([]);
  });

  test('keeps stage-specific actions for non-draft cycles', async ({ page }) => {
    await mockCyclePage(page, [], { cycles: [scheduledCycle] });
    await page.goto('/cycles?group=active');

    await expect(page.getByTestId('cycle-primary-cycle-scheduled')).toHaveText('查看预约');
    await expect(page.getByTestId('cycle-edit-cycle-scheduled')).toHaveCount(0);
    await expect(page.getByTestId('cycle-delete-cycle-scheduled')).toHaveCount(0);
  });

  test('shows only business blockers first and provides a returnable fix path', async ({ page }) => {
    await mockCyclePage(page, [], { preflight: blockedPreflight });
    await page.goto('/cycles?group=attention&keyword=2026');

    await page.getByRole('button', { name: draftCycle.name }).click();
    await page.getByRole('button', { name: '开始检查' }).click();

    await expect(page.getByTestId('cycle-preflight-blockers')).toContainText('1 名员工未匹配到绩效模板');
    await expect(page.getByText('TEMPLATE_UNCOVERED')).toHaveCount(0);
    await expect(page.getByText('林晓')).not.toBeVisible();
    await page.getByRole('button', { name: '去配置模板' }).click();
    await expect(page).toHaveURL((url) => (
      url.pathname === '/templates'
      && (url.searchParams.get('returnTo') || '').includes('/cycles?')
    ));
  });

  test('shows only immediate launch when the configured goal opening time has arrived', async ({ page }) => {
    await mockCyclePage(page, [], { preflight: immediatelyOpenablePreflight });
    await page.goto('/cycles?group=attention');

    await page.getByRole('button', { name: draftCycle.name }).click();
    await page.getByRole('button', { name: '开始检查' }).click();

    await expect(page.getByRole('button', { name: '立即发起' })).toBeVisible();
    await expect(page.getByRole('button', { name: /预约发起/ })).toHaveCount(0);
  });

  test('shows only a dated scheduled launch when the configured goal opening time is in the future', async ({ page }) => {
    await mockCyclePage(page, [], { preflight: readyPreflight });
    await page.goto('/cycles?group=attention');

    await page.getByRole('button', { name: draftCycle.name }).click();
    await page.getByRole('button', { name: '开始检查' }).click();

    await expect(page.getByRole('button', { name: /预约发起（.+）/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '立即发起' })).toHaveCount(0);
  });

  test('keeps list, creation, and workspace primary actions usable at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCyclePage(page, [], {
      cycles: [{ ...customScopeCycle, id: draftCycle.id, name: draftCycle.name }],
      departments: scopeDepartments,
    });
    await page.goto('/cycles?group=attention');

    await expect(page.getByTestId('cycle-compact-card-cycle-draft')).toBeVisible();
    await expect(page.getByTestId('cycle-scope-mobile-cycle-draft')).toContainText('自定义范围');
    await expect(page.getByTestId('cycle-scope-mobile-cycle-draft')).toContainText('1 个有效部门、另选 2 名员工');
    await expect(page.getByTestId('cycle-scope-mobile-cycle-draft')).toContainText('排除 1 个部门、1 名员工');
    await expect(page.getByText('下一步', { exact: true })).toHaveCount(0);
    await expect(page.getByText('待完成发起检查', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('cycle-edit-mobile-cycle-draft')).toHaveText('编辑');
    await expect(page.getByTestId('cycle-delete-mobile-cycle-draft')).toHaveText('删除');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByTestId('cycle-create').click();
    await expect(page.getByTestId('cycle-create-submit')).toHaveText('提交');
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

    await page.getByPlaceholder('系统自动生成，可直接修改').fill('临时修改的周期名称');
    await page.getByTestId('cycle-create-dialog').getByRole('button', { name: '取消', exact: true }).click();

    await expect(page.getByRole('dialog', { name: '放弃未保存内容？' })).toBeVisible();
    await page.getByRole('button', { name: '继续关闭' }).click();
    await expect(page.getByTestId('cycle-create-dialog')).not.toBeVisible();
  });
});
