import { expect, test } from '@playwright/test';
import type { Router } from 'vue-router';
import { createTasksApi, type TasksApiClient } from '../../src/api/tasks.api';
import type {
  BatchReviewResult,
  IndicatorInstance,
  IndicatorReferenceItem,
  Paginated,
  TaskDetail,
  TeamTaskPage,
} from '../../src/types/api.types';
import {
  parseTaskWorkspaceQuery,
  updateTaskWorkspaceQuery,
} from '../../src/views/task/use-task-workspace-query';

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

test.describe('team performance real API smoke', () => {
  test.use({
    baseURL: 'http://localhost:5173',
    storageState: 'e2e/auth-state/manager.json',
  });

  test('opens the API-authorized manager evaluation task without route mocking', async ({ page }) => {
    const responsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/v1/tasks/team')
      && new URL(response.url()).searchParams.get('stage') === 'manager-eval'
      && response.status() === 200
    ));
    await page.goto('/tasks?scope=team&stage=manager-eval&stageState=pending');
    const response = await (await responsePromise).json() as {
      data: { items: Array<{ id: string; cycleId: string; employeeId: string; status: string }> };
    };
    const task = response.data.items.find((item) => item.status === 'manager_scoring');
    expect(task).toBeTruthy();

    await page.goto(`/tasks?scope=team&stage=manager-eval&stageState=pending&cycleId=${task!.cycleId}&employeeId=${task!.employeeId}&taskId=${task!.id}`);
    await expect(page.getByTestId('manager-evaluation-workspace')).toBeVisible();
    await expect(page.getByTestId('team-member-rail')).toBeVisible();
  });
});

const shouldCaptureTask7Evidence = () => (
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.TASK7_CAPTURE_EVIDENCE === '1'
);

const shouldCaptureTask8Evidence = () => (
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.TASK8_CAPTURE_EVIDENCE === '1'
);

const shouldCaptureTask9Evidence = () => (
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.TASK9_CAPTURE_EVIDENCE === '1'
);

const teamPageFixture: TeamTaskPage = {
  total: 3,
  page: 1,
  pageSize: 20,
  items: [
    {
      id: 'task-1',
      cycleId: 'cycle-1',
      cycleName: '2026 H1',
      employeeId: 'employee-1',
      employeeName: 'Ada Chen',
      deptId: 'dept-1',
      deptName: 'Engineering',
      managerId: 'manager-1',
      status: 'indicator_reviewing',
      totalScore: null,
      rawGrade: null,
      updatedAt: '2026-08-09T00:00:00.000Z',
      employeeNo: 'E001',
      avatarUrl: null,
      position: 'Senior Engineer',
      stageState: 'pending',
    },
    {
      id: 'task-2',
      cycleId: 'cycle-1',
      cycleName: '2026 H1',
      employeeId: 'employee-2',
      employeeName: 'Grace Lin',
      deptId: 'dept-1',
      deptName: 'Engineering',
      managerId: 'manager-1',
      status: 'indicator_reviewing',
      totalScore: null,
      rawGrade: null,
      updatedAt: '2026-08-08T00:00:00.000Z',
      employeeNo: 'E002',
      avatarUrl: null,
      position: 'Product Manager',
      stageState: 'pending',
    },
    {
      id: 'task-3',
      cycleId: 'cycle-1',
      cycleName: '2026 H1',
      employeeId: 'employee-3',
      employeeName: 'Lin Wei',
      deptId: 'dept-2',
      deptName: 'Operations',
      managerId: 'manager-1',
      status: 'indicator_confirming',
      totalScore: null,
      rawGrade: null,
      updatedAt: '2026-08-07T00:00:00.000Z',
      employeeNo: 'E003',
      avatarUrl: null,
      position: 'Operations Lead',
      stageState: 'completed',
    },
  ],
  counts: { all: 3, notStarted: 0, pending: 2, completed: 1, exempted: 0 },
  facets: {
    departments: [
      { id: 'dept-1', name: 'Engineering' },
      { id: 'dept-2', name: 'Operations' },
    ],
    employees: [
      { id: 'employee-1', name: 'Ada Chen', employeeNo: 'E001', deptId: 'dept-1' },
      { id: 'employee-2', name: 'Grace Lin', employeeNo: 'E002', deptId: 'dept-1' },
      { id: 'employee-3', name: 'Lin Wei', employeeNo: 'E003', deptId: 'dept-2' },
    ],
  },
};

const offPageTaskFixture: TaskDetail = {
  id: 'task-off-page',
  cycleId: 'cycle-1',
  cycleName: '2026 H1',
  snapshotId: 'snapshot-1',
  employeeId: 'employee-off-page',
  employeeName: 'Off Page Member',
  deptId: 'dept-2',
  deptName: 'Operations',
  managerId: 'manager-1',
  status: 'indicator_reviewing',
  isExempt: false,
  updatedAt: '2026-08-06T00:00:00.000Z',
  indicatorInstances: [],
};

const goalReviewDetailFixture: TaskDetail = {
  id: 'task-1',
  cycleId: 'cycle-1',
  cycleName: '2026 H1',
  snapshotId: 'snapshot-1',
  employeeId: 'employee-1',
  employeeName: 'Ada Chen',
  employeeNo: 'E001',
  deptId: 'dept-1',
  deptName: 'Engineering',
  managerId: 'manager-1',
  status: 'indicator_reviewing',
  isExempt: false,
  updatedAt: '2026-08-09T00:00:00.000Z',
  indicatorInstances: [
    {
      id: 'ind-1',
      taskId: 'task-1',
      name: 'Delivery quality',
      description: 'Ship the customer portal without critical defects.',
      scoringStandard: 'Accepted on schedule',
      dataSource: 'Release report',
      dataCaliber: 'Production release',
      targetValue: 1,
      unit: 'release',
      weight: 0.6,
      indicatorType: 'kpi',
      dimensionName: 'Delivery',
      dimensionWeight: 1,
      sortOrder: 0,
      visibilityScope: 'supervisors',
      visibleDepartmentIds: [],
      visibleUserIds: [],
      alignedObjectives: [
        { id: 'objective-1', title: 'Launch the customer portal', level: 'company', ownerId: null },
      ],
    },
    {
      id: 'ind-2',
      taskId: 'task-1',
      name: 'Team enablement',
      description: 'Improve delivery playbooks for the engineering team.',
      scoringStandard: 'Two adopted playbooks',
      dataSource: 'Team review',
      dataCaliber: 'Adopted documents',
      targetValue: 2,
      unit: 'playbooks',
      weight: 0.4,
      indicatorType: 'kpi',
      dimensionName: 'Collaboration',
      dimensionWeight: 1,
      sortOrder: 1,
      visibilityScope: 'department',
      visibleDepartmentIds: [],
      visibleUserIds: [],
      alignedObjectives: [],
    },
  ],
  flowRecords: [
    {
      id: 'flow-1',
      taskId: 'task-1',
      cycleId: 'cycle-1',
      nodeType: 'indicator_setting',
      actorId: 'employee-1',
      actorName: 'Ada Chen',
      action: 'submit',
      comment: 'Ready for review',
      extraData: { type: 'indicator_employee_submitted', count: 2 },
      createdAt: '2026-08-09T08:00:00.000Z',
    },
  ],
};

const referenceIndicatorFixture: Paginated<IndicatorReferenceItem> = {
  total: 1,
  page: 1,
  pageSize: 20,
  items: [
    {
      id: 'reference-1',
      taskId: 'task-reference',
      cycleId: 'cycle-1',
      employeeId: 'employee-1',
      employeeName: 'Ada Chen',
      name: 'Prior delivery target',
      weight: 0.5,
      visibilityScope: 'supervisors',
    },
  ],
};

function graceGoalReviewDetail(): TaskDetail {
  const detail = structuredClone(goalReviewDetailFixture);
  detail.id = 'task-2';
  detail.employeeId = 'employee-2';
  detail.employeeName = 'Grace Lin';
  detail.employeeNo = 'E002';
  detail.indicatorInstances = detail.indicatorInstances.map((indicator, index) => ({
    ...indicator,
    id: `task-2-ind-${index + 1}`,
    taskId: 'task-2',
    name: index === 0 ? 'Grace delivery target' : indicator.name,
  }));
  return detail;
}

function managerEvaluationDetail(
  status: TaskDetail['status'] = 'manager_scoring',
  options: { managerScoredAt?: string; id?: string; employeeName?: string } = {},
): TaskDetail {
  const detail = structuredClone(goalReviewDetailFixture);
  detail.id = options.id ?? 'task-2';
  detail.employeeId = detail.id === 'task-1' ? 'employee-1' : 'employee-2';
  detail.employeeName = options.employeeName ?? (detail.id === 'task-1' ? 'Ada Chen' : 'Grace Lin');
  detail.employeeNo = detail.id === 'task-1' ? 'E001' : 'E002';
  detail.status = status;
  detail.updatedAt = '2026-08-09T01:00:00.000Z';
  detail.managerScoredAt = options.managerScoredAt;
  detail.indicatorInstances = detail.indicatorInstances.map((indicator, index) => ({
    ...indicator,
    taskId: detail.id,
    id: `ind-${index + 1}`,
    actualValue: index === 0 ? 'Released on schedule' : '2 playbooks adopted',
    actualNote: index === 0 ? 'No critical production defects' : 'Reviewed by the team',
    selfScore: index === 0 ? 86 : 91,
    selfComment: index === 0 ? 'Delivered the planned release and resolved launch risks.' : 'Shared both playbooks.',
    managerScore: status === 'manager_scoring' ? undefined : index === 0 ? 88 : 90,
    managerComment: status === 'manager_scoring' ? undefined : 'Results verified with the delivery record.',
    extraScores: status === 'manager_scoring' ? [] : [{ label: 'Cross-team support', value: 1 }],
  }));
  detail.selfEvalSummary = {
    taskId: detail.id,
    achievements: 'Completed the portal release and improved delivery routines.',
    improvements: 'Escalate cross-team dependencies earlier.',
    suggestions: 'Keep the weekly release review.',
    nextGoals: 'Improve customer adoption.',
    supportNeeded: 'Analytics support.',
    attachments: [{ name: 'self-review.pdf', url: '/files/self-review.pdf' }],
    submittedAt: '2026-08-09T00:30:00.000Z',
  };
  detail.managerEvalSummary = status === 'manager_scoring'
    ? { taskId: detail.id, strengths: '', improvements: '', developmentPlan: '', attachments: [] }
    : {
        taskId: detail.id,
        strengths: 'Reliable delivery ownership.',
        improvements: 'Escalate dependencies earlier.',
        developmentPlan: 'Lead the next cross-team release.',
        attachments: [],
        submittedAt: '2026-08-09T01:10:00.000Z',
      };
  if (status !== 'manager_scoring') {
    detail.gradeResult = {
      taskId: detail.id,
      calculatedScore: 89.2,
      rawGrade: 'B',
      isVeto: false,
      isPublished: false,
    };
  }
  return detail;
}

function managerEvaluationTeamPage(details: TaskDetail[]): TeamTaskPage {
  const items = details.map((detail) => ({
    id: detail.id,
    cycleId: detail.cycleId,
    cycleName: detail.cycleName ?? '-',
    employeeId: detail.employeeId,
    employeeName: detail.employeeName ?? '-',
    deptId: detail.deptId ?? null,
    deptName: detail.deptName ?? null,
    managerId: detail.managerId ?? null,
    status: detail.status,
    totalScore: detail.gradeResult?.calculatedScore ?? null,
    rawGrade: detail.gradeResult?.rawGrade ?? null,
    updatedAt: detail.updatedAt ?? '',
    employeeNo: detail.employeeNo ?? null,
    avatarUrl: null,
    position: detail.id === 'task-1' ? 'Senior Engineer' : 'Product Manager',
    stageState: detail.status === 'manager_scoring' ? 'pending' as const : 'completed' as const,
  }));
  return {
    ...teamPageWith(items),
    facets: teamPageFixture.facets,
    counts: {
      all: items.length,
      notStarted: 0,
      pending: items.filter((item) => item.stageState === 'pending').length,
      completed: items.filter((item) => item.stageState === 'completed').length,
      exempted: 0,
    },
  };
}

