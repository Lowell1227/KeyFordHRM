import { expect, test } from '@playwright/test';

for (const { width, companyText } of [1440, 1024, 390].flatMap((width) =>
  ['可单独修改的公司名称', ''].map((companyText) => ({ width, companyText })))) {
  test(`${width}px 公司原文${companyText ? '修改' : '清空'}后审核详情和历史可见`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const employee = { id: 'company-employee', name: '公司原文员工', employeeNo: 'COMP001',
      deptId: 'dept-1', deptName: '项目部', sysRole: 'employee', status: 'active', employmentType: 'full_time',
      isAssessorOnly: false, canViewAll: false, hrCapabilities: [], businessIdentities: [],
      position: null, entryDate: '2024-01-01', archivedAt: null, dingtalkBindingState: 'unbound' };
    const employment = { id: 'employment-1', company: 'fuede', companyText: '杭州花名册公司原文有限公司',
      employeeStatus: 'active', employmentType: 'full_time', effectiveFrom: '2024-01-01', effectiveTo: null,
      deptId: 'dept-1', positionId: null, entryDate: '2024-01-01', directManager: null };
    let submitted: Record<string, any> | undefined;
    const review = () => ({ id: 'review-1', userId: employee.id, employeeNo: employee.employeeNo,
      employeeName: employee.name, sourceType: 'manual_archive_change', recordStatus: 'submitted',
      profileReviewStatus: 'pending', performanceReviewStatus: 'not_required', validationErrors: [],
      validationWarnings: [], createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z',
      createdBy: { id: 'admin-1', name: '管理员' }, appliedAt: null, events: [],
      baseValue: { employee: { company: 'fuede', companyText: employment.companyText }, profile: {}, contracts: [] },
      proposedValue: { employee: { company: submitted?.employee.company, companyText: submitted?.employee.companyText }, profile: {}, contracts: [] },
    });
    await page.addInitScript(() => {
      localStorage.setItem('token', 'company-text-test');
      localStorage.setItem('expiresAt', String(Date.now() + 600_000));
    });
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data: unknown = [];
      if (path.endsWith('/auth/me')) data = { id: 'admin-1', name: '管理员', sysRole: 'system_admin', canViewAll: true };
      else if (path.endsWith('/contract-subjects')) data = [{ id: 'new-subject', name: '可单独修改的公司名称', isActive: true }];
      else if (path.endsWith('/notifications/unread-count')) data = 0;
      else if (path.endsWith('/users')) data = { items: [employee], total: 1, page: 1, pageSize: 20 };
      else if (path.endsWith('/departments')) data = [{ id: 'dept-1', name: '项目部', company: 'fuede', children: [] }];
      else if (path.endsWith(`/employee-archives/${employee.id}`)) data = { ...employee, employeeProfile: null,
        currentEmployment: employment, employmentHistory: [employment], employeeContracts: [],
        changeHistory: submitted ? [review()] : [],
        dept: { id: 'dept-1', name: '项目部', company: 'fuede' }, rosterManager: null, performanceManager: null };
      else if (path.endsWith(`/employee-archives/${employee.id}/draft`)) {
        submitted = route.request().postDataJSON();
        data = { id: 'review-1', profileReviewStatus: 'pending' };
      } else if (path.endsWith('/applications/review-1')) data = review();
      else if (path.endsWith('/applications/list') || path.endsWith('/reviews/list')) data = { items: submitted ? [review()] : [], total: submitted ? 1 : 0, page: 1, pageSize: 20 };
      else if (path.endsWith('/list')) data = { items: [], total: 0, page: 1, pageSize: 20 };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'success', data }) });
    });
    await page.goto('/users');
    await page.getByRole('button', { name: '查看档案', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '员工档案', exact: true });
    await drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
    const company = drawer.locator('.el-form-item').filter({ has: page.getByText('所属公司（合同主体）', { exact: true }) });
    await expect(company.getByText('杭州花名册公司原文有限公司 · 原记录，尚未关联')).toBeVisible();
    if (companyText) {
      await company.getByRole('combobox').click();
      await page.getByRole('option', { name: companyText, exact: true }).click();
    } else await company.getByRole('button', { name: '清空主体', exact: true }).click();
    await expect(drawer.getByRole('combobox', { name: '组织归属', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`company-text-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await drawer.getByRole('button', { name: '提交审核', exact: true }).click();
    await expect.poll(() => submitted?.employee.companyText).toBe(companyText || null);
    expect(submitted?.employee.company).toBe('fuede');

    await page.goto('/personnel-processing');
    await page.getByRole('button', { name: '查看办理详情', exact: true }).click();
    const detail = page.getByRole('dialog', { name: '档案修改办理详情', exact: true });
    await expect(detail.getByText('所属公司（合同主体）', { exact: true })).toBeVisible();
    await expect(detail.getByText(`杭州花名册公司原文有限公司 → ${companyText || '—'}`, { exact: true })).toBeVisible();
    await expect(detail.getByText('组织归属', { exact: true })).toHaveCount(0);
    await detail.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('tab', { name: '待我审核', exact: true }).click();
    await expect(page.getByText('所属公司（合同主体）', { exact: true }).filter({ visible: true })).toBeVisible();

    await page.goto('/users');
    await page.getByRole('button', { name: '查看档案', exact: true }).click();
    await drawer.getByRole('tab', { name: '变更记录', exact: true }).click();
    await drawer.locator('.change-history .el-collapse-item__header').click();
    await expect(drawer.getByText('所属公司（合同主体）', { exact: true })).toBeVisible();
    await expect(drawer.getByText(`杭州花名册公司原文有限公司 → ${companyText || '未填写'}`, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}
