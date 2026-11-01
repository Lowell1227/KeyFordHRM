import { expect, test, type Page } from '@playwright/test';

const review = {
  id: 'synthetic-review', userId: 'synthetic-person', employeeNo: 'SYN073', employeeName: '合成审核员工',
  sourceType: 'manual_archive_change', recordStatus: 'submitted', profileReviewStatus: 'pending', performanceReviewStatus: 'pending',
  validationErrors: [], createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', createdBy: { name: '合成 HR' },
  baseValue: {
    employee: { name: '原合成姓名', company: 'fuede', deptId: 'old-dept', positionId: 'old-position', position: '原合成岗位', managerId: 'old-manager', workLocation: '原办公地', phone: 'synthetic-phone-old', employmentType: 'full_time', employeeStatus: 'active', entryDate: '2024-01-01T00:00:00.000Z' },
    profile: { housingFundStatus: '未缴纳', housingFundStartDate: null, education: '本科', childrenCount: 1, bankName: '原合成开户行', idNumberConfigured: false },
    performance: { managerId: 'old-manager' },
    contracts: [
      { id: 'retained-contract', contractType: 'contract', sequence: 0, name: '合成保留合同', confidentialityAgreement: '未签', nonCompeteAgreement: '未签', portraitAgreement: '已签', originalCompany: '原签约公司', newCompany: '原变更公司', signedAt: '2024-01-01', attachments: [{ name: '原合成附件.pdf', url: '/private-old-file' }] },
      { id: 'removed-contract', contractType: 'contract', sequence: 1, name: '合成移除合同', termType: '一年', portraitAgreement: '已签' },
    ],
  },
  proposedValue: {
    employee: { name: '新合成姓名', company: 'fuede', deptId: 'new-dept', positionId: 'new-position', position: '新合成岗位', managerId: 'new-manager', workLocation: null, phone: 'synthetic-phone-new', employmentType: 'part_time', employeeStatus: 'probation', entryDate: '2024-01-01' },
    profile: { housingFundStatus: '正常缴纳', housingFundStartDate: '2026-11-01', education: '本科', childrenCount: 0, bankName: null, idNumberConfigured: true,
      idNumberEncrypted: 'SYNTHETIC-CIPHER-MUST-NOT-RENDER', bankAccount: 'SYNTHETIC-BANK-MUST-NOT-RENDER', unknownPrivateField: 'SYNTHETIC-UNKNOWN-MUST-NOT-RENDER' },
    performance: { managerId: 'new-manager' },
    contracts: [
      { id: 'retained-contract', contractType: 'contract', sequence: 0, name: '合成保留合同', confidentialityAgreement: '已签', nonCompeteAgreement: '已签', portraitAgreement: null, originalCompany: '新签约公司', newCompany: '新变更公司', signedAt: '2024-01-01T00:00:00.000Z', attachments: [{ name: '新合成附件.pdf', url: '/private-new-file' }] },
      { contractType: 'contract', sequence: 1, name: '合成新增合同', termType: '三年', confidentialityAgreement: '已签', nonCompeteAgreement: '已签', portraitAgreement: '已签' },
    ],
  },
};

async function setup(page: Page, item: any = review) {
  const state = { writes: [] as string[] };
  await page.addInitScript(() => { localStorage.setItem('token', 'SYNTHETIC-REVIEW-ONLY'); localStorage.setItem('expiresAt', String(Date.now() + 600_000)); });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') state.writes.push(path);
    let data: unknown = [];
    if (path.endsWith('/auth/me')) data = { id: 'synthetic-reviewer', name: '合成审核员', sysRole: 'hr_user', hrCapabilities: ['employee_archive_review'] };
    else if (path.endsWith('/notifications/unread-count')) data = 0;
    else if (path.endsWith('/reviews/list')) data = { items: [item], total: 1, page: 1, pageSize: 10 };
    else if (path.endsWith('/departments')) data = ['old', 'new'].map(prefix => ({ id: `${prefix}-dept`, name: `${prefix === 'old' ? '原' : '新'}合成部门`, children: [] }));
    else if (path.endsWith('/positions')) data = ['old', 'new'].map(prefix => ({ id: `${prefix}-position`, name: `${prefix === 'old' ? '原' : '新'}合成岗位`, isActive: true }));
    else if (/\/users\/(old|new)-manager$/.test(path)) data = { id: path.split('/').at(-1), name: `${path.endsWith('old-manager') ? '原' : '新'}合成上级` };
    else if (path.endsWith('/list') || path.endsWith('/users')) data = { items: [], total: 0, page: 1, pageSize: 20 };
    await route.fulfill({ json: { code: 0, message: 'success', data } });
  });
  await page.goto('/personnel-processing');
  await page.getByRole('tab', { name: '待我审核', exact: true }).click();
  await page.getByRole('button', { name: '查看变更明细', exact: true }).filter({ visible: true }).click();
  return state;
}