interface ManagerEvaluationMockOptions {
  details?: TaskDetail[];
  draftGate?: Promise<void>;
  submitGate?: Promise<void>;
  withdrawError?: string;
  draftRefreshError?: string;
  withdrawRefreshError?: string;
}

async function mockManagerEvaluationWorkspace(
  page: import('@playwright/test').Page,
  options: ManagerEvaluationMockOptions = {},
) {
  await mockTaskWorkspaceIdentity(page, 'manager');
  const initialDetails = options.details ?? [managerEvaluationDetail()];
  const details = new Map(initialDetails.map((detail) => [detail.id, structuredClone(detail)]));
  const draftBodies: unknown[] = [];
  const submitBodies: unknown[] = [];
  const withdrawBodies: unknown[] = [];
  const pendingDetailErrors = new Map<string, string>();
  let draftRefreshError = options.draftRefreshError;
  let withdrawRefreshError = options.withdrawRefreshError;
  let version = 1;

  const advanceVersion = (detail: TaskDetail) => {
    version += 1;
    detail.updatedAt = `2026-08-09T01:00:${String(version).padStart(2, '0')}.000Z`;
  };
  const taskIdFromUrl = (url: string) => new URL(url).pathname.split('/tasks/')[1]?.split('/')[0] ?? '';

  await page.route('**/api/v1/tasks/team**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(managerEvaluationTeamPage([...details.values()]))),
    });
  });
  await page.route('**/api/v1/tasks/*/manager-evaluation-draft', async (route) => {
    const body = route.request().postDataJSON() as {
      indicators: Array<{ id: string; managerScore?: number | null; managerComment?: string | null; extraScores?: Array<{ label: string; value: number }> }>;
      evalSummary: TaskDetail['managerEvalSummary'];
    };
    draftBodies.push(body);
    if (options.draftGate) await options.draftGate;
    const taskId = taskIdFromUrl(route.request().url());
    const detail = details.get(taskId)!;
    for (const item of body.indicators) {
      const indicator = detail.indicatorInstances.find((candidate) => candidate.id === item.id)!;
      indicator.managerScore = item.managerScore ?? undefined;
      indicator.managerComment = item.managerComment ?? undefined;
      indicator.extraScores = item.extraScores ?? [];
    }
    detail.managerEvalSummary = { taskId, ...body.evalSummary };
    advanceVersion(detail);
    if (draftRefreshError) {
      pendingDetailErrors.set(taskId, draftRefreshError);
      draftRefreshError = undefined;
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        id: taskId,
        status: 'manager_scoring',
        updatedAt: detail.updatedAt,
      })),
    });
  });
  await page.route('**/api/v1/tasks/*/manager-score/withdraw', async (route) => {
    const body = route.request().postDataJSON();
    withdrawBodies.push(body);
    if (options.withdrawError) {
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'CONFLICT', message: options.withdrawError, data: null }),
      });
    }
    const taskId = taskIdFromUrl(route.request().url());
    const detail = details.get(taskId)!;
    detail.status = 'manager_scoring';
    detail.managerScoredAt = undefined;
    if (detail.managerEvalSummary) detail.managerEvalSummary.submittedAt = undefined;
    advanceVersion(detail);
    if (withdrawRefreshError) {
      pendingDetailErrors.set(taskId, withdrawRefreshError);
      withdrawRefreshError = undefined;
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        id: taskId,
        status: 'manager_scoring',
        updatedAt: detail.updatedAt,
      })),
    });
  });
  await page.route('**/api/v1/tasks/*/manager-score', async (route) => {
    const body = route.request().postDataJSON() as {
      indicators: Array<{ id: string; managerScore: number; managerComment?: string; extraScores?: Array<{ label: string; value: number }> }>;
      evalSummary: TaskDetail['managerEvalSummary'];
    };
    submitBodies.push(body);
    if (options.submitGate) await options.submitGate;
    const taskId = taskIdFromUrl(route.request().url());
    const detail = details.get(taskId)!;
    for (const item of body.indicators) {
      const indicator = detail.indicatorInstances.find((candidate) => candidate.id === item.id)!;
      indicator.managerScore = item.managerScore;
      indicator.managerComment = item.managerComment;
      indicator.extraScores = item.extraScores ?? [];
      indicator.finalScore = item.managerScore + (item.extraScores?.reduce((sum, extra) => sum + extra.value, 0) ?? 0);
    }
    detail.managerEvalSummary = {
      taskId,
      ...body.evalSummary,
      submittedAt: '2026-08-09T01:10:00.000Z',
    };
    detail.status = 'dept_review';
    detail.managerScoredAt = '2026-08-09T01:10:00.000Z';
    detail.gradeResult = {
      taskId,
      calculatedScore: 89.2,
      rawGrade: 'B',
      isVeto: false,
      isPublished: false,
    };
    advanceVersion(detail);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ id: taskId, status: 'dept_review', updatedAt: detail.updatedAt })),
    });
  });
  await page.route('**/api/v1/tasks/*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const taskId = taskIdFromUrl(route.request().url());
    if (taskId === 'team') return route.fallback();
    const detailError = pendingDetailErrors.get(taskId);
    if (detailError) {
      pendingDetailErrors.delete(taskId);
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'DETAIL_REFRESH_FAILED', message: detailError, data: null }),
      });
    }
    const detail = details.get(taskId);
    if (!detail) return route.fulfill({ status: 404, body: JSON.stringify({ message: 'Task not found' }) });
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(structuredClone(detail))),
    });
  });

  return { details, draftBodies, submitBodies, withdrawBodies };
}

function teamPageWith(
  items: TeamTaskPage['items'],
  options: { page?: number; total?: number } = {},
): TeamTaskPage {
  return {
    ...teamPageFixture,
    page: options.page ?? 1,
    total: options.total ?? items.length,
    items,
    counts: {
      all: options.total ?? items.length,
      notStarted: 0,
      pending: options.total ?? items.length,
      completed: 0,
      exempted: 0,
    },
  };
}

async function mockTaskWorkspaceIdentity(page: import('@playwright/test').Page, sysRole: 'manager' | 'employee') {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: `${sysRole}-1`,
      name: sysRole === 'manager' ? 'Test Manager' : 'Test Employee',
      deptId: 'dept-1',
      deptName: 'Engineering',
      sysRole,
      isAssessorOnly: false,
      canViewAll: false,
    })),
  }));
  await page.route('**/api/v1/cycles**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      total: 1,
      page: 1,
      pageSize: 50,
      items: [{
        id: 'cycle-1',
        name: '2026 H1',
        type: 'semi_annual',
        status: 'in_progress',
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      }],
    })),
  }));
  await page.route('**/api/v1/tasks/mine**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 100, items: [] })),
  }));
}

