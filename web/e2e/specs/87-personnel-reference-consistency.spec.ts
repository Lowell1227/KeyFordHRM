import { expect, test, type Page } from '@playwright/test';
import { employeeReviewDifferences } from '../../src/views/admin/components/employee-review-differences';

const response = (data: unknown) => ({ code: 0, data, message: 'success' });
const references = [
  ['employee', 'jobGrade', 'job_grade', '职级'], ['employee', 'jobFamily', 'job_family', '职系'],
  ['employee', 'workLocation', 'work_location', '工作地点'], ['profile', 'education', 'education', '学历'],
  ['profile', 'maritalStatus', 'marital_status', '婚姻状况'], ['profile', 'politicalStatus', 'political_status', '政治面貌'],
  ['profile', 'householdType', 'household_type', '户籍类型'], ['profile', 'emergencyContactRelation', 'contact_relation', '与联系人关系'],
] as const;

async function setup(page: Page, kind = 'archive', oldDraft = false, positionScenario = 'active') {
  const employment: Record<string, unknown> = { id: 'employment', company: null, companyText: '虚构公司', contractSubjectId: 'company',
    deptId: 'dept', positionId: 'position', position: '虚构岗位', effectiveFrom: '2025-01-01', entryDate: '2025-01-01',
    employeeStatus: 'active', employmentType: 'full_time' };
  const profile: Record<string, unknown> = {};
  for (const [section, field, , label] of references) {
    Object.assign(section === 'employee' ? employment : profile, { [field]: `历史${label}`, [`${field}Id`]: `${field}-id` });
  }
  const archive = { id: 'person', archiveVersion: 'v1', name: '虚构字段员工', employeeNo: 'REF_FIXTURE', status: 'active', deptId: 'dept',
    dept: { id: 'dept', name: '虚构部门', company: 'fuede' }, currentEmployment: employment, employmentHistory: [employment],
    employeeProfile: profile, employeeContracts: [], entryDate: '2025-01-01', positionId: 'position', position: '虚构岗位' };
  const reentry = positionScenario === 'inactive-draft' ? { id: 'reentry-request', intakeType: 'reentry', onboardingStatus: 'draft', recordStatus: 'draft',
    profileReviewStatus: 'pending', performanceReviewStatus: 'not_required', proposedValue: { employee: { ...employment,
      positionId: 'draft-position', position: '未生效的草稿岗位', effectiveDate: '2026-11-15' } } } : null;
  const draft = oldDraft ? { id: 'draft', userId: 'person', requestVersion: 1, recordStatus: 'draft', profileReviewStatus: 'pending',
    proposedValue: { employee: {}, profile: { education: '旧草稿另一学历' }, contracts: [] } } : kind === 'create'
    ? { id: 'draft', requestVersion: 1, recordStatus: 'draft', sourceType: 'manual_employee_create', profileReviewStatus: 'pending',
      proposedValue: { employee: { ...employment, name: '虚构新员工', positionId: null, position: '旧草稿手填岗位' }, profile,
        contracts: [], draftMeta: { currentStep: 1, completedSteps: [0], layoutVersion: 2 } } } : undefined;
  await page.addInitScript(fixture => {
    (window as any).companyDirectoryFixture = fixture;
    localStorage.setItem('token', 'fixture-only'); localStorage.setItem('expiresAt', String(Date.now() + 600000));
  }, { kind, capability: kind === 'positions' ? 'organization_edit' : 'employee_archive_edit', archive, draft,
    departments: [{ id: 'dept', name: '虚构部门', fullPath: '虚构部门', company: 'fuede', children: [] }] });
  const requests: { method: string; path: string; body: any }[] = [];
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), body = request.postDataJSON();
    requests.push({ path: url.pathname, method: request.method(), body });
    let data: unknown = [];
    if (url.pathname.includes('personnel-reference-data')) {
      const kind = url.pathname.split('/').at(-1);
      const item = references.find(row => row[2] === kind)!;
      data = item ? [{ id: `${item[1]}-id`, kind, name: `已改名${item[3]}`, isActive: true },
        { id: `${item[1]}-new`, kind, name: `新选${item[3]}`, isActive: true }] : [];
    } else if (url.pathname.includes('/contract-subjects')) data = [{ id: 'company', name: '虚构公司', isActive: true }];
    else if (url.pathname.endsWith('/positions')) data = [{ id: 'position', code: 'FIXTURE', name: '已改名岗位', isActive: positionScenario === 'active',
      jobFamily: '目录职系', jobFamilyId: 'jobFamily-id', activeEmployeeCount: 0 },
      { id: 'draft-position', code: 'DRAFT', name: '未生效的草稿岗位', isActive: false, jobFamily: '目录职系', jobFamilyId: 'jobFamily-id' },
      { id: 'new-position', code: 'NEW', name: '新选启用岗位', isActive: true, jobFamily: '新选职系', jobFamilyId: 'jobFamily-new' }];
    else if (url.pathname.endsWith('/reentry/current')) data = reentry;
    else if (url.pathname === '/api/v1/employee-archives/person') data = archive;
    else if (url.pathname.endsWith('/auth/me')) data = { id: 'hr', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] };
    else if (url.pathname.includes('identity')) data = { outcome: 'new_person', candidates: [], warnings: [], conflicts: [] };
    else if (url.pathname.endsWith('/users')) data = { items: [], total: 0 };
    else if (request.method() !== 'GET') data = { id: 'draft', requestVersion: 2, profileReviewStatus: 'pending' };
    await route.fulfill({ json: response(data) });
  });
  await page.goto('/e2e/fixtures/company-directory.html');
  if (kind === 'positions') await expect(page.getByRole('button', { name: '新增岗位', exact: true })).toBeVisible();
  else await expect(page.locator('.el-form').first()).toBeVisible();
  return requests;
}