for (const width of [1440, 1024, 390]) {
  test(`${width}px review shows all changed fields and contract operations without private values`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const state = await setup(page);
    const detail = page.getByRole('dialog', { name: '员工变更明细', exact: true });
    await expect(detail).toBeVisible();
    const field = (key: string) => detail.locator(`[data-change-key="${key}"]`);
    await expect(field('employee.name')).toContainText('原合成姓名');
    await expect(field('employee.name')).toContainText('新合成姓名');
    await expect(field('employee.workLocation')).toContainText('清空');
    await expect(field('employee.workLocation')).toContainText('未填写');
    await expect(field('employee.deptId')).toContainText('原合成部门');
    await expect(field('employee.deptId')).toContainText('新合成部门');
    await expect(field('employee.positionId')).toContainText('新合成岗位');
    await expect(field('employee.managerId')).toContainText('花名册直属上级');
    await expect(field('employee.managerId')).toContainText('新合成上级');
    await expect(field('performance.managerId')).toContainText('绩效直属上级');
    await expect(field('performance.managerId')).toContainText('原合成上级');
    await expect(field('profile.housingFundStatus')).toContainText('未缴纳');
    await expect(field('profile.housingFundStatus')).toContainText('正常缴纳');
    await expect(field('profile.housingFundStartDate')).toContainText('新增');
    await expect(field('profile.childrenCount')).toContainText('0');
    await expect(field('profile.bankName')).toContainText('清空');
    await expect(field('profile.idNumberConfigured')).toContainText('已保存');
    await expect(field('employee.phone')).toContainText('已保存');
    for (const key of ['employee.company', 'employee.entryDate', 'profile.education']) await expect(field(key)).toHaveCount(0);

    const retained = detail.locator('[data-contract-key="retained-contract"]');
    for (const label of ['保密协议', '竞业协议', '肖像协议', '原公司', '新公司', '附件']) await expect(retained).toContainText(label);
    await expect(retained.locator('[data-change-key="portraitAgreement"]')).toContainText('清空');
    await expect(retained).toContainText('原合成附件.pdf');
    await expect(retained).toContainText('新合成附件.pdf');
    await expect(retained.locator('[data-change-key="signedAt"]')).toHaveCount(0);
    const removed = detail.locator('[data-contract-key="removed-contract"]');
    await expect(removed).toContainText('移除');
    await expect(removed).toContainText('一年');
    const added = detail.locator('.employee-review-contract').filter({ hasText: '合成新增合同' });
    await expect(added).toContainText('新增');
    await expect(added).toContainText('三年');
    await expect(added).toContainText('保密协议');
    await expect(added).toContainText('肖像协议');
    await expect(detail).not.toContainText(/MUST-NOT-RENDER|synthetic-phone-|private-old-file|private-new-file|old-manager|new-manager/);
    expect(state.writes).toEqual([]);
    expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`review-differences-${width}.png`), fullPage: true });
  });
}

test('partial performance update does not invent archive clears or contract removals', async ({ page }) => {
  const item = structuredClone(review) as any;
  item.proposedValue = { performance: { managerId: null } };
  await setup(page, item);
  const detail = page.getByRole('dialog', { name: '员工变更明细', exact: true });
  await expect(detail.locator('[data-change-key="performance.managerId"]')).toContainText('清空');
  await expect(detail.locator('.employee-review-contract')).toHaveCount(0);
  await expect(detail.locator('[data-change-key^="employee."]')).toHaveCount(0);
  await expect(detail.locator('[data-change-key^="profile."]')).toHaveCount(0);
});

test('new hire displays complete profile and keeps empty configured flags out of changes', async ({ page }) => {
  const item = structuredClone(review) as any;
  item.intakeType = 'new_hire'; item.sourceType = 'manual_employee_create'; item.baseValue = {};
  item.proposedValue = { employee: { employeeNo: null, name: '合成新员工', changeType: 'hire', employeeStatus: 'probation' },
    profile: { phone: 'synthetic-private-phone', gender: '女', birthDate: '2000-01-01', ethnicity: '合成民族', education: '合成学历', professionalTitle: '合成职称',
      school: '合成院校', graduationDate: '2023-06-01', major: '合成专业', maritalStatus: '合成婚姻状况', childrenStatus: '合成子女状况', childrenCount: 0,
      politicalStatus: '合成政治面貌', nativePlace: '合成籍贯', householdType: '合成户籍', idAddress: '合成证件地址', currentAddress: '合成现住址',
      emergencyContactName: '合成联系人', emergencyContactRelation: '合成关系', emergencyContactPhone: 'synthetic-emergency-phone',
      socialSecurityStatus: '合成参保状态', socialSecurityStartDate: '2026-10-01', housingFundStatus: '合成公积金状态', housingFundStartDate: '2026-10-01',
      bankName: '合成开户行', bankBranch: '合成支行', idNumberConfigured: false, bankAccountConfigured: false },
    performance: {}, contracts: [] };
  await setup(page, item);
  const detail = page.getByRole('dialog', { name: '员工变更明细', exact: true });
  for (const key of Object.keys(item.proposedValue.profile).filter(key => !key.endsWith('Configured'))) {
    await expect(detail.locator(`[data-change-key="profile.${key}"]`)).toContainText('新增');
  }
  await expect(detail.locator('[data-change-key="profile.idNumberConfigured"]')).toHaveCount(0);
  await expect(detail.locator('[data-change-key="profile.bankAccountConfigured"]')).toHaveCount(0);
  await expect(detail.locator('[data-change-key="employee.changeType"]')).toContainText('入职');
  await expect(detail).not.toContainText(/synthetic-private-phone|synthetic-emergency-phone/);
});

