import { expect, test } from '@playwright/test';
import type {
  AssessmentCycle,
  CyclePeriodSchedule,
  CurrentUser,
  Department,
  LaunchPreflightResult,
} from '../../src/types/api.types';
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
    message: '1 名员工未匹配到考核模板',
  }],
};

const immediatelyOpenablePreflight: LaunchPreflightResult = {
  ...readyPreflight,
  cycle: {
    ...readyPreflight.cycle,
    goalSettingOpenAt: '2026-01-01T09:00:00.000Z',
  },
};

const warningPreflight: LaunchPreflightResult = {
  ...immediatelyOpenablePreflight,
  warnings: [{
    code: 'HR_CALIBRATION_BEFORE_FINAL_MANAGER_DUE',
    message: 'HR校准截止不能早于最后一期主管计划完成时间',
  }],
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
  launchBodies?: Record<string, unknown>[];
  scheduleBodies?: Record<string, unknown>[];
  preflight?: LaunchPreflightResult;
  participantRecord?: Record<string, unknown>;
  participantRecordRequests?: string[];
  deletedIds?: string[];
  authUser?: CurrentUser;
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
    body: JSON.stringify(apiResponse(options.authUser ?? {
      id: 'hr-1',
      name: '姚瑶',
      employeeNo: 'HR001',
      deptId: 'hr-dept',
      deptName: '人力资源部',
      sysRole: 'hr',
      isAssessorOnly: false,
      canViewAll: true,
    } satisfies CurrentUser)),
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
  await page.route('**/api/v1/indicators**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 100, items: [] })),
  }));
  await page.route('**/api/v1/cycles**', (route) => {
    const url = new URL(route.request().url());
    cycleRequests.push(url);
    if (route.request().method() === 'POST' && url.pathname.endsWith('/cycles/schedule-preview')) {
      const body = route.request().postDataJSON() as {
        scoringFrequency?: 'monthly' | 'cycle';
        schedules?: CyclePeriodSchedule[];
      };
      const scoringFrequency = body.scoringFrequency === 'cycle' ? 'cycle' : 'monthly';
      const defaultSchedules: CyclePeriodSchedule[] = scoringFrequency === 'cycle'
        ? [{
            periodKey: 'cycle',
            periodType: 'cycle',
            sequence: 1,
            periodStart: '2026-10-01',
            periodEnd: '2026-12-31',
            selfEvalOpenAt: '2027-01-04T09:00:00+08:00',
            selfEvalDueAt: '2027-01-06T18:00:00+08:00',
            managerDueAt: '2027-01-11T18:00:00+08:00',
            isException: false,
          }]
        : ['10', '11', '12'].map((month, index) => ({
            periodKey: `2026-${month}`,
            periodType: 'month' as const,
            sequence: index + 1,
            periodStart: `2026-${month}-01`,
            periodEnd: `2026-${month}-${month === '11' ? '30' : '31'}`,
            selfEvalOpenAt: `202${month === '12' ? '7-01' : `6-${String(Number(month) + 1).padStart(2, '0')}`}-04T09:00:00+08:00`,
            selfEvalDueAt: `202${month === '12' ? '7-01' : `6-${String(Number(month) + 1).padStart(2, '0')}`}-06T18:00:00+08:00`,
            managerDueAt: `202${month === '12' ? '7-01' : `6-${String(Number(month) + 1).padStart(2, '0')}`}-11T18:00:00+08:00`,
            isException: false,
          }));
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          scoringFrequency,
          reviewFrequency: 'cycle',
          schedules: body.schedules ?? defaultSchedules,
          blockers: [],
          warnings: [],
        })),
      });
    }
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
    const participantRecordId = url.pathname.match(/\/cycles\/([^/]+)\/participant-record$/)?.[1];
    if (participantRecordId) {
      options.participantRecordRequests?.push(participantRecordId);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(options.participantRecord ?? {})),
      });
    }
    const launchId = url.pathname.match(/\/cycles\/([^/]+)\/launch$/)?.[1];
    if (launchId) {
      options.launchRequests?.push(launchId);
      options.launchBodies?.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ id: launchId })),
      });
    }
    const scheduleId = url.pathname.match(/\/cycles\/([^/]+)\/schedule$/)?.[1];
    if (scheduleId) {
      options.scheduleRequests?.push(scheduleId);
      options.scheduleBodies?.push(route.request().postDataJSON() as Record<string, unknown>);
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

  test('defaults to all cycles and reset returns to the ungrouped list', async ({ page }) => {
    const cycleRequests: URL[] = [];
    await mockCyclePage(page, cycleRequests);

    await page.goto('/cycles');

    await expect(page.getByTestId('cycle-group-all')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => cycleRequests.at(-1)?.searchParams.has('group')).toBe(false);

    await page.getByTestId('cycle-group-attention').click();
    await expect.poll(() => cycleRequests.at(-1)?.searchParams.get('group')).toBe('attention');

    await page.getByRole('button', { name: '重置', exact: true }).click();
    await expect(page.getByTestId('cycle-group-all')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => cycleRequests.at(-1)?.searchParams.has('group')).toBe(false);
    await expect(page).not.toHaveURL(/(?:\?|&)group=/);
  });

  test('keeps the global DingTalk notification switch read-only for a cycle plan editor', async ({ page }) => {
    await mockCyclePage(page, [], {
      authUser: {
        id: 'hr-editor',
        name: '方园',
        employeeNo: '319',
        deptId: 'hr-dept',
        deptName: '人事组',
        sysRole: 'hr_user',
        systemPermission: 'hr_user',
        hrCapabilities: ['cycle_plan_edit'],
        isAssessorOnly: false,
        canViewAll: false,
      },
    });

    await page.goto('/cycles?group=attention');

    await expect(page.getByTestId('cycle-create')).toBeVisible();
    await expect(page.getByTestId('dingtalk-notification-status')).toContainText('钉钉通知已关闭');
    await expect(page.getByTestId('dingtalk-global-toggle').locator('input')).toBeDisabled();

    await page.getByTestId('cycle-create').click();
    const createDialog = page.getByRole('dialog', { name: '创建绩效周期' });
    await expect(createDialog).toBeVisible();
    await expect(createDialog.getByText('审核人', { exact: true })).toHaveCount(0);
  });

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

  test('shows the launched participant record without duplicating cycle concepts', async ({ page }) => {
    const participantRecordRequests: string[] = [];
    const launchedCycle: AssessmentCycle = {
      ...draftCycle,
      id: 'cycle-launched',
      name: '2026年08月绩效考核',
      status: 'indicator_setting',
      openedAt: '2026-08-30T02:51:22.695Z',
      openSource: 'manual',
      taskStats: {
        total: 109,
        unsubmitted: 101,
        pendingManagerReview: 0,
        pendingEmployeeConfirmation: 0,
        goalCompleted: 0,
        exempted: 8,
        overdue: 101,
        byStatus: { indicator_drafting: 101, exempted: 8 },
      },
    };
    await mockCyclePage(page, [], {
      cycles: [launchedCycle],
      participantRecordRequests,
      participantRecord: {
        cycleId: launchedCycle.id,
        recordedAt: launchedCycle.openedAt,
        source: 'manual',
        operator: { id: 'hr-1', name: '姚瑶' },
        summary: { total: 109, active: 101, exempted: 8 },
        participants: [
          {
            employeeId: 'employee-active', employeeName: '陈晨', deptId: 'hr-team', deptName: '人事组',
            managerId: 'manager-1', managerName: '姚瑶', participantDisposition: 'active',
            isExempt: false, exemptReason: null, status: 'indicator_drafting',
          },
          {
            employeeId: 'employee-exempt', employeeName: '方园', deptId: 'hr-team', deptName: '人事组',
            managerId: 'manager-1', managerName: '俞丹', participantDisposition: 'cycle_exempt',
            isExempt: true, exemptReason: 'HR 按部门设置为本周期豁免', status: 'exempted',
          },
        ],
      },
    });

    await page.goto('/cycles?cycleId=cycle-launched');

    await expect.poll(() => participantRecordRequests).toEqual(['cycle-launched']);
    await expect(page.getByTestId('cycle-workspace-scoring-summary')).not.toContainText('评分期数');
    const progress = page.getByTestId('cycle-current-action');
    await expect(progress).toContainText('目标完成');
    await expect(progress).toContainText('0/101');
    await expect(progress).not.toContainText('参与任务');

    const record = page.getByTestId('cycle-participant-record');
    await expect(record).toContainText('人员与发起记录');
    await expect(record).toContainText('发起时已锁定');
    await expect(record).toContainText('范围人数109');
    await expect(record).toContainText('正常参与101');
    await expect(record).toContainText('已豁免8');

    await page.getByTestId('participant-filter-exempted').click();
    await expect(record).toContainText('方园');
    await expect(record).toContainText('人事组');
    await expect(record).toContainText('HR 按部门设置为本周期豁免');
    await expect(record).not.toContainText('陈晨');
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
    await expect(page.getByTestId('cycle-create-save-draft')).toHaveText('保存草稿');
    await expect(page.getByTestId('cycle-create-save-and-view')).toHaveText('下一步');
    await expect(page.getByRole('dialog', { name: '创建绩效周期' }).getByRole('button', { name: '提交', exact: true })).toHaveCount(0);
  });

  test('submits a new cycle into its detail and automatically expands the read-only participant preview', async ({ page }) => {
    const createBodies: unknown[] = [];
    const preflightRequests: string[] = [];
    await mockCyclePage(page, [], {
      createBodies,
      preflightRequests,
      preflight: blockedPreflight,
    });
    await page.goto('/cycles?group=attention');

    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-create-save-and-view').click();

    await expect(page).toHaveURL(/cycleId=cycle-draft/);
    expect(createBodies).toHaveLength(1);
    await expect.poll(() => preflightRequests).toEqual(['cycle-draft']);
    const participantDetails = page.getByTestId('cycle-preflight-details');
    await expect(participantDetails).toHaveAttribute('open', '');
    await expect(participantDetails).toContainText('林晓');
    await expect(participantDetails).toContainText('销售部');
    await expect(participantDetails).toContainText('周强');
    await expect(page.getByTestId('participant-filter-all')).toBeVisible();
    await expect(page.getByTestId('participant-search')).toBeVisible();
    await expect(page.getByRole('button', { name: '开始发起', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '预约发起', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '开始发起检查', exact: true })).toHaveCount(0);
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

  test('keeps edit in the header and both launch actions in the current task panel', async ({ page }) => {
    await mockCyclePage(page);
    await page.goto('/cycles?group=attention&cycleId=cycle-draft');

    const actions = page.locator('.cycle-workspace__header-actions');
    await expect(actions.getByRole('button', { name: '编辑', exact: true })).toBeVisible();
    await expect(page.getByTestId('cycle-workspace-submit')).toHaveCount(0);
    const controlBar = page.getByTestId('cycle-preflight-control-bar');
    await expect(controlBar).toContainText('点击发起操作后，系统会先检查周期审核、参与人员、直属上级和时间计划');
    const launchActions = controlBar.getByTestId('cycle-preflight-primary-action');
    await expect(launchActions.getByRole('button', { name: '开始发起', exact: true })).toBeVisible();
    await expect(launchActions.getByRole('button', { name: '预约发起', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '开始发起检查', exact: true })).toHaveCount(0);
    await expect(actions.getByRole('button', { name: '查看全部设置', exact: true })).toHaveCount(0);
    await expect(actions.getByRole('button', { name: '周期更多操作', exact: true })).toHaveCount(0);
  });

  test('keeps both launch actions anchored after a blocked launch check', async ({ page }) => {
    const preflightRequests: string[] = [];
    const launchRequests: string[] = [];
    const scheduleRequests: string[] = [];
    await mockCyclePage(page, [], {
      preflightRequests,
      launchRequests,
      scheduleRequests,
      preflight: blockedPreflight,
    });
    await page.goto('/cycles?group=attention&cycleId=cycle-draft');

    const actionSlot = page.getByTestId('cycle-preflight-primary-action');
    const before = await actionSlot.boundingBox();
    await actionSlot.getByRole('button', { name: '开始发起', exact: true }).click();

    await expect.poll(() => preflightRequests).toEqual(['cycle-draft', 'cycle-draft']);
    await expect(page.getByText('请先处理阻断项')).toBeVisible();
    await expect(actionSlot.getByRole('button', { name: '开始发起', exact: true })).toBeVisible();
    await expect(actionSlot.getByRole('button', { name: '预约发起', exact: true })).toBeVisible();
    const after = await actionSlot.boundingBox();
    expect(after?.x).toBeCloseTo(before?.x ?? 0, 0);
    expect(after?.y).toBeCloseTo(before?.y ?? 0, 0);
    expect(after?.width).toBeCloseTo(before?.width ?? 0, 0);
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
    const currentTask = page.getByTestId('cycle-current-action');
    const preflightPanel = page.getByTestId('cycle-preflight-panel');
    await expect(preflightPanel).toContainText('点击发起操作后，系统会先检查周期审核、参与人员、直属上级和时间计划');
    await expect(currentTask).not.toContainText('直属主管');
    await expect(currentTask).not.toContainText('绩效模板');
    await expect(currentTask).not.toContainText('时间设置');
    await page.getByRole('button', { name: '开始发起', exact: true }).click();

    await expect(page.getByTestId('cycle-preflight-blockers')).toContainText('1 名员工未匹配到考核模板');
    await expect(page.getByText('TEMPLATE_UNCOVERED')).toHaveCount(0);
    await expect(page.getByText('林晓')).toBeVisible();
    await page.getByRole('button', { name: '去配置考核模板' }).click();
    await expect(page).toHaveURL((url) => (
      url.pathname === '/templates'
      && (url.searchParams.get('returnTo') || '').includes('/cycles?')
    ));
  });

  test('checks and confirms participant impact before starting immediately', async ({ page }) => {
    const preflightRequests: string[] = [];
    const launchRequests: string[] = [];
    const launchBodies: Record<string, unknown>[] = [];
    await mockCyclePage(page, [], {
      preflight: immediatelyOpenablePreflight,
      preflightRequests,
      launchRequests,
      launchBodies,
    });
    await page.goto('/cycles?group=attention');

    await page.getByRole('button', { name: draftCycle.name }).click();
    await page.getByRole('button', { name: '开始发起', exact: true }).click();

    await expect.poll(() => preflightRequests).toEqual(['cycle-draft', 'cycle-draft']);
    const confirmation = page.getByRole('dialog', { name: '确认发起周期' });
    await expect(confirmation).toContainText('128 名参与员工');
    await expect(confirmation).toContainText('不可撤销');
    expect(launchRequests).toEqual([]);
    await confirmation.getByRole('button', { name: '确认发起' }).click();

    await expect.poll(() => launchRequests).toEqual(['cycle-draft']);
    expect(launchBodies).toEqual([{ expectedPlanHash: 'ready-plan-hash' }]);
  });

  test('shows time order warnings and still lets HR confirm and launch', async ({ page }) => {
    const launchRequests: string[] = [];
    await mockCyclePage(page, [], {
      preflight: warningPreflight,
      launchRequests,
    });
    await page.goto('/cycles?group=attention&cycleId=cycle-draft');

    await expect(page.getByTestId('cycle-preflight-warnings'))
      .toContainText('HR校准截止不能早于最后一期主管计划完成时间');
    await expect(page.getByText('1 项时间安排需确认')).toBeVisible();
    await page.getByRole('button', { name: '开始发起', exact: true }).click();

    const confirmation = page.getByRole('dialog', { name: '确认发起周期' });
    await expect(confirmation).toContainText('1 项时间安排提醒');
    await expect(confirmation).toContainText('仍可继续发起');
    await confirmation.getByRole('button', { name: '确认发起' }).click();

    await expect.poll(() => launchRequests).toEqual(['cycle-draft']);
  });

  test('guides ordinary HR to schedule when immediate launch is too early', async ({ page }) => {
    const preflightRequests: string[] = [];
    const launchRequests: string[] = [];
    await mockCyclePage(page, [], { preflight: readyPreflight, preflightRequests, launchRequests });
    await page.goto('/cycles?group=attention');

    await page.getByRole('button', { name: draftCycle.name }).click();
    await page.getByRole('button', { name: '开始发起', exact: true }).click();

    await expect.poll(() => preflightRequests).toEqual(['cycle-draft', 'cycle-draft']);
    await expect(page.getByText('尚未到目标制定开放时间，请使用预约发起')).toBeVisible();
    expect(launchRequests).toEqual([]);
  });

  test('checks and confirms the time and participants before scheduling', async ({ page }) => {
    const preflightRequests: string[] = [];
    const scheduleRequests: string[] = [];
    const scheduleBodies: Record<string, unknown>[] = [];
    await mockCyclePage(page, [], {
      preflight: readyPreflight,
      preflightRequests,
      scheduleRequests,
      scheduleBodies,
    });
    await page.goto('/cycles?group=attention&cycleId=cycle-draft');

    await page.getByRole('button', { name: '预约发起', exact: true }).click();

    await expect.poll(() => preflightRequests).toEqual(['cycle-draft', 'cycle-draft']);
    const confirmation = page.getByRole('dialog', { name: '确认预约发起' });
    await expect(confirmation).toContainText('128 名参与员工');
    await expect(confirmation).toContainText('目标制定开放时间');
    expect(scheduleRequests).toEqual([]);
    await confirmation.getByRole('button', { name: '确认预约' }).click();

    await expect.poll(() => scheduleRequests).toEqual(['cycle-draft']);
    expect(scheduleBodies).toEqual([{ expectedPlanHash: 'ready-plan-hash' }]);
  });

  test('allows a system administrator to explain and confirm an early launch', async ({ page }) => {
    const launchRequests: string[] = [];
    const launchBodies: Record<string, unknown>[] = [];
    await mockCyclePage(page, [], {
      preflight: readyPreflight,
      launchRequests,
      launchBodies,
      authUser: {
        id: 'system-admin',
        name: '系统管理员',
        employeeNo: 'ADMIN001',
        deptId: 'hr-dept',
        deptName: '人力资源部',
        sysRole: 'system_admin',
        isAssessorOnly: false,
        canViewAll: true,
      },
    });
    await page.goto('/cycles?group=attention&cycleId=cycle-draft');

    await page.getByRole('button', { name: '开始发起', exact: true }).click();
    const reasonPrompt = page.getByRole('dialog', { name: '提前发起说明' });
    await reasonPrompt.getByRole('textbox').fill('业务安排提前启动');
    await reasonPrompt.getByRole('button', { name: '继续' }).click();
    await page.getByRole('dialog', { name: '确认发起周期' })
      .getByRole('button', { name: '确认发起' })
      .click();

    await expect.poll(() => launchRequests).toEqual(['cycle-draft']);
    expect(launchBodies).toEqual([{
      expectedPlanHash: 'ready-plan-hash',
      overrideReason: '业务安排提前启动',
    }]);
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
    await expect(page.getByTestId('cycle-create-save-and-view')).toHaveText('下一步');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: '取消' }).click();

    await page.getByTestId('cycle-compact-card-cycle-draft').click();
    await expect(page.getByTestId('cycle-workspace-back')).toBeVisible();
    await expect(page.getByTestId('cycle-current-action')).toBeVisible();
    await expect(page.getByRole('button', { name: '开始发起', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '预约发起', exact: true })).toBeVisible();
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
