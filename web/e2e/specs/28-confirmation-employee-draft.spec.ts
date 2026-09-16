import { expect, test } from '@playwright/test';
import { buildNavigation } from '../../src/router/navigation';
import { routes } from '../../src/router/routes';
import type { HrCapability } from '../../src/types/api.types';

const apiResponse = (data: unknown) => ({ code: 0, message: 'success', data, timestamp: Date.now() });

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/tasks**', (route) => route.fulfill({ json: apiResponse({
    items: [], total: 0, page: 1, pageSize: 50,
  }) }));
});

async function mockEmployeePage(page: import('@playwright/test').Page, status: 'probation' | 'active') {
  let draft: Record<string, unknown> | null = null;
  const createBodies: unknown[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-confirmation-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: apiResponse(0) }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: apiResponse({
    id: 'employee-1', name: '试用期员工', status, sysRole: 'employee', deptId: null,
    isAssessorOnly: false, canViewAll: false,
  }) }));
  await page.route('**/api/v1/confirmation-applications**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/my-roster')) return route.fulfill({ json: apiResponse({
      name: '试用期员工', employeeNo: 'E001', company: 'fuede', deptName: '业务部', position: '业务专员',
      entryDate: '2026-07-01', plannedRegularDate: '2026-10-01', managerName: '花名册直属主管',
    }) });
    if (path.endsWith('/mine')) {
      const items = draft ? [draft] : [];
      return route.fulfill({ json: apiResponse({ items, total: items.length, page: 1, pageSize: 10 }) });
    }
    if (request.method() === 'POST' && path.endsWith('/confirmation-applications')) {
      createBodies.push(request.postDataJSON());
      draft = {
        id: '11111111-1111-4111-8111-111111111111', workflowVersion: 2, status: 'draft',
        employeeId: 'employee-1', employee: { id: 'employee-1', name: '试用期员工' },
        manager: { id: 'manager-1', name: '花名册直属主管' }, hr: null, companyApprover: null,
        summary: (request.postDataJSON() as { summary: string }).summary, actualRegularDate: null,
      };
      return route.fulfill({ json: apiResponse(draft) });
    }
    if (request.method() === 'PUT' && draft) {
      draft = { ...draft, summary: (request.postDataJSON() as { summary: string }).summary };
      return route.fulfill({ json: apiResponse(draft) });
    }
    if (request.method() === 'POST' && path.endsWith('/submit') && draft) {
      draft = { ...draft, status: 'submitted', hr: null,
        companyApprover: { id: 'approver-1', name: '公司审批人' } };
      return route.fulfill({ json: apiResponse({ id: draft.id, status: 'submitted' }) });
    }
    if (request.method() === 'GET' && draft) return route.fulfill({ json: apiResponse(draft) });
    return route.fulfill({ status: 404, json: { message: '未找到' } });
  });
  return { createBodies };
}

test('probation employee saves a draft then submits without HR assignment', async ({ page }) => {
  const { createBodies } = await mockEmployeePage(page, 'probation');
  await page.goto('/confirmation-applications/mine');
  await page.getByRole('button', { name: '发起转正申请' }).click();
  const dialog = page.getByRole('dialog', { name: '转正申请 · 工作小结' });
  await expect(dialog).toContainText('业务部 / 业务专员');
  await expect(dialog).toContainText('2026-10-01');
  await dialog.getByRole('button', { name: '提交转正申请' }).click();
  await expect(dialog).toContainText('请填写试用期工作小结');
  expect(createBodies).toHaveLength(0);

  await dialog.getByPlaceholder('简述工作成果、目标进展、需要改进的地方和后续计划').fill('完成项目交付，继续改进协作');
  await dialog.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByRole('button', { name: '继续填写' })).toBeVisible();
  expect(createBodies).toEqual([{ summary: '完成项目交付，继续改进协作' }]);

  await page.getByRole('button', { name: '继续填写' }).click();
  await dialog.getByRole('button', { name: '提交转正申请' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: '继续填写' })).toHaveCount(0);
  await expect(page.getByText('公司审批人').first()).toBeVisible();
});