for (const width of [1440, 390]) test(`archive retains IDs and name snapshots and changes the selected pair at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await setup(page);
  await expect(page.locator('[data-archive-field="employee.positionId"]')).toContainText('虚构岗位');
  await expect(page.locator('[data-archive-field="employee.positionId"]')).not.toContainText('已改名岗位');
  await page.locator('[data-archive-field="employee.name"] input').fill('虚构字段更名');
  const location = page.locator('[data-archive-field="employee.workLocation"]');
  await location.getByRole('combobox').click();
  await page.getByRole('option', { name: '新选工作地点', exact: true }).click();
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByTestId('submitted')).not.toHaveText('[]');
  const payload = JSON.parse(await page.getByTestId('submitted').innerText())[0];
  expect(payload.employee.workLocationId).toBe('workLocation-new');
  expect(payload.employee.workLocation).toBe('新选工作地点');
  for (const [section, field, , label] of references.filter(row => row[1] !== 'workLocation')) {
    expect(payload[section][`${field}Id`]).toBe(`${field}-id`);
    expect(payload[section][field]).toBe(`历史${label}`);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.locator('.el-select-dropdown:visible')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('archive-stable-reference.png'), fullPage: true, animations: 'disabled' });
});

test('old draft with changed text cannot borrow the formal reference ID', async ({ page }) => {
  await setup(page, 'archive', true);
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByTestId('submitted')).not.toHaveText('[]');
  const payload = JSON.parse(await page.getByTestId('submitted').innerText())[0];
  expect(payload.profile.education).toBe('旧草稿另一学历');
  expect(payload.profile.educationId).toBeNull();
});

test('new hire cannot proceed on free-text position and draft fields keep their IDs', async ({ page }) => {
  const requests = await setup(page, 'create');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.locator('[data-archive-field="employee.positionId"] .el-form-item__error')).toBeVisible();
  await expect(page.locator('[data-archive-field="employee.position"] input')).toHaveAttribute('readonly', '');
  await page.locator('[data-archive-field="employee.positionId"]').getByRole('combobox').click();
  await page.getByRole('option', { name: /已改名岗位/ }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.getByRole('button', { name: '个人与教育', exact: true })).toBeVisible();
  await expect.poll(() => requests.filter(item => item.method === 'POST' && item.path.endsWith('/drafts')).at(-1)?.body?.employee?.jobFamilyId).toBe('jobFamily-id');
  const payload = requests.filter(item => item.method === 'POST' && item.path.endsWith('/drafts')).at(-1)!.body;
  expect(payload.profile.educationId).toBe('education-id');
  expect(payload.employee.positionId).toBe('position');
});

test('reference association-only changes appear once in history without exposing IDs', () => {
  const groups = employeeReviewDifferences({ sourceType: 'manual_archive_change', baseValue: {
    profile: { education: '本科', educationId: null } }, proposedValue: { profile: { education: '本科', educationId: 'education-id' } } });
  expect(groups.flatMap(group => group.fields)).toEqual([{ key: 'profile.education', label: '学历', kind: '修改',
    before: '本科（历史名称，未关联）', after: '本科（已关联目录）' }]);
});


test('reentry preserves an unchanged inactive formal position and its family snapshot', async ({ page }) => {
  const requests = await setup(page, 'reentry', false, 'inactive-historical');
  const company = page.locator('.el-form-item').filter({ has: page.locator('.el-form-item__label', { hasText: /^所属公司$/ }) });
  await company.getByRole('combobox').click();
  await page.getByRole('option', { name: '虚构公司', exact: true }).click();
  const date = page.locator('.el-form-item').filter({ has: page.locator('.el-form-item__label', { hasText: /^再入职日期$/ }) }).locator('input');
  await date.fill('2026-11-16'); await date.press('Tab');
  await expect(page.getByText('请选择岗位目录中启用的岗位；未修改的历史岗位可保留。', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByTestId('submitted')).not.toHaveText('[]');
  const payload = requests.find(row => row.method === 'POST' && row.path.endsWith('/reentry'))!.body;
  expect(payload.positionId).toBe('position');
  expect(payload.jobFamilyId).toBe('jobFamily-id');
  expect(payload.jobFamily).toBe('历史职系');
});

test('reentry draft cannot treat its own inactive position as formal history', async ({ page }) => {
  const requests = await setup(page, 'reentry', false, 'inactive-draft');
  const date = page.locator('.el-form-item').filter({ has: page.locator('.el-form-item__label', { hasText: /^再入职日期$/ }) }).locator('input');
  await date.fill('2026-11-16'); await date.press('Tab');
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByText('请选择岗位目录中启用的岗位；未修改的历史岗位可保留。', { exact: true })).toBeVisible();
  expect(requests.filter(row => row.method !== 'GET')).toHaveLength(0);
  const position = page.locator('.el-form-item').filter({ has: page.locator('.el-form-item__label', { hasText: /^岗位$/ }) });
  await position.getByRole('combobox').click();
  await page.getByRole('option', { name: '新选启用岗位', exact: true }).click();
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByTestId('submitted')).not.toHaveText('[]');
  const payload = requests.find(row => row.method !== 'GET')!.body;
  expect(payload.positionId).toBe('new-position');
  expect(payload.jobFamilyId).toBe('jobFamily-new');
});


test('position maintenance sends family ID and retains the form with a nearby validation error', async ({ page }) => {
  await setup(page, 'positions');
  await page.getByRole('button', { name: '新增岗位', exact: true }).click();
  const drawer = page.getByRole('dialog');
  const nameField = drawer.locator('.el-form-item').filter({ has: page.locator('.el-form-item__label', { hasText: /^岗位名称$/ }) });
  const familyField = drawer.locator('.el-form-item').filter({ has: page.locator('.el-form-item__label', { hasText: /^职系$/ }) });
  await nameField.locator('input').fill('虚构新增岗位');
  await familyField.getByRole('combobox').click();
  await page.getByRole('option', { name: '新选职系', exact: true }).click();
  const writes: any[] = [];
  await page.route('**/api/v1/positions', async route => {
    if (route.request().method() === 'GET') return route.fallback();
    writes.push(route.request().postDataJSON());
    if (writes.length === 1) return route.fulfill({ status: 400, json: { code: 40000, message: '职系已停用，请重新选择', data: { fieldErrors: { jobFamily: '职系已停用，请重新选择' } } } });
    return route.fulfill({ json: response({ id: 'request', status: 'approved' }) });
  });
  await drawer.getByRole('button', { name: '提交审核', exact: true }).click();
  await expect(familyField.locator('.el-form-item__error')).toHaveText('职系已停用，请重新选择');
  await expect(nameField.locator('input')).toHaveValue('虚构新增岗位');
  expect(writes[0]).toEqual({ name: '虚构新增岗位', jobFamily: '新选职系', jobFamilyId: 'jobFamily-new' });
  await familyField.getByRole('combobox').click();
  await page.getByRole('option', { name: '已改名职系', exact: true }).click();
  await expect(familyField.locator('.el-form-item__error')).toHaveCount(0);
  await drawer.getByRole('button', { name: '提交审核', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  expect(writes[1].jobFamilyId).toBe('jobFamily-id');
});
