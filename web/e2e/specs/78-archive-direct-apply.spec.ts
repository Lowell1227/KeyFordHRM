import { expect, test, type Page } from '@playwright/test';

const employee = { id: 'direct-apply-person', name: '合成直改员工', employeeNo: 'DA001',
  sysRole: 'employee', status: 'active', employmentType: 'full_time',
  hrCapabilities: [], businessIdentities: [], archivedAt: null, dingtalkBindingState: 'unbound' };
const department = { id: 'direct-dept', name: '合成部门', company: 'fuede', children: [] };
const profile = { phone: '13800000000', education: '本科' };

async function setup(page: Page, draftResponse: () => { request: unknown; directApplied: string[] }) {
  const state = { submissions: [] as any[] };
  await page.addInitScript(() => {
    localStorage.setItem('token', 'SYNTHETIC-DIRECT-APPLY-ONLY');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data: any = [];
    if (path.endsWith('/auth/me')) data = { id: 'hr-direct', name: '合成 HR', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] };
    else if (path.endsWith('/notifications/unread-count')) data = 0;
    else if (path.endsWith('/departments')) data = [department];
    else if (path.endsWith('/users')) data = { items: [employee], total: 1, page: 1, pageSize: 20 };
    else if (path.endsWith(`/employee-archives/${employee.id}`)) {
      const employment = { id: 'direct-employment', company: 'fuede', companyText: null, deptId: department.id,
        positionId: null, employeeStatus: 'active', employmentType: 'full_time', effectiveFrom: '2026-01-01', entryDate: '2026-01-01' };
      data = { ...employee, archiveVersion: 'direct-version', dept: department, currentEmployment: employment,
        employmentHistory: [employment], employeeProfile: profile, employeeContracts: [], changeHistory: [], latestResignationReview: null };
    } else if (path.endsWith(`/${employee.id}/draft/save`)) {
      data = { id: 'direct-draft', requestVersion: 1, recordStatus: 'draft' };
    } else if (path.endsWith(`/${employee.id}/draft`)) {
      state.submissions.push(route.request().postDataJSON());
      data = draftResponse();
    } else if (path.endsWith('/list')) data = { items: [], total: 0, page: 1, pageSize: 20 };
    await route.fulfill({ json: { code: 0, message: 'success', data } });
  });
  return state;
}

async function openEditorAndEditPhone(page: Page) {
  await page.goto('/users');
  await page.getByRole('button', { name: '查看档案', exact: true }).filter({ visible: true }).first().click();
  const archive = page.getByRole('dialog', { name: '员工档案', exact: true });
  await archive.getByRole('button', { name: '编辑档案', exact: true }).click();
  await archive.locator('[data-archive-field="profile.phone"]').getByRole('textbox').fill('13911112222');
  return archive;
}

test('只改免审个人信息字段时提示已直接生效，不提示提交审核', async ({ page }) => {
  const state = await setup(page, () => ({ request: null, directApplied: ['手机号'] }));
  const archive = await openEditorAndEditPhone(page);
  await archive.getByRole('button', { name: '提交审核', exact: true }).click();
  await expect(page.getByText('手机号已直接生效', { exact: true }).first()).toBeVisible();
  await expect(archive.getByText('手机号已直接生效', { exact: true })).toBeVisible();
  expect(state.submissions.at(-1)?.profile?.phone).toBe('13911112222');
});

test('混合修改时提示免审字段直改、其余变更已提交审核', async ({ page }) => {
  const state = await setup(page, () => ({
    request: { id: 'direct-request', requestVersion: 2, recordStatus: 'submitted', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required' },
    directApplied: ['手机号'],
  }));
  const archive = await openEditorAndEditPhone(page);
  await archive.locator('[data-archive-field="employee.name"]').getByRole('textbox').fill('合成直改员工甲');
  await archive.getByRole('button', { name: '提交审核', exact: true }).click();
  await expect(page.getByText('手机号已直接生效，其余变更已提交审核，审核通过后生效', { exact: true }).first()).toBeVisible();
  expect(state.submissions.at(-1)?.employee?.name).toBe('合成直改员工甲');
});

test('只改需审核字段时维持原提交审核提示', async ({ page }) => {
  const state = await setup(page, () => ({
    request: { id: 'direct-request', requestVersion: 2, recordStatus: 'submitted', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required' },
    directApplied: [],
  }));
  await page.goto('/users');
  await page.getByRole('button', { name: '查看档案', exact: true }).filter({ visible: true }).first().click();
  const archive = page.getByRole('dialog', { name: '员工档案', exact: true });
  await archive.getByRole('button', { name: '编辑档案', exact: true }).click();
  await archive.locator('[data-archive-field="employee.name"]').getByRole('textbox').fill('合成直改员工乙');
  await archive.getByRole('button', { name: '提交审核', exact: true }).click();
  await expect(page.getByText('档案变更已提交审核，审核通过后生效', { exact: true })).toBeVisible();
  expect(state.submissions.at(-1)?.employee?.name).toBe('合成直改员工乙');
});