test('formal employee has no new probation application action on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockEmployeePage(page, 'active');
  await page.goto('/confirmation-applications/mine');
  await expect(page.getByRole('button', { name: '发起转正申请' })).toHaveCount(0);
  await expect(page.getByText('我的转正申请', { exact: true }).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('the same person completes manager evaluation before a separate HR step', async ({ page }) => {
  const submitted: unknown[] = [];
  let status = 'submitted';
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-manager-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: apiResponse(0) }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: apiResponse({
    id: 'manager-1', name: '方园', status: 'active', sysRole: 'hr_user', deptId: null,
    hrCapabilities: ['confirmation_manage'],
    isAssessorOnly: false, canViewAll: false,
  }) }));
  await page.route('**/api/v1/tasks**', (route) => route.fulfill({ json: apiResponse({
    items: [
      { id: 'task-open', employeeId: 'employee-1', cycleName: '本季度绩效', status: 'manager_scoring', rawGrade: 'UNPUBLISHED_SECRET_GRADE', publishedAt: null },
      { id: 'task-published', employeeId: 'employee-1', cycleName: '上季度绩效', status: 'published', rawGrade: 'B', publishedAt: '2026-07-01T00:00:00.000Z' },
    ], total: 2, page: 1, pageSize: 50,
  }) }));
  await page.route('**/api/v1/confirmation-applications/11111111-1111-4111-8111-111111111111**', (route) => {
    if (route.request().method() === 'POST') {
      submitted.push(route.request().postDataJSON());
      status = 'manager_approved';
      return route.fulfill({ json: apiResponse({ id: '11111111-1111-4111-8111-111111111111', status }) });
    }
    return route.fulfill({ json: apiResponse({
      id: '11111111-1111-4111-8111-111111111111', workflowVersion: 2, status,
      employeeId: 'employee-1', employee: { id: 'employee-1', name: '试用期员工' },
      managerId: 'manager-1', manager: { id: 'manager-1', name: '花名册直属主管' },
      hrId: 'hr-1', hr: { id: 'hr-1', name: 'HR 办理人' },
      companyApproverId: 'approver-1', companyApprover: { id: 'approver-1', name: '公司审批人' },
      summary: '完成项目交付，继续改进协作', salary: null, actualRegularDate: null,
      canApprove: ['submitted', 'manager_approved'].includes(status), canReturn: true, canReject: false,
      pendingRole: status === 'submitted' ? 'manager' : 'hr',
      history: [
        { id: 'history-submit', label: '员工提交申请', actorName: '试用期员工', occurredAt: '2026-09-15T02:32:00.000Z', submissionVersion: 1, note: null },
      ],
      steps: [
        { role: 'manager', status: 'pending', approver: { id: 'manager-1', name: '花名册直属主管' }, comment: null, actedAt: null },
        { role: 'hr', status: 'pending', approver: { id: 'hr-1', name: 'HR 办理人' }, comment: null, actedAt: null },
        { role: 'company', status: 'pending', approver: { id: 'approver-1', name: '公司审批人' }, comment: null, actedAt: null },
      ],
    }) });
  });
  await page.goto('/confirmation-applications/11111111-1111-4111-8111-111111111111');
  const performanceHelp = page.getByLabel('绩效参考说明');
  await expect(performanceHelp).toBeVisible();
  await expect(page.getByText('仅展示您按绩效模块原有权限可见的记录；绩效等级以已发布的正式结果为准。', { exact: true })).toHaveCount(0);
  await performanceHelp.hover();
  await expect(page.getByRole('tooltip')).toContainText('仅展示您按绩效模块原有权限可见的记录；绩效等级以已发布的正式结果为准。');
  const approvalTimeline = page.getByTestId('confirmation-approval-timeline');
  await expect(approvalTimeline).toBeVisible();
  await expect(approvalTimeline.locator('.approval-timeline__title').filter({ hasText: '员工提交申请' })).toBeVisible();
  await expect(approvalTimeline.getByText('直属主管', { exact: true })).toBeVisible();
  await expect(approvalTimeline.getByText('待办理', { exact: true })).toBeVisible();
  await expect(page.getByText('办理记录（1）', { exact: true })).toHaveCount(0);
  await page.getByText('查看可见的绩效记录（最近 2 条）').click();
  await expect(page.getByText('查看已发布等级')).toHaveCount(1);
  await expect(page.getByText('UNPUBLISHED_SECRET_GRADE')).toHaveCount(0);
  await expect(page.getByPlaceholder('请说明工作表现和评价原因')).toHaveCount(0);
  await page.getByRole('button', { name: '办理', exact: true }).click();
  const managerDialog = page.getByRole('dialog', { name: '直属主管评价' });
  await expect(managerDialog).toBeVisible();
  await managerDialog.getByRole('button', { name: '提交评价' }).click();
  await expect(managerDialog.getByText('请选择是否建议转正并填写评价原因')).toBeVisible();
  await managerDialog.getByText('暂不建议转正', { exact: true }).click();
  await managerDialog.getByPlaceholder('请说明工作表现和评价原因').fill('需要继续改进协作');
  await managerDialog.getByRole('button', { name: '提交评价' }).click();
  await expect.poll(() => submitted).toEqual([{ recommendation: false, comment: '需要继续改进协作' }]);
  await expect(managerDialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: '办理', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '办理', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'HR 线下评议' })).toBeVisible();
  await expect(page.getByText('述职表决')).toHaveCount(0);
});

