import { expect, test, type Page } from '@playwright/test';

const response = (data: unknown) => ({ code: 0, message: 'success', data });

async function openEditor(page: Page, profileMissing = false, noCurrentEmployment = false) {
  const saved: any[] = [];
  const employee = { id: 'quality-employee', name: '虚构档案员工', employeeNo: 'Q001', status: 'active',
    deptId: null, positionId: 'quality-position', position: '测试岗位', employmentType: 'full_time',
    sysRole: 'employee', directManagerId: 'quality-manager', archivedAt: null, businessIdentities: [] };
  const manager = { ...employee, id: 'quality-manager', name: '虚构上级', employeeNo: 'Q002' };
  let draft: any = null;
  const archive = { ...employee, phone: '19900000001', archiveVersion: 'quality-baseline', dept: null,
    entryDate: '2024-01-01', performanceManager: manager, rosterManager: manager,
    employeeProfile: profileMissing ? null : { phone: '19900000001', gender: '女' },
    currentEmployment: noCurrentEmployment ? null : { company: 'fuede', positionId: 'quality-position', directManagerId: manager.id },
    employmentHistory: noCurrentEmployment ? [{ company: 'fuede', effectiveFrom: '2030-01-01', positionId: 'quality-position' }] : [],
    employeeContracts: [{ id: 'quality-contract', name: '转签存档', contractType: 'transfer',
      isActive: true, sequence: 0, signedAt: '2026-10-01', originalCompany: '原旧公司', newCompany: null,
      images: [], attachments: [] }], externalIdentityBindings: [] };
  await page.addInitScript(() => {
    localStorage.setItem('token', 'quality-mock-token');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let data: unknown = [];
    if (path === '/auth/me') data = { id: 'quality-admin', name: '虚构管理员', sysRole: 'system_admin', canViewAll: true };
    else if (path === '/notifications/unread-count') data = 0;
    else if (path === '/users') data = { items: [employee, manager], total: 2, page: 1, pageSize: 20 };
    else if (path === '/users/quality-manager') data = manager;
    else if (path === '/positions') data = [{ id: 'quality-position', name: '测试岗位', isActive: true }];
    else if (path === '/contract-subjects') data = [
      { id: 'subject-a', name: '目录公司甲', isActive: true }, { id: 'subject-b', name: '目录公司乙', isActive: true },
      { id: 'subject-old', name: '停用目录公司', isActive: false },
    ];
    else if (path === '/employee-archives/quality-employee') data = { ...archive, changeHistory: draft ? [draft] : [] };
    else if (path === '/employee-archives/quality-employee/draft/save') {
      const payload = route.request().postDataJSON();
      saved.push(payload);
      draft = { id: 'quality-draft', userId: employee.id, sourceType: 'manual_archive_change', recordStatus: 'draft',
        requestVersion: saved.length, proposedValue: payload };
      data = draft;
    } else if (path.endsWith('/list')) data = { items: [], total: 0, page: 1, pageSize: 20 };
    await route.fulfill({ json: response(data) });
  });
  await page.goto('/users');
  await page.getByRole('button', { name: '查看档案', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: '员工档案', exact: true });
  await drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
  await expect(drawer.getByText('个人信息免审字段在提交后生效，其余变更需审核；草稿不生效。', { exact: true })).toHaveCount(0);
  return { drawer, saved };
}

test('explicitly clears nullable relationships and gender in the autosaved wire payload', async ({ page }) => {
  const { drawer, saved } = await openEditor(page);
  for (const field of ['employee.positionId', 'employee.managerId', 'performance.managerId', 'profile.gender']) {
    const select = drawer.locator(`[data-archive-field="${field}"] .el-select`);
    await select.hover();
    await select.locator('.el-select__clear').click();
  }
  await expect.poll(() => saved.at(-1)).toMatchObject({
    employee: { positionId: null, position: null, managerId: null },
    performance: { managerId: null }, profile: { gender: null },
  });
  await expect(drawer.locator('.archive-save-state')).toHaveText('草稿已保存，尚未提交');
});

test('preserves a legacy account phone when its profile is missing, while allowing an explicit clear', async ({ page }) => {
  const { drawer, saved } = await openEditor(page, true);
  const phone = drawer.locator('[data-archive-field="profile.phone"] input');
  await expect(phone).toHaveValue('19900000001');
  await drawer.locator('[data-archive-field="employee.name"] input').fill('虚构档案更名');
  await expect.poll(() => saved.at(-1)).toMatchObject({ employee: { phone: '19900000001' }, profile: { phone: '19900000001' } });
  await phone.fill('');
  await expect.poll(() => saved.at(-1)).toMatchObject({ employee: { phone: null }, profile: { phone: null } });
});

test('uses dated contract titles and maintained company choices for transfer companies', async ({ page }) => {
  const { drawer, saved } = await openEditor(page);
  const card = drawer.locator('.contract-card');
  await expect(card.locator('.contract-card__head strong')).toHaveText('转签存档 · 2026-10-01 签订');
  for (const [field, company] of [['originalCompany', '目录公司甲'], ['newCompany', '目录公司乙']]) {
    const select = card.locator(`[data-archive-field="contracts.0.${field}"] .el-select`);
    await select.click();
    const listboxId = await select.locator('input').getAttribute('aria-controls');
    const listbox = page.locator(`[id="${listboxId}"]`);
    await expect(listbox.getByRole('option', { name: '停用目录公司', exact: true })).toHaveCount(0);
    await listbox.getByRole('option', { name: company, exact: true }).click();
  }
  await expect.poll(() => saved.at(-1)).toMatchObject({ contracts: [{ originalCompany: '目录公司甲', newCompany: '目录公司乙' }] });
});

test('identifies the fallback employment record instead of presenting it as current employment', async ({ page }) => {
  const { drawer } = await openEditor(page, false, true);
  await expect(drawer.getByText('当前无有效任职，以下任职资料沿用最近一次记录（生效日期：2030-01-01）', { exact: true })).toBeVisible();
});