async function mockGoalReviewWorkspace(
  page: import('@playwright/test').Page,
  detail: TaskDetail = goalReviewDetailFixture,
) {
  await mockTaskWorkspaceIdentity(page, 'manager');
  await page.route('**/api/v1/tasks/reference-indicators**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(referenceIndicatorFixture)),
  }));
  await page.route(`**/api/v1/tasks/${detail.id}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(detail)),
    });
  });
  await page.route('**/api/v1/tasks/team**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(teamPageWith([teamPageFixture.items[0]]))),
    });
  });
}

test.describe('team list manager workspace', () => {
  test.use({
    baseURL: 'http://localhost:5173',
    storageState: 'e2e/auth-state/manager.json',
  });

  test('team list exposes filters, counts, and selected member URL state', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    await page.route('**/api/v1/tasks/team**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(teamPageFixture)),
    }));

    await page.goto('/tasks?scope=team&stage=goal-review&cycleId=cycle-1');

    await expect(page.getByTestId('task-scope-team')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('team-count-pending')).toContainText('2');
    await expect(page.getByTestId('team-department-filter')).toBeVisible();
    await expect(page.getByTestId('team-employee-filter')).toBeVisible();
    await page.getByTestId('team-task-row-task-1').click();
    await expect(page).toHaveURL(/taskId=task-1/);
    await expect(page.getByTestId('team-member-rail')).toContainText('Ada Chen');
  });

  test('team list applies URL filters and limits batch commands to pending goal reviews', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    const teamRequests: URL[] = [];
    await page.route('**/api/v1/tasks/team**', (route) => {
      teamRequests.push(new URL(route.request().url()));
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageFixture)),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&cycleId=cycle-1');
    await page.getByTestId('team-count-pending').click();

    await expect(page).toHaveURL(/stageState=pending/);
    await expect(page.getByTestId('team-batch-approve')).toBeDisabled();
    await expect(page.getByTestId('team-batch-reject')).toBeDisabled();

    const adaRow = page.getByRole('row').filter({ hasText: 'Ada Chen' });
    await adaRow.locator('.el-checkbox').click();
    await expect(page.getByTestId('team-batch-approve')).toBeEnabled();
    await expect(page.getByTestId('team-batch-reject')).toBeEnabled();

    await page.getByTestId('team-keyword-filter').fill('Ada');
    await page.getByTestId('team-keyword-filter').press('Enter');
    await expect(page).toHaveURL(/keyword=Ada/);
    await expect
      .poll(() => teamRequests[teamRequests.length - 1]?.searchParams.get('keyword'))
      .toBe('Ada');

    await page.locator('.team-stage-tabs').getByRole('button', { name: '主管评分' }).click();
    await expect(page).toHaveURL(/stage=manager-eval/);
    await expect(page.getByTestId('team-batch-approve')).toHaveCount(0);
    await expect
      .poll(() => teamRequests[teamRequests.length - 1]?.searchParams.get('stage'))
      .toBe('manager-eval');
  });

  test('selection is page-local and clears on search, department, employee, cycle, and page changes', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    const requests: URL[] = [];
    await page.route('**/api/v1/tasks/team**', (route) => {
      const url = new URL(route.request().url());
      requests.push(url);
      const pageNumber = Number(url.searchParams.get('page') || 1);
      const items = pageNumber === 2 ? [teamPageFixture.items[2]] : teamPageFixture.items.slice(0, 2);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageWith(items, { page: pageNumber, total: 21 }))),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending');

    await expect(page.getByRole('combobox', { name: '考核周期' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '部门' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '员工' })).toBeVisible();
    await expect(page.getByLabel('搜索姓名或工号')).toBeVisible();

    const selectAda = async () => {
      await page.getByRole('row').filter({ hasText: 'Ada Chen' }).locator('.el-checkbox').click();
      await expect(page.getByTestId('team-selected-count')).toContainText('1');
    };

    await selectAda();
    await page.getByRole('button', { name: '主管评分', exact: true }).click();
    await expect(page).toHaveURL(/stage=manager-eval/);
    await expect(page.getByTestId('team-batch-approve')).toHaveCount(0);
    await page.getByRole('button', { name: '指标审核', exact: true }).click();
    await page.getByTestId('team-count-pending').click();
    await expect(page.getByTestId('team-batch-approve')).toBeDisabled();

    await selectAda();
    await page.getByLabel('搜索姓名或工号').fill('Ada');
    await page.getByLabel('搜索姓名或工号').press('Enter');
    await expect(page.getByTestId('team-batch-approve')).toBeDisabled();

    await page.getByRole('combobox', { name: '部门' }).click();
    await page.getByRole('option', { name: 'Engineering', exact: true }).click();
    await expect(page).toHaveURL(/deptId=dept-1/);
    await expect(page.getByTestId('team-batch-approve')).toBeDisabled();

    await page.getByRole('combobox', { name: '员工' }).click();
    await page.getByRole('option', { name: /Ada Chen/ }).click();
    await expect(page).toHaveURL(/employeeId=employee-1/);

    await page.getByTestId('team-cycle-filter').click();
    await page.getByRole('option', { name: '2026 H1', exact: true }).click();
    await expect(page).toHaveURL(/cycleId=cycle-1/);
    await selectAda();
    await page.getByTestId('team-count-completed').click();
    await expect(page.getByTestId('team-batch-approve')).toHaveCount(0);
    await page.getByTestId('team-count-pending').click();
    await expect(page.getByTestId('team-batch-approve')).toBeDisabled();

    await page.getByTestId('team-keyword-filter').fill('');
    await page.getByTestId('team-keyword-filter').press('Enter');
    await page.getByTestId('team-department-filter').click();
    await page.getByRole('option', { name: '全部部门', exact: true }).click();
    await page.getByTestId('team-employee-filter').click();
    await page.getByRole('option', { name: '全部员工', exact: true }).click();
    await selectAda();
    await page.locator('.team-task-list__footer .btn-next').click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByTestId('team-task-row-task-3')).toBeVisible();
    await expect(page.getByTestId('team-batch-approve')).toBeDisabled();
    await expect.poll(() => requests[requests.length - 1]?.searchParams.get('page')).toBe('2');
  });

  test('partial batch result clears succeeded rows and preserves visible failed rows', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    let afterBatch = false;
    let batchAttempt = 0;
    await page.route('**/api/v1/tasks/team/indicator-review/batch-approve', (route) => {
      batchAttempt += 1;
      afterBatch = true;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(batchAttempt === 1 ? {
          succeeded: [{ taskId: 'task-1', status: 'indicator_confirming' }],
          failed: [{ taskId: 'task-2', reason: '任务已被其他操作更新' }],
        } : {
          succeeded: [{ taskId: 'task-2', status: 'indicator_confirming' }],
          failed: [],
        })),
      });
    });
    await page.route('**/api/v1/tasks/team**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageWith(
          afterBatch ? [teamPageFixture.items[1]] : teamPageFixture.items.slice(0, 2),
        ))),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending');
    await page.getByRole('row').filter({ hasText: 'Ada Chen' }).locator('.el-checkbox').click();
    await page.getByRole('row').filter({ hasText: 'Grace Lin' }).locator('.el-checkbox').click();
    await page.getByTestId('team-batch-approve').click();
    await page.getByRole('button', { name: '通过', exact: true }).click();

    const result = page.getByTestId('team-batch-result');
    await expect(result.getByTestId('team-batch-succeeded')).toContainText('Ada Chen');
    await expect(result.getByTestId('team-batch-failed')).toContainText('Grace Lin');
    await expect(result.getByTestId('team-batch-failed')).toContainText('任务已被其他操作更新');
    await expect(page.getByTestId('team-selected-count')).toContainText('1');
    await expect(page.getByRole('row').filter({ hasText: 'Grace Lin' }).locator('.el-checkbox')).toBeChecked();

    await page.getByTestId('team-batch-approve').click();
    await page.getByRole('button', { name: '通过', exact: true }).click();
    await expect(page.getByTestId('team-batch-result')).toContainText('成功 1 项');
    await expect(page.getByTestId('team-batch-approve')).toBeDisabled();
  });

  test('total and HTTP batch failures remain selected and never report zero success', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    let batchAttempt = 0;
    await page.route('**/api/v1/tasks/team/indicator-review/batch-approve', (route) => {
      batchAttempt += 1;
      if (batchAttempt === 1) {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(apiResponse({
            succeeded: [],
            failed: [{ taskId: 'task-1', reason: '版本冲突' }],
          })),
        });
      }
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 503, message: '审核服务不可用', data: null, timestamp: Date.now() }),
      });
    });
    await page.route('**/api/v1/tasks/team**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageWith([teamPageFixture.items[0]]))),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending');
    await page.getByRole('row').filter({ hasText: 'Ada Chen' }).locator('.el-checkbox').click();
    await page.getByTestId('team-batch-approve').click();
    await page.getByRole('button', { name: '通过', exact: true }).click();
    await expect(page.getByTestId('team-batch-result')).toContainText('版本冲突');
    await expect(page.getByTestId('team-selected-count')).toContainText('1');
    await expect(page.locator('.el-message--success')).toHaveCount(0);
    await expect(page.locator('.el-message--error')).toBeVisible();

    await page.getByTestId('team-batch-approve').click();
    await page.getByRole('button', { name: '通过', exact: true }).click();
    await expect(page.getByTestId('team-batch-result')).toContainText('审核服务不可用');
    await expect(page.getByTestId('team-selected-count')).toContainText('1');
    await expect(page.locator('.el-message--success')).toHaveCount(0);
  });

  test('latest team request wins when an older response finishes last', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    let releaseFirst: (() => void) | undefined;
    const firstRequest = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    await page.route('**/api/v1/tasks/team**', async (route) => {
      const url = new URL(route.request().url());
      if (!url.searchParams.get('keyword')) {
        await firstRequest;
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(apiResponse(teamPageWith([teamPageFixture.items[0]]))),
        });
      }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageWith([teamPageFixture.items[1]]))),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending');
    await page.getByTestId('team-keyword-filter').fill('Grace');
    await page.getByTestId('team-keyword-filter').press('Enter');
    await expect(page.getByTestId('team-task-row-task-2')).toBeVisible();
    releaseFirst?.();
    await page.waitForTimeout(100);
    await expect(page.getByTestId('team-task-row-task-2')).toBeVisible();
    await expect(page.getByTestId('team-task-row-task-1')).toHaveCount(0);
  });

  test('deep-link refresh safely hydrates a selected task outside the current page', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    await page.route('**/api/v1/tasks/task-off-page', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(offPageTaskFixture)),
    }));
    await page.route('**/api/v1/tasks/team**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(teamPageWith([teamPageFixture.items[0]], { total: 21 }))),
    }));

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-off-page&page=2');
    await expect(page.getByTestId('team-member-rail')).toContainText('Off Page Member');
    await page.reload();
    await expect(page.getByTestId('team-member-rail')).toContainText('Off Page Member');
    await expect(page).toHaveURL(/taskId=task-off-page/);
  });

  test('current-page deep link remains loading until the delayed team response resolves', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    let releaseTeam!: () => void;
    const teamGate = new Promise<void>((resolve) => {
      releaseTeam = resolve;
    });
    await page.route('**/api/v1/tasks/team**', async (route) => {
      await teamGate;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageWith([teamPageFixture.items[0]]))),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-1');
    const rail = page.getByTestId('team-member-rail');
    await expect(rail.locator('.el-skeleton')).toBeVisible();
    await expect(rail.getByText('未找到所选成员')).toHaveCount(0);
    await expect(rail.getByText('成员详情加载失败')).toHaveCount(0);

    releaseTeam();
    await expect(rail).toContainText('Ada Chen');
    await expect(rail.locator('.el-skeleton')).toHaveCount(0);
    await expect(rail.getByText('未找到所选成员')).toHaveCount(0);
    await expect(rail.getByText('成员详情加载失败')).toHaveCount(0);
  });

  test('off-page deep link stays loading through delayed hydration and renders only its error', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    let releaseTeam!: () => void;
    let releaseDetail!: () => void;
    let markDetailStarted!: () => void;
    const teamGate = new Promise<void>((resolve) => {
      releaseTeam = resolve;
    });
    const detailGate = new Promise<void>((resolve) => {
      releaseDetail = resolve;
    });
    const detailStarted = new Promise<void>((resolve) => {
      markDetailStarted = resolve;
    });
    await page.route('**/api/v1/tasks/task-off-page', async (route) => {
      markDetailStarted();
      await detailGate;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 503, message: '成员详情服务不可用', data: null, timestamp: Date.now() }),
      });
    });
    await page.route('**/api/v1/tasks/team**', async (route) => {
      await teamGate;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageWith([teamPageFixture.items[0]], { total: 21 }))),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-off-page');
    const rail = page.getByTestId('team-member-rail');
    await expect(rail.locator('.el-skeleton')).toBeVisible();
    await expect(rail.getByText('未找到所选成员')).toHaveCount(0);

    releaseTeam();
    await detailStarted;
    await expect(rail.locator('.el-skeleton')).toBeVisible();
    await expect(rail.getByText('未找到所选成员')).toHaveCount(0);

    releaseDetail();
    await expect(rail.getByText('成员详情加载失败')).toBeVisible();
    await expect(rail).toContainText('成员详情服务不可用');
    await expect(rail.locator('.el-skeleton')).toHaveCount(0);
    await expect(rail.getByText('未找到所选成员')).toHaveCount(0);
  });

  test('off-page not-found appears only after successful empty hydration settles', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    let releaseDetail!: () => void;
    const detailGate = new Promise<void>((resolve) => {
      releaseDetail = resolve;
    });
    await page.route('**/api/v1/tasks/task-missing', async (route) => {
      await detailGate;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(null)),
      });
    });
    await page.route('**/api/v1/tasks/team**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(teamPageWith([teamPageFixture.items[0]], { total: 21 }))),
    }));

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-missing');
    const rail = page.getByTestId('team-member-rail');
    await expect(rail.locator('.el-skeleton')).toBeVisible();
    await expect(rail.getByText('未找到所选成员')).toHaveCount(0);
    await expect(rail.getByText('成员详情加载失败')).toHaveCount(0);

    releaseDetail();
    await expect(rail.getByText('未找到所选成员')).toBeVisible();
    await expect(rail.locator('.el-skeleton')).toHaveCount(0);
    await expect(rail.getByText('成员详情加载失败')).toHaveCount(0);
  });

  test('returned page is canonicalized and error state excludes empty state', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    let shouldFail = false;
    await page.route('**/api/v1/tasks/team**', (route) => {
      if (shouldFail) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ code: 500, message: '团队任务不可用', data: null, timestamp: Date.now() }),
        });
      }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageWith([teamPageFixture.items[2]], { page: 2, total: 21 }))),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&page=99');
    await expect(page).toHaveURL(/page=2/);
    shouldFail = true;
    await page.getByTestId('team-keyword-filter').fill('failure');
    await page.getByTestId('team-keyword-filter').press('Enter');
    await expect(page.getByText('团队任务加载失败')).toBeVisible();
    await expect(page.getByTestId('team-task-empty')).toHaveCount(0);
  });

  test('goal review keeps rows compact, edits all visibility scopes, and uses scoped references', async ({ page }) => {
    const referenceRequests: URL[] = [];
    let savedBody: Record<string, unknown> | undefined;
    await mockGoalReviewWorkspace(page);
    page.on('request', (request) => {
      if (request.url().includes('/tasks/reference-indicators')) {
        referenceRequests.push(new URL(request.url()));
      }
    });
    await page.route('**/api/v1/tasks/task-1/indicators', (route) => {
      savedBody = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          ...goalReviewDetailFixture,
          updatedAt: '2026-08-09T00:00:01.000Z',
        })),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-1');

    await expect(page.getByTestId('goal-review-workspace')).toBeVisible();
    await expect(page.getByTestId('indicator-details-ind-1')).toBeHidden();
    const disclosure = page.getByTestId('indicator-toggle-ind-1');
    const disclosureName = page.getByTestId('indicator-name-ind-1');
    const disclosureRegion = page.getByTestId('indicator-details-ind-1');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(disclosureName).toHaveAttribute('aria-expanded', 'false');
    const disclosureRegionId = await disclosureRegion.getAttribute('id');
    const disclosureNameId = await disclosureName.getAttribute('id');
    expect(disclosureRegionId).toBeTruthy();
    expect(disclosureNameId).toBeTruthy();
    await expect(disclosure).toHaveAttribute('aria-controls', disclosureRegionId!);
    await expect(disclosureName).toHaveAttribute('aria-controls', disclosureRegionId!);
    await expect(disclosureRegion).toHaveAttribute('role', 'region');
    await expect(disclosureRegion).toHaveAttribute('aria-labelledby', disclosureNameId!);
    await page.getByTestId('indicator-toggle-ind-1').click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(disclosureName).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('indicator-details-ind-1')).toBeVisible();
    await page.getByTestId('indicator-expand-all').click();
    await expect(page.getByTestId('indicator-details-ind-2')).toBeVisible();

    await page.getByTestId('indicator-visibility-ind-1').click();
    for (const label of [
      '全公司可见',
      '部门内可见',
      '部门及下级可见',
      '直接下级可见',
      '所有下级可见',
      '仅上级可见',
      '自定义范围',
    ]) {
      await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
    }
    await page.getByRole('option', { name: '自定义范围', exact: true }).click();
    await page.getByTestId('visibility-departments').click();
    await page.getByRole('option', { name: 'Engineering', exact: true }).click();
    await page.getByTestId('visibility-users').click();
    await page.getByRole('option', { name: /Ada Chen/ }).click();
    await expect(page.getByTestId('visibility-department-count')).toContainText('1');
    await expect(page.getByTestId('visibility-user-count')).toContainText('1');

    const objectiveTab = page.getByRole('tab', { name: '对齐目标' });
    const historyTab = page.getByRole('tab', { name: '流程历史' });
    const objectivePanel = page.getByTestId('reference-aligned-objectives');
    const historyPanel = page.getByTestId('reference-flow-history');
    await expect(page.getByRole('tablist', { name: '参考信息' })).toBeVisible();
    await expect(objectiveTab).toHaveAttribute('aria-selected', 'true');
    await expect(objectiveTab).toHaveAttribute('tabindex', '0');
    await expect(historyTab).toHaveAttribute('aria-selected', 'false');
    await expect(historyTab).toHaveAttribute('tabindex', '-1');
    await expect(objectivePanel).toHaveAttribute('role', 'tabpanel');
    await expect(objectivePanel).toHaveAttribute('aria-labelledby', await objectiveTab.getAttribute('id') ?? '');
    await expect(objectiveTab).toHaveAttribute('aria-controls', await objectivePanel.getAttribute('id') ?? '');
    await expect(objectivePanel).toContainText('Launch the customer portal');
    await expect(page.getByTestId('reference-indicator-picker')).toContainText('Prior delivery target');
    await expect.poll(() => referenceRequests[referenceRequests.length - 1]?.searchParams.get('cycleId')).toBe('cycle-1');
    await expect.poll(() => referenceRequests[referenceRequests.length - 1]?.searchParams.get('ownerId')).toBe('employee-1');
    await objectiveTab.press('ArrowRight');
    await expect(historyTab).toBeFocused();
    await expect(historyTab).toHaveAttribute('aria-selected', 'true');
    await expect(historyPanel).toHaveAttribute('role', 'tabpanel');
    await expect(historyPanel).toHaveAttribute('aria-labelledby', await historyTab.getAttribute('id') ?? '');
    await expect(historyTab).toHaveAttribute('aria-controls', await historyPanel.getAttribute('id') ?? '');
    await expect(historyPanel).toContainText('Ready for review');
    await historyTab.press('ArrowLeft');
    await expect(objectiveTab).toBeFocused();
    await objectiveTab.press('End');
    await expect(historyTab).toBeFocused();
    await historyTab.press('Home');
    await expect(objectiveTab).toBeFocused();
    expect(referenceRequests.every((url) => url.pathname.endsWith('/tasks/reference-indicators'))).toBe(true);

    await page.getByTestId('goal-review-save').click();
    await expect.poll(() => savedBody).toEqual(expect.objectContaining({
      expectedUpdatedAt: '2026-08-09T00:00:00.000Z',
      action: 'save',
    }));
    const instances = savedBody?.instances as Array<Record<string, unknown>>;
    expect(instances[0]).toEqual(expect.objectContaining({
      visibilityScope: 'custom',
      visibleDepartmentIds: ['dept-1'],
      visibleUserIds: ['employee-1'],
    }));
  });

  for (const totalPercent of [90, 99.99, 100.01]) {
    test(`goal review blocks ${totalPercent.toFixed(2)}% approval and focuses the first invalid indicator`, async ({ page }) => {
      const invalidDetail = structuredClone(goalReviewDetailFixture);
      invalidDetail.indicatorInstances[0].weight = (totalPercent - 40) / 100;
      let approvalCalls = 0;
      await mockGoalReviewWorkspace(page, invalidDetail);
      await page.route('**/api/v1/tasks/team/indicator-review/batch-approve', (route) => {
        approvalCalls += 1;
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(apiResponse({ succeeded: [], failed: [] })),
        });
      });

      await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-1');
      await expect(page.getByTestId('indicator-weight-total')).toContainText(`${totalPercent.toFixed(2)}%`);
      await page.getByTestId('goal-review-approve').click();

      expect(approvalCalls).toBe(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByTestId('indicator-details-ind-1')).toBeVisible();
      await expect(page.getByTestId('indicator-row-ind-1')).toBeFocused();
      await expect(page.locator('.el-message--error')).toContainText('100%');
    });
  }

  test('goal review reuses complete outcome handling for single approve and reject', async ({ page }) => {
    let approveAttempt = 0;
    let rejectionBody: Record<string, unknown> | undefined;
    await mockGoalReviewWorkspace(page);
    await page.route('**/api/v1/tasks/team/indicator-review/batch-approve', (route) => {
      approveAttempt += 1;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(approveAttempt === 1 ? {
          succeeded: [],
          failed: [{ taskId: 'task-1', reason: '任务已被其他操作更新' }],
        } : {
          succeeded: [{ taskId: 'task-1', status: 'indicator_confirming' }],
          failed: [],
        })),
      });
    });
    await page.route('**/api/v1/tasks/team/indicator-review/batch-reject', (route) => {
      rejectionBody = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          succeeded: [{ taskId: 'task-1', status: 'indicator_drafting' }],
          failed: [],
        })),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-1');
    await page.getByTestId('goal-review-approve').click();
    await page.getByRole('button', { name: '通过', exact: true }).click();
    await expect(page.getByTestId('team-batch-result')).toContainText('任务已被其他操作更新');
    await expect(page.getByTestId('team-selected-count')).toContainText('1');
    await expect(page.locator('.el-message--success')).toHaveCount(0);

    await page.getByTestId('goal-review-approve').click();
    await page.getByRole('button', { name: '通过', exact: true }).click();
    await expect(page.getByTestId('team-batch-result')).toContainText('成功 1 项');
    await expect(page.getByTestId('team-selected-count')).toHaveCount(0);
    await expect(page.getByTestId('team-batch-approve')).toBeDisabled();

    await page.getByTestId('goal-review-reject').click();
    await page.getByRole('button', { name: '驳回', exact: true }).click();
    await expect(page.locator('.el-message-box__errormsg')).toHaveText('请输入驳回原因');
    expect(rejectionBody).toBeUndefined();
    await page.getByRole('textbox', { name: '请输入驳回原因' }).fill('目标口径需要补充');
    await page.getByRole('button', { name: '驳回', exact: true }).click();
    await expect.poll(() => rejectionBody).toEqual({
      tasks: [{ taskId: 'task-1', updatedAt: '2026-08-09T00:00:00.000Z' }],
      reason: '目标口径需要补充',
    });
  });

  for (const action of ['approve', 'reject'] as const) {
    test(`delayed Ada single ${action} cannot affect Grace`, async ({ page }) => {
      const graceDetail = graceGoalReviewDetail();
      let releaseResponse!: () => void;
      const responseGate = new Promise<void>((resolve) => {
        releaseResponse = resolve;
      });
      await mockGoalReviewWorkspace(page);
      await page.route('**/api/v1/tasks/task-2', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(graceDetail)),
      }));
      await page.route('**/api/v1/tasks/team**', (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(apiResponse(teamPageWith(teamPageFixture.items.slice(0, 2)))),
        });
      });
      await page.route(`**/api/v1/tasks/team/indicator-review/batch-${action}`, async (route) => {
        await responseGate;
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(apiResponse({
            succeeded: [{ taskId: 'task-1', status: action === 'approve' ? 'indicator_confirming' : 'indicator_drafting' }],
            failed: [],
          })),
        });
      });

      await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-1');
      if (action === 'approve') {
        await page.getByTestId('goal-review-approve').click();
        await page.getByRole('button', { name: '通过', exact: true }).click();
      } else {
        await page.getByTestId('goal-review-reject').click();
        await page.getByRole('textbox', { name: '请输入驳回原因' }).fill('目标需要重写');
        await page.getByRole('button', { name: '驳回', exact: true }).click();
      }

      await page.getByTestId('team-task-row-task-2').click();
      await expect(page.getByTestId('team-member-rail')).toContainText('Grace Lin');
      await expect(page.getByTestId('goal-review-workspace')).toContainText('Grace delivery target');
      releaseResponse();
      await page.waitForTimeout(100);

      await expect(page.getByTestId('team-member-rail')).toContainText('Grace Lin');
      await expect(page.getByTestId('goal-review-workspace')).toContainText('Grace delivery target');
      await expect(page.getByTestId('team-batch-result')).toHaveCount(0);
      await expect(page.locator('.el-message--success')).toHaveCount(0);
    });
  }

  test('goal review ignores a stale save response after selecting another member', async ({ page }) => {
    const secondDetail = graceGoalReviewDetail();
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    await mockGoalReviewWorkspace(page);
    await page.route('**/api/v1/tasks/task-2', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(secondDetail)),
    }));
    await page.route('**/api/v1/tasks/task-1/indicators', async (route) => {
      await saveGate;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          ...goalReviewDetailFixture,
          updatedAt: '2026-08-09T00:00:01.000Z',
        })),
      });
    });
    await page.route('**/api/v1/tasks/team**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageWith(teamPageFixture.items.slice(0, 2)))),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-1');
    await expect(page.getByTestId('goal-review-workspace')).toContainText('Delivery quality');
    await page.getByTestId('goal-review-save').click();
    await page.getByTestId('team-task-row-task-2').click();
    await expect(page.getByTestId('team-member-rail')).toContainText('Grace Lin');
    await expect(page.getByTestId('goal-review-workspace')).toContainText('Grace delivery target');

    releaseSave();
    await page.waitForTimeout(100);
    await expect(page.getByTestId('goal-review-workspace')).toContainText('Grace delivery target');
    await expect(page.getByTestId('goal-review-workspace')).not.toContainText('Delivery quality');
  });

  test('old A save cannot overwrite newer A draft after A to B to A', async ({ page }) => {
    const graceDetail = graceGoalReviewDetail();
    const saveBodies: Array<Record<string, unknown>> = [];
    let releaseFirstSave!: () => void;
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    await mockGoalReviewWorkspace(page);
    await page.route('**/api/v1/tasks/task-2', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(graceDetail)),
    }));
    await page.route('**/api/v1/tasks/team**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageWith(teamPageFixture.items.slice(0, 2)))),
      });
    });
    await page.route('**/api/v1/tasks/task-1/indicators', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      saveBodies.push(body);
      if (saveBodies.length === 1) {
        await firstSaveGate;
        const staleTask = structuredClone(goalReviewDetailFixture);
        staleTask.updatedAt = '2026-08-09T00:00:01.000Z';
        staleTask.indicatorInstances[0].name = 'Stale saved Ada target';
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(apiResponse(staleTask)),
        });
      }
      const currentTask = structuredClone(goalReviewDetailFixture);
      currentTask.updatedAt = '2026-08-09T00:00:02.000Z';
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(currentTask)),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-1');
    await page.getByTestId('indicator-toggle-ind-1').click();
    const nameInput = page.getByTestId('indicator-details-ind-1').locator('input').first();
    await nameInput.fill('Ada first save');
    await page.getByTestId('goal-review-save').click();

    await page.getByTestId('team-task-row-task-2').click();
    await expect(page.getByTestId('goal-review-workspace')).toContainText('Grace delivery target');
    await page.getByTestId('team-task-row-task-1').click();
    await expect(page.getByTestId('goal-review-workspace')).toContainText('Delivery quality');
    await page.getByTestId('indicator-toggle-ind-1').click();
    const newerNameInput = page.getByTestId('indicator-details-ind-1').locator('input').first();
    const newerDescriptionInput = page.getByTestId('indicator-details-ind-1').locator('textarea').first();
    await newerNameInput.fill('Ada newer unsaved draft');
    await newerDescriptionInput.fill('Newer A to B to A description');

    releaseFirstSave();
    await page.waitForTimeout(100);
    await expect(newerNameInput).toHaveValue('Ada newer unsaved draft');
    await expect(newerDescriptionInput).toHaveValue('Newer A to B to A description');
    await expect(page.getByTestId('goal-review-workspace')).not.toContainText('Stale saved Ada target');

    await page.getByTestId('goal-review-save').click();
    await expect.poll(() => saveBodies.length).toBe(2);
    expect(saveBodies[1]).toEqual(expect.objectContaining({
      expectedUpdatedAt: '2026-08-09T00:00:01.000Z',
    }));
    const instances = saveBodies[1].instances as Array<Record<string, unknown>>;
    expect(instances[0].name).toBe('Ada newer unsaved draft');
    expect(instances[0].description).toBe('Newer A to B to A description');
  });

  test('save response cannot overwrite a newer same-task draft revision', async ({ page }) => {
    const saveBodies: Array<Record<string, unknown>> = [];
    let releaseFirstSave!: () => void;
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    await mockGoalReviewWorkspace(page);
    await page.route('**/api/v1/tasks/task-1/indicators', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      saveBodies.push(body);
      if (saveBodies.length === 1) await firstSaveGate;
      const response = structuredClone(goalReviewDetailFixture);
      response.updatedAt = `2026-08-09T00:00:0${saveBodies.length}.000Z`;
      response.indicatorInstances[0].name = 'Server save response';
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(response)),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-1');
    await page.getByTestId('indicator-toggle-ind-1').click();
    const nameInput = page.getByTestId('indicator-details-ind-1').locator('input').first();
    await nameInput.fill('Draft at save start');
    await page.getByTestId('goal-review-save').click();
    await nameInput.fill('Newer local revision');
    releaseFirstSave();

    await page.waitForTimeout(100);
    await expect(nameInput).toHaveValue('Newer local revision');
    await page.getByTestId('goal-review-save').click();
    await expect.poll(() => saveBodies.length).toBe(2);
    expect(saveBodies[1]).toEqual(expect.objectContaining({
      expectedUpdatedAt: '2026-08-09T00:00:01.000Z',
    }));
  });

  test('delayed save acknowledgement advances the parent task version', async ({ page }) => {
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let approvalBody: Record<string, unknown> | undefined;
    await mockGoalReviewWorkspace(page);
    await page.route('**/api/v1/tasks/task-1/indicators', async (route) => {
      await saveGate;
      const response = structuredClone(goalReviewDetailFixture);
      response.updatedAt = '2026-08-09T00:00:01.000Z';
      response.indicatorInstances[0].name = 'Server save response';
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(response)),
      });
    });
    await page.route('**/api/v1/tasks/team/indicator-review/batch-approve', (route) => {
      approvalBody = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          succeeded: [{ taskId: 'task-1', status: 'indicator_confirming' }],
          failed: [],
        })),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-1');
    await page.getByTestId('indicator-toggle-ind-1').click();
    const nameInput = page.getByTestId('indicator-details-ind-1').locator('input').first();
    await nameInput.fill('Draft at save start');
    await page.getByTestId('goal-review-save').click();
    await nameInput.fill('Newer local revision');
    releaseSave();

    await expect(nameInput).toHaveValue('Newer local revision');
    const adaRow = page.getByRole('row').filter({ hasText: 'Ada Chen' });
    await adaRow.locator('.el-checkbox').click();
    await page.getByTestId('team-batch-approve').click();
    await page.getByRole('button', { name: '通过', exact: true }).click();

    await expect.poll(() => approvalBody).toEqual({
      tasks: [{ taskId: 'task-1', updatedAt: '2026-08-09T00:00:01.000Z' }],
    });
  });

  test('older save operation cannot regress an acknowledged newer version', async ({ page }) => {
    const graceDetail = graceGoalReviewDetail();
    const saveBodies: Array<Record<string, unknown>> = [];
    let releaseOldSave!: () => void;
    const oldSaveGate = new Promise<void>((resolve) => {
      releaseOldSave = resolve;
    });
    await mockGoalReviewWorkspace(page);
    await page.route('**/api/v1/tasks/task-2', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(graceDetail)),
    }));
    await page.route('**/api/v1/tasks/team**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageWith(teamPageFixture.items.slice(0, 2)))),
      });
    });
    await page.route('**/api/v1/tasks/task-1/indicators', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      saveBodies.push(body);
      const response = structuredClone(goalReviewDetailFixture);
      if (saveBodies.length === 1) {
        await oldSaveGate;
        response.updatedAt = '2026-08-09T00:00:01.000Z';
        response.indicatorInstances[0].name = 'Older operation response';
      } else if (saveBodies.length === 2) {
        response.updatedAt = '2026-08-09T00:00:02.000Z';
        response.indicatorInstances[0].name = 'Newer operation response';
      } else {
        response.updatedAt = '2026-08-09T00:00:03.000Z';
      }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(response)),
      });
    });

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-1');
    await page.getByTestId('goal-review-save').click();
    await page.getByTestId('team-task-row-task-2').click();
    await page.getByTestId('team-task-row-task-1').click();
    await expect(page.getByTestId('goal-review-workspace')).toContainText('Delivery quality');
    await page.getByTestId('goal-review-save').click();
    await expect.poll(() => saveBodies.length).toBe(2);
    releaseOldSave();
    await page.waitForTimeout(100);

    await page.getByTestId('indicator-toggle-ind-1').click();
    const nameInput = page.getByTestId('indicator-details-ind-1').locator('input').first();
    await nameInput.fill('Draft after newer acknowledgement');
    await page.getByTestId('goal-review-save').click();
    await expect.poll(() => saveBodies.length).toBe(3);
    expect(saveBodies[2]).toEqual(expect.objectContaining({
      expectedUpdatedAt: '2026-08-09T00:00:02.000Z',
    }));
    const instances = saveBodies[2].instances as Array<Record<string, unknown>>;
    expect(instances[0].name).toBe('Draft after newer acknowledgement');
  });

  for (const scenario of [
    { name: 'completed', status: 'indicator_confirming' as const, isExempt: false },
    { name: 'exempted', status: 'exempted' as const, isExempt: true },
    { name: 'not-started', status: 'pending' as const, isExempt: false },
    { name: 'other', status: 'manager_scoring' as const, isExempt: false },
  ]) {
    test(`goal review renders ${scenario.name} task as read-only without actions`, async ({ page }) => {
      const detail = structuredClone(goalReviewDetailFixture);
      detail.status = scenario.status;
      detail.isExempt = scenario.isExempt;
      await mockGoalReviewWorkspace(page, detail);

      await page.goto('/tasks?scope=team&stage=goal-review&taskId=task-1');
      await expect(page.getByTestId('goal-review-workspace')).toBeVisible();
      await expect(page.getByTestId('goal-review-save')).toHaveCount(0);
      await expect(page.getByTestId('goal-review-approve')).toHaveCount(0);
      await expect(page.getByTestId('goal-review-reject')).toHaveCount(0);
      await expect(page.getByTestId('indicator-visibility-ind-1')).toHaveCount(0);

      await page.getByTestId('indicator-toggle-ind-1').click();
      const details = page.getByTestId('indicator-details-ind-1');
      await expect(details).toBeVisible();
      await expect(details).toContainText('Ship the customer portal without critical defects.');
      await expect(details.locator('input, textarea, button')).toHaveCount(0);
    });
  }

  test('goal review automatically opens and focuses a rejected indicator', async ({ page }) => {
    const rejectedDetail = structuredClone(goalReviewDetailFixture);
    rejectedDetail.flowRecords = [
      ...(rejectedDetail.flowRecords ?? []),
      {
        id: 'flow-reject',
        taskId: 'task-1',
        cycleId: 'cycle-1',
        nodeType: 'indicator_setting',
        actorId: 'manager-1',
        actorName: 'Test Manager',
        action: 'reject',
        comment: '目标口径需要补充',
        extraData: { type: 'indicator_review_rejected' },
        createdAt: '2026-08-09T09:00:00.000Z',
      },
    ];
    await mockGoalReviewWorkspace(page, rejectedDetail);

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-1');

    await expect(page.getByTestId('indicator-details-ind-1')).toBeVisible();
    await expect(page.getByTestId('indicator-row-ind-1')).toBeFocused();
    await expect(page.getByTestId('indicator-details-ind-1')).toContainText('目标口径需要补充');
  });

  for (const containerWidth of [970, 1024]) {
    test(`goal review stacks before controls overlap at ${containerWidth}px effective width`, async ({ page }) => {
      await page.setViewportSize({ width: 1800, height: 1100 });
      await mockGoalReviewWorkspace(page);
      await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-1');

      await page.getByTestId('goal-review-workspace').evaluate((element, width) => {
        const workspace = element as HTMLElement;
        const rail = workspace.closest<HTMLElement>('.team-member-rail');
        const layout = workspace.closest<HTMLElement>('.team-layout');
        if (layout) layout.style.width = `${width + 34}px`;
        if (rail) rail.style.width = `${width + 34}px`;
      }, containerWidth);

      const geometry = await page.evaluate(() => {
        const workspace = document.querySelector<HTMLElement>('[data-testid="goal-review-workspace"]')!;
        const reference = document.querySelector<HTMLElement>('[data-testid="performance-reference-panel"]')!;
        const main = document.querySelector<HTMLElement>('.goal-review__main')!;
        const workspaceRect = workspace.getBoundingClientRect();
        const referenceRect = reference.getBoundingClientRect();
        const mainRect = main.getBoundingClientRect();
        return {
          workspaceWidth: workspaceRect.width,
          referenceBottom: referenceRect.bottom,
          mainTop: mainRect.top,
        };
      });
      expect(Math.abs(geometry.workspaceWidth - containerWidth)).toBeLessThanOrEqual(1);
      expect(geometry.referenceBottom).toBeLessThanOrEqual(geometry.mainTop + 1);

      for (const testId of [
        'indicator-expand-all',
        'indicator-visibility-ind-1',
        'indicator-toggle-ind-1',
      ]) {
        const control = page.getByTestId(testId);
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeVisible();
        const isTopmostHitTarget = await control.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return Boolean(hit && (hit === element || element.contains(hit)));
        });
        expect(isTopmostHitTarget).toBe(true);
      }

      await page.getByTestId('indicator-expand-all').click();
      await expect(page.getByTestId('indicator-details-ind-2')).toBeVisible();
      await page.getByTestId('indicator-visibility-ind-1').click();
      await expect(page.getByRole('option', { name: '仅上级可见', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await page.getByTestId('indicator-toggle-ind-1').click();
      await expect(page.getByTestId('indicator-details-ind-1')).toBeHidden();

      const indicatorRows = page.locator('[data-testid^="indicator-row-"]');
      const rowFit = await indicatorRows.evaluateAll((rows) => rows.map((row) => ({
        clientWidth: row.clientWidth,
        scrollWidth: row.scrollWidth,
      })));
      expect(rowFit.every(({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth + 2)).toBe(true);

      if (shouldCaptureTask8Evidence()) {
        await page.mouse.move(1, 1);
        await page.waitForTimeout(500);
        await page.screenshot({
          path: `../.superpowers/sdd/2026-08-08-manager-team-performance-workspace/task-8-container-${containerWidth}.png`,
          fullPage: false,
          animations: 'disabled',
        });
      }
    });
  }

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    test(`goal review keeps stable indicator dimensions at ${viewport.name} width`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockGoalReviewWorkspace(page);
      await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-1');

      const indicatorRows = page.locator('[data-testid^="indicator-row-"]');
      await expect(indicatorRows).toHaveCount(2);
      const columns = await indicatorRows.evaluateAll((rows) =>
        rows.map((row) => getComputedStyle(row).gridTemplateColumns),
      );
      expect(new Set(columns).size).toBe(1);
      const rowFit = await indicatorRows.evaluateAll((rows) => rows.map((row) => ({
        clientWidth: row.clientWidth,
        scrollWidth: row.scrollWidth,
      })));
      expect(rowFit.every(({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth + 2)).toBe(true);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(8);

      await page.getByTestId('indicator-toggle-ind-1').click();
      await expect(page.getByTestId('indicator-details-ind-1')).toBeVisible();
      if (shouldCaptureTask8Evidence()) {
        await page.screenshot({
          path: `../.superpowers/sdd/2026-08-08-manager-team-performance-workspace/task-8-${viewport.name}.png`,
          fullPage: false,
          animations: 'disabled',
        });
      }
    });
  }

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    test(`team list has no document overflow at ${viewport.name} width`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockTaskWorkspaceIdentity(page, 'manager');
      await page.route('**/api/v1/tasks/team**', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPageWith(teamPageFixture.items.slice(0, 2)))),
      }));

      await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending');
      await expect(page.getByTestId('team-task-list')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(8);

      await page.getByTestId('team-task-row-task-1').click();
      await expect(page.getByTestId('team-member-rail')).toBeVisible();
      if (shouldCaptureTask7Evidence()) {
        await page.screenshot({
          path: `../.superpowers/sdd/2026-08-08-manager-team-performance-workspace/task-7-review-${viewport.name}-detail.png`,
          fullPage: true,
        });
      }
      if (viewport.name === 'mobile') {
        await expect(page.getByTestId('team-task-list')).toBeHidden();
        await expect(page.getByTestId('team-member-heading')).toBeFocused();
        await page.getByRole('button', { name: '关闭成员详情' }).click();
        await expect(page.getByTestId('team-task-list')).toBeFocused();
        if (shouldCaptureTask7Evidence()) {
          await page.screenshot({
            path: '../.superpowers/sdd/2026-08-08-manager-team-performance-workspace/task-7-review-mobile-list.png',
            fullPage: true,
          });
        }
      } else {
        await expect(page.getByTestId('team-task-list')).toBeVisible();
      }

      const tableFit = await page.getByTestId('team-task-table-wrap').evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(tableFit.scrollWidth).toBeLessThanOrEqual(tableFit.clientWidth + 2);
    });
  }
});

test.describe('manager evaluation workspace', () => {
  test.use({
    baseURL: 'http://localhost:5173',
    storageState: 'e2e/auth-state/manager.json',
  });

  test('manager evaluation shows self evidence beside editable manager fields and saves a versioned draft', async ({ page }) => {
    const mocked = await mockManagerEvaluationWorkspace(page);
    await page.goto('/tasks?scope=team&stage=manager-eval&taskId=task-2');

    await page.getByTestId('indicator-toggle-ind-1').click();
    await expect(page.getByTestId('employee-self-comment-ind-1')).toBeVisible();
    await expect(page.getByTestId('employee-self-comment-ind-1')).toContainText('Delivered the planned release');
    await page.getByTestId('manager-score-ind-1').fill('88');
    await page.getByTestId('manager-comment-ind-1').fill('按期完成，协作良好');
    await page.getByTestId('manager-evaluation-save').click();

    await expect(page.getByTestId('manager-evaluation-feedback')).toContainText('草稿已保存');
    await expect.poll(() => mocked.draftBodies.length).toBe(1);
    const body = mocked.draftBodies[0] as {
      expectedUpdatedAt: string;
      indicators: Array<{ id: string; managerScore?: number; managerComment?: string }>;
    };
    expect(body.expectedUpdatedAt).toBe('2026-08-09T01:00:00.000Z');
    expect(body.indicators.find((indicator) => indicator.id === 'ind-1')).toEqual(expect.objectContaining({
      managerScore: 88,
      managerComment: '按期完成，协作良好',
    }));
    expect(mocked.details.get('task-2')?.status).toBe('manager_scoring');
  });

  test('manager evaluation draft explicitly clears existing scores, comments, and summary text', async ({ page }) => {
    const detail = managerEvaluationDetail();
    detail.indicatorInstances[0].managerScore = 88;
    detail.indicatorInstances[0].managerComment = 'Existing manager comment';
    detail.managerEvalSummary = {
      taskId: detail.id,
      strengths: 'Existing strengths',
      improvements: 'Existing improvements',
      developmentPlan: 'Existing development plan',
      attachments: [],
    };
    const mocked = await mockManagerEvaluationWorkspace(page, { details: [detail] });
    await page.goto('/tasks?scope=team&stage=manager-eval&taskId=task-2');

    await page.getByTestId('indicator-toggle-ind-1').click();
    await page.getByTestId('manager-score-ind-1').fill('');
    await page.getByTestId('manager-comment-ind-1').fill('');
    await page.getByTestId('manager-strengths').fill('');
    await page.getByTestId('manager-improvements').fill('');
    await page.getByTestId('manager-development-plan').fill('');
    await page.getByTestId('manager-evaluation-save').click();

    await expect(page.getByTestId('manager-evaluation-feedback')).toContainText('草稿已保存');
    const body = mocked.draftBodies[0] as {
      indicators: Array<{ id: string; managerScore?: number | null; managerComment?: string }>;
      evalSummary: { strengths?: string; improvements?: string; developmentPlan?: string };
    };
    expect(body.indicators.find((indicator) => indicator.id === 'ind-1')).toEqual(expect.objectContaining({
      managerScore: null,
      managerComment: '',
    }));
    expect(body.evalSummary).toEqual(expect.objectContaining({
      strengths: '',
      improvements: '',
      developmentPlan: '',
    }));
  });

  test('manager evaluation focuses the first empty extra-score reason before saving', async ({ page }) => {
    const mocked = await mockManagerEvaluationWorkspace(page);
    await page.goto('/tasks?scope=team&stage=manager-eval&taskId=task-2');
    await page.getByTestId('indicator-toggle-ind-1').click();
    await page.getByTestId('manager-score-ind-1').fill('88');
    await page.getByTestId('manager-extra-add-ind-1').click();
    await page.getByTestId('manager-extra-value-ind-1-0').fill('2');
    await page.getByTestId('manager-evaluation-save').click();

    await expect(page.getByTestId('manager-extra-reason-ind-1-0')).toBeFocused();
    await expect(page.getByTestId('manager-evaluation-feedback')).toContainText('请填写加减分原因');
    expect(mocked.draftBodies).toHaveLength(0);

    await page.getByTestId('manager-extra-reason-ind-1-0').fill('跨部门发布支持');
    await page.getByTestId('manager-evaluation-save').click();
    await expect(page.getByTestId('manager-evaluation-feedback')).toContainText('草稿已保存');
    const body = mocked.draftBodies[0] as {
      indicators: Array<{ id: string; extraScores?: Array<{ label: string; value: number }> }>;
    };
    expect(body.indicators.find((indicator) => indicator.id === 'ind-1')?.extraScores).toEqual([
      { label: '跨部门发布支持', value: 2 },
    ]);
  });

  test('manager evaluation acknowledges a delayed save version without replacing newer edits', async ({ page }) => {
    let releaseDraft!: () => void;
    const draftGate = new Promise<void>((resolve) => {
      releaseDraft = resolve;
    });
    const mocked = await mockManagerEvaluationWorkspace(page, { draftGate });
    await page.goto('/tasks?scope=team&stage=manager-eval&taskId=task-2');
    await page.getByTestId('indicator-toggle-ind-1').click();
    await page.getByTestId('manager-score-ind-1').fill('88');
    await page.getByTestId('manager-comment-ind-1').fill('First draft');
    await page.getByTestId('manager-evaluation-save').click();
    await expect.poll(() => mocked.draftBodies.length).toBe(1);

    await page.getByTestId('manager-comment-ind-1').fill('Newer local draft');
    releaseDraft();
    await expect(page.getByTestId('manager-evaluation-feedback')).toContainText('当前修改尚未保存');
    await expect(page.getByTestId('manager-comment-ind-1')).toHaveValue('Newer local draft');

    await page.getByTestId('manager-evaluation-save').click();
    await expect.poll(() => mocked.draftBodies.length).toBe(2);
    const secondBody = mocked.draftBodies[1] as { expectedUpdatedAt: string };
    expect(secondBody.expectedUpdatedAt).toBe('2026-08-09T01:00:02.000Z');
  });

  test('manager evaluation keeps a successful draft acknowledgement when detail refresh fails', async ({ page }) => {
    const mocked = await mockManagerEvaluationWorkspace(page, {
      draftRefreshError: '详情服务暂时不可用',
    });
    await page.goto('/tasks?scope=team&stage=manager-eval&taskId=task-2');
    await page.getByTestId('indicator-toggle-ind-1').click();
    await page.getByTestId('manager-score-ind-1').fill('88');
    await page.getByTestId('manager-evaluation-save').click();

    await expect(page.getByTestId('manager-evaluation-feedback'))
      .toContainText('草稿已保存，但最新详情加载失败');
    await page.getByTestId('manager-comment-ind-1').fill('继续编辑');
    await page.getByTestId('manager-evaluation-save').click();
    await expect.poll(() => mocked.draftBodies.length).toBe(2);
    expect((mocked.draftBodies[1] as { expectedUpdatedAt: string }).expectedUpdatedAt)
      .toBe('2026-08-09T01:00:02.000Z');
  });

  test('manager evaluation final submit reloads the task as read-only with total and grade', async ({ page }) => {
    const mocked = await mockManagerEvaluationWorkspace(page);
    await page.goto('/tasks?scope=team&stage=manager-eval&taskId=task-2');
    await page.getByTestId('indicator-expand-all').click();
    await page.getByTestId('manager-score-ind-1').fill('88');
    await page.getByTestId('manager-score-ind-2').fill('90');
    await page.getByTestId('manager-strengths').fill('Reliable delivery ownership.');
    await page.getByTestId('manager-evaluation-submit').click();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.getByRole('button', { name: '确认提交', exact: true }).click();

    await expect(page.getByTestId('manager-evaluation-feedback')).toContainText('评估已提交');
    await expect(page.getByTestId('manager-score-ind-1')).toBeDisabled();
    await expect(page.getByTestId('manager-evaluation-save')).toHaveCount(0);
    await expect(page.getByTestId('manager-evaluation-submit')).toHaveCount(0);
    await expect(page.getByTestId('manager-evaluation-total')).toContainText('89.2');
    await expect(page.getByTestId('manager-evaluation-grade')).toContainText('良好');
    await expect(page.getByTestId('manager-evaluation-withdraw')).toBeVisible();
    expect(mocked.submitBodies).toHaveLength(1);
    expect((mocked.submitBodies[0] as { expectedUpdatedAt: string }).expectedUpdatedAt)
      .toBe('2026-08-09T01:00:00.000Z');
  });

  test('manager evaluation locks editable fields while final submit is pending', async ({ page }) => {
    let releaseSubmit!: () => void;
    const submitGate = new Promise<void>((resolve) => {
      releaseSubmit = resolve;
    });
    const mocked = await mockManagerEvaluationWorkspace(page, { submitGate });
    await page.goto('/tasks?scope=team&stage=manager-eval&taskId=task-2');
    await page.getByTestId('indicator-expand-all').click();
    await page.getByTestId('manager-score-ind-1').fill('88');
    await page.getByTestId('manager-score-ind-2').fill('90');
    await page.getByTestId('manager-evaluation-submit').click();
    await page.getByRole('button', { name: '确认提交', exact: true }).click();
    await expect.poll(() => mocked.submitBodies.length).toBe(1);

    await expect(page.getByTestId('manager-score-ind-1')).toBeDisabled();
    await expect(page.getByTestId('manager-comment-ind-1')).toBeDisabled();
    await expect(page.getByTestId('manager-strengths')).toBeDisabled();
    releaseSubmit();
    await expect(page.getByTestId('manager-evaluation-feedback')).toContainText('评估已提交');
  });

  test('manager evaluation withdrawal restores editable saved values after server approval', async ({ page }) => {
    const detail = managerEvaluationDetail('hr_calibration', {
      managerScoredAt: '2026-08-09T01:10:00.000Z',
    });
    const mocked = await mockManagerEvaluationWorkspace(page, { details: [detail] });
    await page.goto('/tasks?scope=team&stage=manager-eval&taskId=task-2');
    await expect(page.getByTestId('manager-evaluation-withdraw')).toBeVisible();
    await page.getByTestId('manager-evaluation-withdraw').click();
    await page.getByRole('button', { name: '确认撤回', exact: true }).click();

    await expect(page.getByTestId('manager-evaluation-feedback')).toContainText('评估已撤回');
    await page.getByTestId('indicator-toggle-ind-1').click();
    await expect(page.getByTestId('manager-score-ind-1')).toBeEnabled();
    await expect(page.getByTestId('manager-score-ind-1')).toHaveValue('88');
    await expect(page.getByTestId('manager-evaluation-save')).toBeVisible();
    expect(mocked.withdrawBodies).toEqual([{ expectedUpdatedAt: '2026-08-09T01:00:00.000Z' }]);
  });

  test('manager evaluation keeps a successful withdrawal acknowledgement when detail refresh fails', async ({ page }) => {
    const detail = managerEvaluationDetail('hr_calibration', {
      managerScoredAt: '2026-08-09T01:10:00.000Z',
    });
    const mocked = await mockManagerEvaluationWorkspace(page, {
      details: [detail],
      withdrawRefreshError: '详情服务暂时不可用',
    });
    await page.goto('/tasks?scope=team&stage=manager-eval&taskId=task-2');
    await page.getByTestId('manager-evaluation-withdraw').click();
    await page.getByRole('button', { name: '确认撤回', exact: true }).click();

    await expect(page.getByTestId('manager-evaluation-feedback'))
      .toContainText('评估已撤回，但最新详情加载失败');
    await page.getByTestId('indicator-toggle-ind-1').click();
    await expect(page.getByTestId('manager-score-ind-1')).toBeEnabled();
    await page.getByTestId('manager-comment-ind-1').fill('撤回后继续编辑');
    await page.getByTestId('manager-evaluation-save').click();
    await expect.poll(() => mocked.draftBodies.length).toBe(1);
    expect((mocked.draftBodies[0] as { expectedUpdatedAt: string }).expectedUpdatedAt)
      .toBe('2026-08-09T01:00:02.000Z');
  });

  test('manager evaluation shows the server reason when withdrawal is blocked', async ({ page }) => {
    const detail = managerEvaluationDetail('dept_review', {
      managerScoredAt: '2026-08-09T01:10:00.000Z',
    });
    await mockManagerEvaluationWorkspace(page, {
      details: [detail],
      withdrawError: '下一节点已处理，不能撤回主管评分',
    });
    await page.goto('/tasks?scope=team&stage=manager-eval&taskId=task-2');
    await page.getByTestId('manager-evaluation-withdraw').click();
    await page.getByRole('button', { name: '确认撤回', exact: true }).click();

    await expect(page.getByTestId('manager-evaluation-feedback')).toContainText('下一节点已处理，不能撤回主管评分');
    await expect(page.locator('.el-message--error')).toContainText('下一节点已处理，不能撤回主管评分');
    await expect(page.getByTestId('manager-evaluation-withdraw')).toBeVisible();
  });

  test('manager evaluation hides withdrawal before a formal manager submission', async ({ page }) => {
    await mockManagerEvaluationWorkspace(page, {
      details: [managerEvaluationDetail('dept_review')],
    });
    await page.goto('/tasks?scope=team&stage=manager-eval&taskId=task-2');
    await expect(page.getByTestId('manager-evaluation-withdraw')).toHaveCount(0);
    await expect(page.getByTestId('manager-score-ind-1')).toBeDisabled();
  });

  test('manager evaluation guards selected-member route changes while the draft is dirty', async ({ page }) => {
    const grace = managerEvaluationDetail();
    const ada = managerEvaluationDetail('manager_scoring', {
      id: 'task-1',
      employeeName: 'Ada Chen',
    });
    await mockManagerEvaluationWorkspace(page, { details: [grace, ada] });
    await page.goto('/tasks?scope=team&stage=manager-eval&taskId=task-2');
    await page.getByTestId('indicator-toggle-ind-1').click();
    await page.getByTestId('manager-score-ind-1').fill('88');

    await page.getByTestId('team-task-row-task-1').click();
    await expect(page.getByRole('dialog')).toContainText('存在未保存的主管评价');
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(page).toHaveURL(/taskId=task-2/);
    await expect(page.getByTestId('manager-score-ind-1')).toHaveValue('88');

    await page.getByTestId('team-task-row-task-1').click();
    await page.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page).toHaveURL(/taskId=task-1/);
    await expect(page.getByTestId('team-member-rail')).toContainText('Ada Chen');
  });

  test('manager evaluation guards leaving tasks and continues the confirmed navigation once', async ({ page }) => {
    await mockManagerEvaluationWorkspace(page);
    await page.goto('/tasks?scope=team&stage=manager-eval&taskId=task-2');
    await page.getByTestId('indicator-toggle-ind-1').click();
    await page.getByTestId('manager-score-ind-1').fill('88');

    await page.getByRole('link', { name: '目标地图', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('存在未保存的主管评价');
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(page).toHaveURL(/\/tasks\?/);

    await page.getByRole('link', { name: '目标地图', exact: true }).click();
    await page.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page).toHaveURL(/\/objectives(?:\?|$)/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('manager evaluation registers beforeunload protection only while the draft is dirty', async ({ page }) => {
    await mockManagerEvaluationWorkspace(page);
    await page.goto('/tasks?scope=team&stage=manager-eval&taskId=task-2');
    const dispatchBeforeUnload = () => page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });

    await expect.poll(dispatchBeforeUnload).toBe(false);
    await page.getByTestId('indicator-toggle-ind-1').click();
    await page.getByTestId('manager-score-ind-1').fill('88');
    await expect.poll(dispatchBeforeUnload).toBe(true);

    await page.getByTestId('manager-evaluation-save').click();
    await expect(page.getByTestId('manager-evaluation-feedback')).toContainText('草稿已保存');
    await expect.poll(dispatchBeforeUnload).toBe(false);
  });

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    test(`manager evaluation keeps comparison grids stable at ${viewport.name} width`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockManagerEvaluationWorkspace(page);
      await page.goto('/tasks?scope=team&stage=manager-eval&taskId=task-2');
      await page.getByTestId('indicator-toggle-ind-1').click();

      const geometry = await page.evaluate(() => {
        const self = document.querySelector<HTMLElement>('[data-testid="employee-self-comment-ind-1"]')!
          .closest<HTMLElement>('.evaluation-column')!;
        const manager = document.querySelector<HTMLElement>('[data-testid="manager-comment-ind-1"]')!
          .closest<HTMLElement>('.evaluation-column')!;
        const selfRect = self.getBoundingClientRect();
        const managerRect = manager.getBoundingClientRect();
        return {
          selfLeft: selfRect.left,
          selfTop: selfRect.top,
          selfBottom: selfRect.bottom,
          managerLeft: managerRect.left,
          managerTop: managerRect.top,
        };
      });
      if (viewport.name === 'desktop') {
        expect(geometry.managerLeft).toBeGreaterThan(geometry.selfLeft);
        expect(Math.abs(geometry.managerTop - geometry.selfTop)).toBeLessThanOrEqual(1);
      } else {
        expect(geometry.managerTop).toBeGreaterThanOrEqual(geometry.selfBottom - 1);
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(8);
      const rowFit = await page.locator('[data-testid^="indicator-row-"]').evaluateAll((rows) => rows.map((row) => ({
        clientWidth: row.clientWidth,
        scrollWidth: row.scrollWidth,
      })));
      expect(rowFit.every(({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth + 2)).toBe(true);

      if (shouldCaptureTask9Evidence()) {
        await page.mouse.move(1, 1);
        await page.waitForTimeout(300);
        await page.screenshot({
          path: `../.superpowers/sdd/2026-08-08-manager-team-performance-workspace/task-9-${viewport.name}.png`,
          fullPage: true,
          animations: 'disabled',
        });
        await page.locator('.manager-evaluation__summary').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        await page.screenshot({
          path: `../.superpowers/sdd/2026-08-08-manager-team-performance-workspace/task-9-${viewport.name}-summary.png`,
          fullPage: false,
          animations: 'disabled',
        });
      }
    });
  }
});

test.describe('manager scoring compatibility redirect', () => {
  test.use({
    baseURL: 'http://localhost:5173',
    storageState: 'e2e/auth-state/manager.json',
  });

  test('redirect preserves manager scoring cycle and task deep links', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'manager');
    await page.route('**/api/v1/tasks/team**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(managerEvaluationTeamPage([managerEvaluationDetail()]))),
    }));
    await page.route('**/api/v1/tasks/task-2', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(managerEvaluationDetail())),
    }));

    await page.goto('/manager/scoring?cycleId=cycle-1&taskId=task-2&stageState=pending');
    await expect(page).toHaveURL(/\/tasks\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get('scope')).toBe('team');
    expect(url.searchParams.get('stage')).toBe('manager-eval');
    expect(url.searchParams.get('cycleId')).toBe('cycle-1');
    expect(url.searchParams.get('taskId')).toBe('task-2');
    expect(url.searchParams.get('stageState')).toBe('pending');
    await expect(
      page.locator('.app-sidebar .menu-link').filter({ hasText: '团队绩效' }),
    ).toHaveClass(/is-active/);
  });
});

test.describe('team list employee visibility', () => {
  test.use({
    baseURL: 'http://localhost:5173',
    storageState: 'e2e/auth-state/employee.json',
  });

  test('employee storage state does not expose team scope', async ({ page }) => {
    await mockTaskWorkspaceIdentity(page, 'employee');
    await page.goto('/tasks?scope=team&stage=goal-review');

    await expect(page.getByTestId('task-scope-team')).toHaveCount(0);
    await expect(page.getByTestId('task-surface')).toBeVisible();
  });

  test('employee goal review snapshot uses disclosure and focuses the latest rejection', async ({ page }) => {
    const employeeDetail = structuredClone(goalReviewDetailFixture);
    employeeDetail.id = 'task-employee';
    employeeDetail.indicatorInstances.forEach((indicator) => {
      indicator.taskId = employeeDetail.id;
    });
    employeeDetail.status = 'indicator_drafting';
    employeeDetail.flowRecords = [{
      id: 'flow-employee-reject',
      taskId: employeeDetail.id,
      cycleId: 'cycle-1',
      nodeType: 'indicator_setting',
      actorId: 'manager-1',
      actorName: 'Test Manager',
      action: 'reject',
      comment: '请补充验收口径',
      extraData: { type: 'indicator_review_rejected' },
      createdAt: '2026-08-09T10:00:00.000Z',
    }];
    await mockTaskWorkspaceIdentity(page, 'employee');
    await page.route('**/api/v1/indicators**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 100, items: [] })),
    }));
    await page.route('**/api/v1/templates**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 100, items: [] })),
    }));
    await page.route('**/api/v1/tasks/task-employee', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(employeeDetail)),
    }));

    await page.goto('/tasks/task-employee');

    await expect(page.getByTestId('indicator-details-ind-1')).toBeVisible();
    await expect(page.getByTestId('indicator-row-ind-1')).toBeFocused();
    await expect(page.getByTestId('indicator-details-ind-1')).toContainText('请补充验收口径');
    await page.getByTestId('indicator-collapse-all').click();
    await expect(page.getByTestId('indicator-details-ind-1')).toBeHidden();
  });

  for (const totalPercent of [99.99, 100.01]) {
    test(`employee submission blocks floating ${totalPercent.toFixed(2)}% and focuses the first indicator`, async ({ page }) => {
      const employeeDetail = structuredClone(goalReviewDetailFixture);
      employeeDetail.id = 'task-employee';
      employeeDetail.status = 'indicator_drafting';
      employeeDetail.flowRecords = [];
      const thirdIndicator = structuredClone(employeeDetail.indicatorInstances[1]);
      thirdIndicator.id = 'ind-3';
      thirdIndicator.name = 'Customer adoption';
      const weights = totalPercent === 99.99
        ? [0.0001, 0.0002, 0.9996]
        : [0.0001, 0.0002, 0.9998];
      employeeDetail.indicatorInstances = [
        { ...employeeDetail.indicatorInstances[0], taskId: employeeDetail.id, weight: weights[0] },
        { ...employeeDetail.indicatorInstances[1], taskId: employeeDetail.id, weight: weights[1] },
        { ...thirdIndicator, taskId: employeeDetail.id, weight: weights[2] },
      ];
      let submitCalls = 0;
      await mockTaskWorkspaceIdentity(page, 'employee');
      await page.route('**/api/v1/indicators**', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 100, items: [] })),
      }));
      await page.route('**/api/v1/templates**', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 100, items: [] })),
      }));
      await page.route('**/api/v1/tasks/task-employee/indicators', (route) => {
        submitCalls += 1;
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(apiResponse(employeeDetail)),
        });
      });
      await page.route('**/api/v1/tasks/task-employee', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(employeeDetail)),
      }));

      await page.goto('/tasks/task-employee');
      await expect(page.getByTestId('indicator-weight-total')).toContainText(`${totalPercent.toFixed(2)}%`);
      await page.getByRole('button', { name: '提交主管审核', exact: true }).click();

      expect(submitCalls).toBe(0);
      await expect(page.getByTestId('indicator-details-ind-1')).toBeVisible();
      await expect(page.getByTestId('indicator-row-ind-1')).toBeFocused();
      await expect(page.locator('.el-message--warning')).toContainText('100%');
    });
  }
});

test('normalizes team workspace query', () => {
  expect(
    parseTaskWorkspaceQuery({
      scope: 'team',
      stage: 'manager-eval',
      cycleId: 'cycle-1',
      taskId: 'task-1',
    }),
  ).toEqual(
    expect.objectContaining({
      scope: 'team',
      stage: 'manager-eval',
      cycleId: 'cycle-1',
      taskId: 'task-1',
    }),
  );
});

test('validates stage state and drops unknown query keys', () => {
  expect(
    parseTaskWorkspaceQuery({
      scope: 'bad',
      stage: 'bad',
      stageState: 'not-a-stage-state',
      unknown: 'discard-me',
    }),
  ).toEqual(
    expect.objectContaining({
      scope: 'mine',
      stage: 'goal-review',
      stageState: undefined,
    }),
  );
});

test('serializes a patched workspace query in stable order, removes unknown keys, and resets page for filters', async () => {
  let replacement: unknown;
  const replace = async (location: unknown) => {
    replacement = location;
  };
  const router = { replace } as unknown as Router;

  await updateTaskWorkspaceQuery(
    router,
    {
      keyword: 'Ada',
      taskId: 'task-1',
      page: '3',
      stage: 'manager-eval',
      scope: 'team',
      ignored: 'value',
    },
    { keyword: '', cycleId: 'cycle-1' },
  );

  const query = (replacement as { query: Record<string, string> }).query;
  expect(query).toEqual({
    scope: 'team',
    stage: 'manager-eval',
    cycleId: 'cycle-1',
    taskId: 'task-1',
  });
  expect(Object.keys(query)).toEqual(['scope', 'stage', 'cycleId', 'taskId']);
});

test('does not replace the route when its canonical query is unchanged', async () => {
  let calls = 0;
  const router = {
    replace: async () => {
      calls += 1;
    },
  } as unknown as Router;

  await updateTaskWorkspaceQuery(
    router,
    {
      scope: 'team',
      stage: 'manager-eval',
      cycleId: 'cycle-1',
      taskId: 'task-1',
      stageState: 'pending',
      keyword: 'Ada',
      page: '2',
    },
    {},
  );

  expect(calls).toBe(0);
});

test('preserves a valid page for task selection while resetting it for filters', async () => {
  let replacement: unknown;
  const router = {
    replace: async (location: unknown) => {
      replacement = location;
    },
  } as unknown as Router;

  await updateTaskWorkspaceQuery(
    router,
    { scope: 'team', stage: 'manager-eval', page: '2' },
    { taskId: 'task-1' },
  );

  expect(replacement).toEqual({
    query: {
      scope: 'team',
      stage: 'manager-eval',
      taskId: 'task-1',
      page: '2',
    },
  });
});

test('uses the six team workspace API contracts without a server or login', async () => {
  const teamPage: TeamTaskPage = {
    total: 1,
    page: 1,
    pageSize: 20,
    items: [
      {
        id: 'task-1',
        cycleId: 'cycle-1',
        cycleName: '2026 H1',
        employeeId: 'employee-1',
        employeeName: 'Ada',
        deptId: null,
        deptName: null,
        managerId: 'manager-1',
        status: 'self_eval',
        totalScore: null,
        rawGrade: null,
        updatedAt: '2026-08-09T00:00:00.000Z',
        employeeNo: null,
        avatarUrl: null,
        position: null,
        stageState: 'pending',
      },
    ],
    counts: { all: 1, notStarted: 0, pending: 1, completed: 0, exempted: 0 },
    facets: {
      departments: [{ id: 'dept-1', name: 'Engineering' }],
      employees: [{ id: 'employee-1', name: 'Ada', employeeNo: null, deptId: null }],
    },
  };
  const referencePage: Paginated<IndicatorReferenceItem> = {
    total: 1,
    page: 1,
    pageSize: 20,
    items: [
      {
        id: 'indicator-1',
        taskId: 'task-1',
        cycleId: 'cycle-1',
        employeeId: 'employee-1',
        employeeName: 'Ada',
        name: 'Delivery',
        weight: 100,
        visibilityScope: 'supervisors',
      },
    ],
  };
  const approvalResult: BatchReviewResult = {
    succeeded: [{ taskId: 'task-1', status: 'indicator_confirming' }],
    failed: [],
  };
  const rejectionResult: BatchReviewResult = {
    succeeded: [{ taskId: 'task-1', status: 'indicator_drafting' }],
    failed: [],
  };
  const alignedObjective: Pick<IndicatorInstance, 'alignedObjectives'> = {
    alignedObjectives: [{ id: 'objective-1', title: 'Ship', level: 'company', ownerId: null }],
  };
  const calls: Array<{ method: string; url: string; body?: unknown; params?: unknown }> = [];
  const responses: unknown[] = [
    teamPage,
    referencePage,
    approvalResult,
    rejectionResult,
    { id: 'task-1', status: 'manager_scoring' },
    { id: 'task-1', status: 'manager_scoring' },
  ];
  const client: TasksApiClient = {
    get: async (url, config) => {
      calls.push({ method: 'GET', url, params: config?.params });
      return responses.shift();
    },
    post: async (url, body) => {
      calls.push({ method: 'POST', url, body });
      return responses.shift();
    },
    put: async (url, body) => {
      calls.push({ method: 'PUT', url, body });
      return responses.shift();
    },
    patch: async (url, body) => {
      throw new Error(`Unexpected PATCH ${url}: ${String(body)}`);
    },
    delete: async (url) => {
      throw new Error(`Unexpected DELETE ${url}`);
    },
  };
  const api = createTasksApi(client);

  const team = await api.findTeam({ stage: 'manager-eval', stageState: 'pending' });
  const references = await api.findReferenceIndicators({ cycleId: 'cycle-1' });
  const approved = await api.batchApproveIndicators({
    tasks: [{ taskId: 'task-1', updatedAt: '2026-08-09T00:00:00.000Z' }],
  });
  const rejected = await api.batchRejectIndicators({
    tasks: [{ taskId: 'task-1', updatedAt: '2026-08-09T00:00:00.000Z' }],
    reason: 'Needs evidence',
  });
  const draft = await api.saveManagerEvaluationDraft('task-1', {
    expectedUpdatedAt: '2026-08-09T00:00:00.000Z',
    indicators: [{ id: 'indicator-1', managerScore: 95, managerComment: 'Strong delivery' }],
    evalSummary: { strengths: 'Execution' },
  });
  const withdrawn = await api.withdrawManagerScore('task-1', {
    expectedUpdatedAt: '2026-08-09T00:00:01.000Z',
  });

  expect(team.items[0].employeeNo).toBeNull();
  expect(team.items[0].deptId).toBeNull();
  expect(references.items[0].visibilityScope).toBe('supervisors');
  expect(approved.succeeded[0].status).toBe('indicator_confirming');
  expect(rejected.succeeded[0].status).toBe('indicator_drafting');
  expect(draft).toEqual({ id: 'task-1', status: 'manager_scoring' });
  expect(withdrawn).toEqual({ id: 'task-1', status: 'manager_scoring' });
  expect(alignedObjective.alignedObjectives[0].ownerId).toBeNull();
  expect(calls).toEqual([
    { method: 'GET', url: '/tasks/team', params: { stage: 'manager-eval', stageState: 'pending' } },
    { method: 'GET', url: '/tasks/reference-indicators', params: { cycleId: 'cycle-1' } },
    { method: 'POST', url: '/tasks/team/indicator-review/batch-approve', body: { tasks: [{ taskId: 'task-1', updatedAt: '2026-08-09T00:00:00.000Z' }] } },
    { method: 'POST', url: '/tasks/team/indicator-review/batch-reject', body: { tasks: [{ taskId: 'task-1', updatedAt: '2026-08-09T00:00:00.000Z' }], reason: 'Needs evidence' } },
    { method: 'PUT', url: '/tasks/task-1/manager-evaluation-draft', body: { expectedUpdatedAt: '2026-08-09T00:00:00.000Z', indicators: [{ id: 'indicator-1', managerScore: 95, managerComment: 'Strong delivery' }], evalSummary: { strengths: 'Execution' } } },
    { method: 'POST', url: '/tasks/task-1/manager-score/withdraw', body: { expectedUpdatedAt: '2026-08-09T00:00:01.000Z' } },
  ]);
});