test('authorized HR can submit an attachment-only conclusion with optional meeting date', async ({ page }) => {
  const submitted: unknown[] = [];
  let status = 'manager_approved';
  const attachments: Array<Record<string, unknown>> = [];
  const attachmentContentTypes: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-hr-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: apiResponse(0) }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: apiResponse({
    id: 'hr-1', name: 'HR 办理人', status: 'active', sysRole: 'hr_user', deptId: null,
    hrCapabilities: ['confirmation_manage'],
    isAssessorOnly: false, canViewAll: false,
  }) }));
  await page.route('**/api/v1/confirmation-applications/11111111-1111-4111-8111-111111111111**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST' && path.endsWith('/meeting-attachments')) {
      attachmentContentTypes.push(route.request().headers()['content-type'] ?? '');
      const attachment = { id: 'file-1', name: '依据.pdf', size: 12, mimeType: 'application/pdf', uploadedById: 'hr-1', createdAt: new Date().toISOString() };
      attachments.push(attachment);
      return route.fulfill({ json: apiResponse(attachment) });
    }
    if (route.request().method() === 'POST' && path.endsWith('/approve')) {
      submitted.push(route.request().postDataJSON());
      status = 'hr_approved';
      return route.fulfill({ json: apiResponse({ id: '11111111-1111-4111-8111-111111111111', status }) });
    }
    return route.fulfill({ json: apiResponse({
      id: '11111111-1111-4111-8111-111111111111', workflowVersion: 2, status,
      employeeId: 'employee-1', employee: { id: 'employee-1', name: '试用期员工' },
      managerId: 'manager-1', manager: { id: 'manager-1', name: '直属主管' },
      hrId: status === 'hr_approved' ? 'hr-1' : null,
      hr: status === 'hr_approved' ? { id: 'hr-1', name: '实际经办 HR' } : null,
      companyApproverId: 'approver-1', companyApprover: { id: 'approver-1', name: '公司审批人' },
      summary: '完成工作交付', meetingAttachments: attachments, voteResult: status === 'hr_approved' ? 'extend' : null,
      canApprove: status === 'manager_approved', canReturn: status === 'manager_approved', canReject: false, canViewInternalMeeting: true,
      pendingRole: status === 'manager_approved' ? 'hr' : 'company',
      steps: [],
    }) });
  });
  await page.goto('/confirmation-applications/11111111-1111-4111-8111-111111111111');
  const actionTop = await page.locator('.detail-actions').evaluate((element) => element.getBoundingClientRect().top);
  const timelineTop = await page.getByTestId('confirmation-approval-timeline').evaluate((element) => element.getBoundingClientRect().top);
  expect(actionTop).toBeLessThan(timelineTop);
  await expect(page.getByText('选择评议结论', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '办理', exact: true }).click();
  const hrDialog = page.getByRole('dialog', { name: 'HR 线下评议' });
  await expect(hrDialog).toBeVisible();
  await expect(hrDialog.getByRole('button', { name: '退回员工', exact: true })).toBeVisible();
  await hrDialog.getByRole('button', { name: '退回员工', exact: true }).click();
  await expect(hrDialog.getByText('请填写退回员工的原因')).toBeVisible();
  await expect(hrDialog.getByPlaceholder('请说明需要员工补充的内容')).toHaveCount(0);
  await expect(hrDialog.getByRole('button', { name: '提交退回补充' })).toHaveCount(0);
  await hrDialog.getByRole('button', { name: '提交公司审批' }).click();
  await expect(hrDialog.getByText('请填写评议结论和拟生效日期')).toBeVisible();
  await page.getByText('选择评议结论', { exact: true }).click();
  await page.getByRole('option', { name: '建议延长试用' }).click();
  await hrDialog.getByPlaceholder('拟生效日期（必填）').fill('2026-10-01');
  await hrDialog.getByPlaceholder('拟生效日期（必填）').press('Tab');
  await hrDialog.getByRole('button', { name: '提交公司审批' }).click();
  await expect(hrDialog.getByText('请填写结论依据或上传内部附件')).toBeVisible();
  await hrDialog.locator('input[type="file"]').setInputFiles({ name: '依据.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') });
  await expect(hrDialog.getByText('已上传 1 个附件')).toBeVisible();
  expect(attachmentContentTypes).toHaveLength(1);
  expect(attachmentContentTypes[0]).toMatch(/^multipart\/form-data; boundary=/);
  await hrDialog.getByRole('button', { name: '提交公司审批' }).click();
  await expect.poll(() => submitted).toHaveLength(1);
  expect(submitted[0]).toMatchObject({ voteResult: 'extend', proposedRegularDate: '2026-10-01' });
  expect(submitted[0]).not.toHaveProperty('meetingDate');
  await expect(hrDialog).not.toBeVisible();
});