test('roster import matches historical contracts by type and sequence when proposed ID is absent', async ({ page }) => {
  const item = structuredClone(review) as any;
  item.sourceType = 'employee_roster_import';
  item.baseValue = { contracts: [{ id: 'historical-contract', contractType: 'contract', sequence: 0, name: '合成导入合同', termType: '一年', images: [{ name: '保留图片.jpg', url: '/private-image' }] }] };
  item.proposedValue = { contracts: [{ kind: 'contract', sequence: 0, name: '合成导入合同', termText: '三年' }] };
  await setup(page, item);
  const detail = page.getByRole('dialog', { name: '员工变更明细', exact: true });
  await expect(detail.locator('.employee-review-contract')).toHaveCount(1);
  await expect(detail.locator('.employee-review-contract h3')).toContainText('修改');
  await expect(detail.locator('[data-change-key="termType"]')).toContainText('一年');
  await expect(detail.locator('[data-change-key="termType"]')).toContainText('三年');
  await expect(detail.locator('[data-change-key="images"]')).toHaveCount(0);
});

test('contract review shows an explicitly cleared effective date instead of the signing date', async ({ page }) => {
  const item = structuredClone(review) as any;
  item.baseValue = { contracts: [{ id: 'dated-contract', contractType: 'contract', sequence: 0, name: '合成日期合同', signedAt: '2024-01-01', effectiveFrom: '2024-02-01' }] };
  item.proposedValue = { contracts: [{ ...item.baseValue.contracts[0], effectiveFrom: null }] };
  await setup(page, item);
  const row = page.getByRole('dialog', { name: '员工变更明细', exact: true }).locator('[data-change-key="effectiveFrom"]');
  await expect(row).toContainText('2024-02-01');
  await expect(row).toContainText('未填写');
  await expect(row).toContainText('清空');
});

test('name-only roster and performance manager proposals show their business relationship changes', async ({ page }) => {
  const item = structuredClone(review) as any;
  item.sourceType = 'employee_roster_import';
  item.baseValue = { employee: { managerName: '原合成主管' }, performance: { managerId: null } };
  item.proposedValue = { employee: { managerName: '新合成主管' }, performance: { managerName: '新合成主管' } };
  const state = await setup(page, item);
  const detail = page.getByRole('dialog', { name: '员工变更明细', exact: true });
  const roster = detail.locator('[data-change-key="employee.managerId"]');
  await expect(roster).toContainText('花名册直属上级');
  await expect(roster).toContainText('原合成主管');
  await expect(roster).toContainText('新合成主管');
  await expect(roster).toContainText('修改');
  const performance = detail.locator('[data-change-key="performance.managerId"]');
  await expect(performance).toContainText('绩效直属上级');
  await expect(performance).toContainText('未填写');
  await expect(performance).toContainText('新合成主管');
  await expect(performance).toContainText('新增');
  expect(state.writes).toEqual([]);
});

test('name-only manager equality and parsed manager ID metadata do not duplicate relationship rows', async ({ page }) => {
  const item = structuredClone(review) as any;
  item.sourceType = 'employee_roster_import';
  item.baseValue = { employee: { managerName: '相同合成主管' }, performance: { managerId: 'old-manager', managerName: '原合成上级名称' } };
  item.proposedValue = { employee: { managerName: '相同合成主管' }, performance: { managerId: 'old-manager', managerName: '更新的显示名称' } };
  await setup(page, item);
  const detail = page.getByRole('dialog', { name: '员工变更明细', exact: true });
  await expect(detail.locator('[data-change-key$=".managerId"]')).toHaveCount(0);
  await expect(detail.locator('[data-change-key$=".managerName"]')).toHaveCount(0);
});

test('name-only manager clearing uses the original manager name as the before value', async ({ page }) => {
  const item = structuredClone(review) as any;
  item.sourceType = 'employee_roster_import';
  item.baseValue = { employee: { managerName: '原合成主管' }, performance: { managerName: '原绩效主管' } };
  item.proposedValue = { employee: { managerName: null }, performance: { managerName: null } };
  await setup(page, item);
  const detail = page.getByRole('dialog', { name: '员工变更明细', exact: true });
  const roster = detail.locator('[data-change-key="employee.managerId"]');
  await expect(roster).toContainText('原合成主管');
  await expect(roster).toContainText('清空');
  const performance = detail.locator('[data-change-key="performance.managerId"]');
  await expect(performance).toContainText('原绩效主管');
  await expect(performance).toContainText('清空');
});
