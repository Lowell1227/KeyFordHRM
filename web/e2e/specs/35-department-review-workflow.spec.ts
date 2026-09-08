import { expect, test, type Page } from '@playwright/test';

const taskId = '11111111-1111-4111-8111-111111111111';
const cycleId = '22222222-2222-4222-8222-222222222222';
const response = (data: unknown) => ({ code: 0, message: 'success', data });

async function setup(page: Page, role: 'head' | 'employee' | 'employee-head' = 'head') {
  let status = 'dept_review';
  const submissions: unknown[] = [];
  const userId = role === 'head' ? 'head-1' : 'employee-1';
  await page.addInitScript(() => {
    localStorage.setItem('token', 'department-review-contract');
    localStorage.setItem('expiresAt', String(Date.now() + 3600_000));
  });
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname;
    let data: unknown = {};
    if (endpoint.endsWith('/auth/me')) data = { id: userId, name: '虚拟复核账号', sysRole: 'employee', canViewAll: false, businessCapabilities: { canReviewDepartment: role === 'head', canManageTeam: false } };
    else if (endpoint.endsWith('/notifications/unread-count')) data = 0;
    else if (endpoint === '/api/v1/cycles') data = { items: [{ id: cycleId, name: '部门复核回归周期', status: 'manager_score' }], total: 1 };
    else if (endpoint === '/api/v1/cycles/' + cycleId) data = { id: cycleId, name: '部门复核回归周期', workflowVersion: 2, status: 'manager_score', publishVisibleFields: {} };
    else if (endpoint === '/api/v1/tasks/department-review') data = { items: status === 'dept_review' ? [{ id: taskId, cycleId, employeeName: '虚拟员工甲', cycleName: '部门复核回归周期', deptName: '人事组', status, totalScore: 92.4, rawGrade: 'B' }] : [], total: status === 'dept_review' ? 1 : 0, page: 1, pageSize: 20 };
    else if (endpoint.endsWith('/dept-review') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); submissions.push(body);
      status = body.action === 'approve' ? 'hr_calibration' : 'manager_scoring'; data = { id: taskId, status };
    } else if (endpoint.endsWith('/final-grade')) data = {
      taskId, cycleId, employeeName: '虚拟员工甲', cycleName: '部门复核回归周期', status,
      deptName: '人事组', managerName: '虚拟直属上级', calculatedScore: 92.4, currentGrade: 'B', canSubmit: false, allPeriodsComplete: true, latestReject: null,
      periods: [{ periodKey: '2026-09', selfGrade: 'A', managerGrade: 'A', selfScoreTotal: 92.4, managerScoreTotal: 92.4 }],
    };
    else if (endpoint === '/api/v1/tasks/' + taskId) data = {
      id: taskId, cycleId, cycleName: '部门复核回归周期', employeeId: 'employee-1', employeeName: '虚拟员工甲', employeeNo: 'QA_EMPLOYEE', deptName: '人事组',
      managerId: 'manager-1', managerName: '虚拟直属上级', deptHeadId: role === 'employee-head' ? 'employee-1' : 'head-1', status, isExempt: false, workflowVersion: 2,
      periods: [{ id: 'period-1', periodKey: '2026-09', status: 'completed', sequence: 1, periodType: 'month', managerSubmittedAt: '2026-10-01T00:00:00Z', employeeSubmittedAt: '2026-10-01T00:00:00Z' }],
      gradeResult: role === 'head' ? { calculatedScore: 92.4, rawGrade: 'B', isPublished: false } : null,
      indicatorInstances: [], flowRecords: [],
      workflowContext: { stage: 'review', statusLabel: '待部门复核', currentHandler: null, canRemind: false },
    };
    else if (endpoint.endsWith('/tasks/mine')) data = { items: [], total: 0 };
    else if (endpoint.includes('/dashboard')) data = {};
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response(data)) });
  });
  return submissions;
}

for (const width of [1440, 390]) {
  test(`部门负责人从待办进入复核并通过，宽度 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const submissions = await setup(page);
    await page.goto('/department-review');
    await page.getByRole('button', { name: '进入复核', exact: true }).click();
    await expect(page.getByTestId('department-review-workspace')).toBeVisible();
    await expect(page.getByTestId('performance-stage-unavailable')).toHaveCount(0);
    await expect(page.getByText('92.40', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '复核通过', exact: true }).click();
    await expect.poll(() => submissions).toEqual([{ action: 'approve' }]);
    await expect(page.getByText('部门复核已通过，已进入绩效校准。', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('退回必须填写原因，提交后进入上级重评', async ({ page }) => {
  const submissions = await setup(page);
  await page.goto('/tasks/' + taskId);
  await page.getByRole('button', { name: '退回上级重评', exact: true }).click();
  await expect(page.getByText('请填写退回原因', { exact: true })).toBeVisible();
  expect(submissions).toHaveLength(0);
  await page.getByRole('textbox', { name: '复核意见' }).fill('请补充最终等级依据');
  await page.getByRole('button', { name: '退回上级重评', exact: true }).click();
  await expect.poll(() => submissions).toEqual([{ action: 'reject', comment: '请补充最终等级依据' }]);
  await expect(page.getByText('已退回直属上级重新评定。', { exact: true })).toBeVisible();
});

test('员工公示前不能看到复核操作及未公示结果', async ({ page }) => {
  await setup(page, 'employee');
  await page.goto('/tasks/' + taskId + '?stage=result');
  await expect(page.getByText('虚拟员工甲', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('department-review-workspace')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '复核通过', exact: true })).toHaveCount(0);
  await expect(page.getByText('92.40', { exact: true })).toHaveCount(0);
});

test('部门负责人查看本人任务时仍遵守员工公示边界', async ({ page }) => {
  await setup(page, 'employee-head');
  await page.goto('/tasks/' + taskId + '?stage=result');
  await expect(page.getByText('虚拟员工甲', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('department-review-workspace')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '复核通过', exact: true })).toHaveCount(0);
  await expect(page.getByText('92.40', { exact: true })).toHaveCount(0);
});