test('company approver uses one optional reason and two decision buttons on mobile', async ({ page }) => {
  const submitted: unknown[] = [];
  let status = 'hr_approved';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-company-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: apiResponse(0) }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: apiResponse({
    id: 'approver-1', name: '公司审批人', status: 'active', sysRole: 'employee', deptId: null,
    isAssessorOnly: false, canViewAll: false,
  }) }));
  await page.route('**/api/v1/confirmation-applications/11111111-1111-4111-8111-111111111111**', (route) => {
    if (route.request().method() === 'POST') {
      submitted.push(route.request().postDataJSON());
      status = 'approved';
      return route.fulfill({ json: apiResponse({ id: '11111111-1111-4111-8111-111111111111', status }) });
    }
    return route.fulfill({ json: apiResponse({
      id: '11111111-1111-4111-8111-111111111111', workflowVersion: 2, status,
      employeeId: 'employee-1', employee: { id: 'employee-1', name: '试用期员工' },
      managerId: 'manager-1', manager: { id: 'manager-1', name: '直属主管' },
      hrId: 'hr-1', hr: { id: 'hr-1', name: 'HR 办理人' },
      companyApproverId: 'approver-1', companyApprover: { id: 'approver-1', name: '公司审批人' },
      summary: '完成工作交付', voteResult: 'pass', proposedRegularDate: '2026-10-01',
      meetingAttachments: [], actualRegularDate: status === 'approved' ? '2026-10-01' : null,
      canApprove: status === 'hr_approved', canReject: status === 'hr_approved', pendingRole: status === 'hr_approved' ? 'company' : null,
      history: [
        { id: 'history-submit', label: '员工提交申请', actorName: '试用期员工', occurredAt: '2026-09-15T02:32:00.000Z', submissionVersion: 1, note: null },
        { id: 'history-manager', label: '直属主管提交评价', actorName: '直属主管', occurredAt: '2026-09-15T03:00:00.000Z', submissionVersion: 1, note: null },
        { id: 'history-hr', label: 'HR 记录线下评议', actorName: 'HR 办理人', occurredAt: '2026-09-15T04:00:00.000Z', submissionVersion: 1, note: null },
      ],
      steps: [
        { role: 'manager', status: 'approved', approver: { id: 'manager-1', name: '直属主管' }, comment: '建议转正', actedAt: '2026-09-15T03:00:00.000Z' },
        { role: 'hr', status: 'approved', approver: { id: 'hr-1', name: 'HR 办理人' }, comment: '评议通过', actedAt: '2026-09-15T04:00:00.000Z' },
        { role: 'company', status: 'pending', approver: { id: 'approver-1', name: '公司审批人' }, comment: null, actedAt: null },
      ],
    }) });
  });
  await page.goto('/confirmation-applications/11111111-1111-4111-8111-111111111111');
  await expect(page.getByTestId('confirmation-approval-timeline').getByText('公司审批', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '同意转正', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '办理', exact: true }).click();
  const companyDialog = page.getByRole('dialog', { name: '公司最终决定' });
  await expect(companyDialog).toBeVisible();
  await expect(companyDialog.getByText('HR 拟生效日期：')).toBeVisible();
  await expect(companyDialog.locator('textarea')).toHaveCount(1);
  await expect(companyDialog.getByText('已核对并确认上述生效日期')).toHaveCount(0);
  await expect(companyDialog.getByRole('button', { name: '退回员工补充' })).toHaveCount(0);
  await companyDialog.getByPlaceholder('请输入理由（选填）').fill('业务确认');
  await companyDialog.getByRole('button', { name: '同意', exact: true }).click();
  await expect.poll(() => submitted).toEqual([{ confirmedRegularDate: '2026-10-01', comment: '业务确认' }]);
  await expect(companyDialog).not.toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('company approver can decline without filling the optional reason', async ({ page }) => {
  const submitted: unknown[] = [];
  let status = 'hr_approved';
  const applicationId = '11111111-1111-4111-8111-111111111111';
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-return-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: apiResponse(0) }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: apiResponse({
    id: 'approver-1', name: '公司审批人', status: 'active', sysRole: 'employee', deptId: null,
    isAssessorOnly: false, canViewAll: false,
  }) }));
  await page.route('**/api/v1/confirmation-applications**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const app = {
      id: applicationId, workflowVersion: 2, submissionVersion: 1, status, returnReason: null,
      employeeId: 'employee-1', employee: { id: 'employee-1', name: '试用期员工' },
      managerId: 'manager-1', manager: { id: 'manager-1', name: '直属主管' },
      hrId: 'hr-1', hr: { id: 'hr-1', name: 'HR 办理人' },
      companyApproverId: 'approver-1', companyApprover: { id: 'approver-1', name: '公司审批人' },
      summary: '原工作小结', proposedRegularDate: '2026-10-01', meetingAttachments: [],
      canApprove: status === 'hr_approved', canReturn: status === 'hr_approved', canReject: status === 'hr_approved',
      pendingRole: status === 'hr_approved' ? 'company' : null, steps: [],
    };
    if (route.request().method() === 'POST' && path.endsWith('/reject')) {
      submitted.push(route.request().postDataJSON());
      status = 'rejected';
      return route.fulfill({ json: apiResponse({ id: applicationId, status }) });
    }
    return route.fulfill({ json: apiResponse(app) });
  });
  await page.goto(`/confirmation-applications/${applicationId}`);
  await page.getByRole('button', { name: '办理', exact: true }).click();
  const companyDialog = page.getByRole('dialog', { name: '公司最终决定' });
  await companyDialog.getByRole('button', { name: '不同意', exact: true }).click();
  await expect.poll(() => submitted).toEqual([{}]);
  await expect(companyDialog).not.toBeVisible();
});

test('assigned approver uses the same transfer management filters, columns and row actions as HR', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-manager-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: apiResponse(0) }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: apiResponse({
    id: 'approver-1', name: '分管审批人', status: 'active', sysRole: 'employee', deptId: null,
    isAssessorOnly: false, canViewAll: false,
    businessCapabilities: { canHandleConfirmationApprovals: true },
  }) }));
  await page.route('**/api/v1/confirmation-applications/assigned**', (route) => route.fulfill({ json: apiResponse({
    items: [
      {
        id: '11111111-1111-4111-8111-111111111111', workflowVersion: 2,
        employee: { id: 'employee-1', name: '已办理员工' }, status: 'approved', pendingRole: null,
        manager: { id: 'manager-1', name: '直属主管甲' }, hr: { id: 'hr-1', name: 'HR 甲' },
        companyApprover: { id: 'approver-1', name: '分管审批人' }, actualRegularDate: '2026-09-01',
      },
      {
        id: '22222222-2222-4222-8222-222222222222', workflowVersion: 2,
        employee: { id: 'employee-2', name: '待办理员工' }, status: 'hr_approved', pendingRole: 'company',
        manager: { id: 'manager-2', name: '直属主管乙' }, hr: { id: 'hr-2', name: 'HR 乙' },
        companyApprover: { id: 'approver-1', name: '分管审批人' }, actualRegularDate: null,
      },
    ], total: 2, page: 1, pageSize: 10,
  }) }));
  await page.goto('/confirmation-applications/approvals');
  await expect(page).toHaveURL(/\/confirmation-applications\/manage$/);
  await expect(page.getByText('转正管理', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('待我办理', { exact: true })).toHaveCount(0);
  await expect(page.getByText('办理记录', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '状态' })).toBeVisible();
  await expect(page.getByText('已办理员工').first()).toBeVisible();
  await expect(page.getByText('待办理员工').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '查看' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '办理' }).first()).toBeVisible();
  for (const column of ['直属主管', 'HR 实际经办', '公司审批人', '实际转正日期']) {
    await expect(page.getByRole('columnheader', { name: column })).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.mobile-result-list').getByText('HR 实际经办').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test('probation and confirmation navigation only exposes personal application and role management', () => {
  const menuItems = (
    sysRole: 'hr' | 'system_admin' | 'hr_user' | 'employee',
    hrCapabilities: HrCapability[] = [],
    businessCapabilities: { canHandleConfirmationApprovals?: boolean; canHandleProbationReviews?: boolean } = {},
  ) =>
    buildNavigation(routes, { sysRole, canViewAll: false, hrCapabilities, businessCapabilities })
      .find((module) => module.key === 'performance')?.groups
      .find((group) => group.key === 'performance-probation')?.items ?? [];

  const labels = (
    sysRole: 'hr' | 'system_admin' | 'hr_user' | 'employee',
    hrCapabilities: HrCapability[] = [],
    businessCapabilities: { canHandleConfirmationApprovals?: boolean; canHandleProbationReviews?: boolean } = {},
  ) => menuItems(sysRole, hrCapabilities, businessCapabilities)
    .map((item) => ({ path: item.path, label: item.label }));

  expect(labels('employee')).toEqual([
    { path: '/confirmation-applications/mine', label: '我的转正申请' },
  ]);
  expect(labels('hr', ['confirmation_manage'])).toEqual([
    { path: '/confirmation-applications/manage', label: '转正管理' },
    { path: '/confirmation-applications/mine', label: '我的转正申请' },
  ]);
  expect(labels('hr', ['confirmation_manage'], { canHandleConfirmationApprovals: true })).toEqual([
    { path: '/confirmation-applications/manage', label: '转正管理' },
    { path: '/confirmation-applications/mine', label: '我的转正申请' },
  ]);
  expect(labels('employee', [], { canHandleConfirmationApprovals: true })).toEqual([
    { path: '/confirmation-applications/manage', label: '转正管理' },
    { path: '/confirmation-applications/mine', label: '我的转正申请' },
  ]);

  const managerItems = buildNavigation(routes, {
    sysRole: 'employee', canViewAll: false, businessCapabilities: { canHandleProbationReviews: true },
  }).find((module) => module.key === 'performance')?.groups
    .find((group) => group.key === 'performance-probation')?.items ?? [];
  expect(managerItems.filter((item) => item.path.startsWith('/probation-reviews/'))).toEqual([]);
});

test('transfer management shows attention without handler assignment on mobile and desktop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-hr-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: apiResponse(0) }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: apiResponse({
    id: 'hr-1', name: 'HR 管理员', status: 'active', sysRole: 'hr', deptId: null,
    isAssessorOnly: false, canViewAll: false,
  }) }));
  await page.route('**/api/v1/confirmation-applications**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/warnings')) return route.fulfill({ json: apiResponse([
      { employeeId: 'employee-2', employeeName: '缺日期员工', employeeNo: 'E002', deptName: '业务部', plannedRegularDate: null, daysUntil: null, hasApplication: false },
      { employeeId: 'employee-3', employeeName: '临期员工', employeeNo: 'E003', deptName: '业务部', plannedRegularDate: '2026-09-17', daysUntil: 3, hasApplication: false },
    ]) });
    return route.fulfill({ json: apiResponse({
      items: [{ id: 'app-1', workflowVersion: 2, submissionVersion: 0, status: 'draft',
        employeeId: 'employee-1', employee: { id: 'employee-1', name: '待转正员工' },
        manager: { id: 'manager-1', name: '花名册直属主管' },
        hr: null, companyApprover: null,
      }], total: 1, page: 1, pageSize: 10,
    }) });
  });
  await page.goto('/confirmation-applications/manage');
  await expect(page.getByRole('button', { name: '查看试用期历史记录' })).toHaveCount(0);
  const attentionTrigger = page.getByTestId('confirmation-attention-trigger');
  await expect(attentionTrigger).toHaveText('待关注 2 人');
  await expect(page.getByText('缺日期员工')).not.toBeVisible();
  await attentionTrigger.click();
  const attentionDrawer = page.getByRole('dialog', { name: '试用期员工待关注' });
  await expect(attentionDrawer.getByText('缺日期员工')).toBeVisible();
  await expect(attentionDrawer.getByText('计划转正日期待核实')).toBeVisible();
  await expect(attentionDrawer.getByText('临期员工')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(attentionDrawer).not.toBeVisible();
  await expect(page.getByRole('button', { name: '指定办理人' })).toHaveCount(0);
  await expect(page.locator('.mobile-result-list').getByText('HR 实际经办')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(attentionTrigger).toBeVisible();
  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(desktopOverflow).toBeLessThanOrEqual(1);
});
