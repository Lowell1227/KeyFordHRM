import { expect, test, type Page, type TestInfo } from '@playwright/test';

// Browser/component evidence only. Every API request is intercepted; no fixture DB or login is used.
const directory = [
  { id: 'old-position', code: 'OLD', name: '虚构旧岗位', jobFamily: '历史职系', isActive: false },
  { id: 'active-position', code: 'ACTIVE', name: '虚构有效岗位', jobFamily: '技术职系', isActive: true },
  { id: 'empty-family', code: 'EMPTY', name: '虚构无职系岗位', jobFamily: null, isActive: true },
  { id: 'other-inactive', code: 'OTHER', name: '虚构其他停用岗位', jobFamily: null, isActive: false },
];
function fixtureArchive(positionId: string | null = 'old-position') {
  const employment = { company: 'fuede', contractSubjectId: 'fixture-company', companyText: '虚构公司',
    deptId: 'fixture-dept', positionId, position: '虚构历史岗位名称', jobFamily: '历史自由职系',
    effectiveFrom: '2020-01-01', employeeStatus: 'active', employmentType: 'full_time' };
  return { id: 'fixture-person', name: '虚构表单员工', employeeNo: 'FORM_FIXTURE', status: 'active',
    positionId, position: employment.position, deptId: 'fixture-dept', dept: { id: 'fixture-dept', name: '虚构部门' },
    currentEmployment: employment, employmentHistory: [employment], employeeContracts: [], employeeProfile: null };
}
function resignationReview(appliedAt: string | null = null) {
  return { id: 'fixture-request', sourceType: 'manual_employment_change', recordStatus: 'submitted',
    profileReviewStatus: 'approved', performanceReviewStatus: 'not_required', appliedAt,
    createdAt: '2020-01-01T00:00:00Z', proposedValue: { employee: {
      changeType: 'resignation', leaveDate: '2020-01-01', effectiveFrom: '2020-01-01', reason: '虚构离职原因',
    } } };
}
async function open(page: Page, kind: string, overrides: Record<string, unknown> = {}, fieldErrors?: Record<string, string>) {
  const archive = { ...fixtureArchive(), ...overrides };
  const requests: { path: string; params: URLSearchParams; method: string; body: any }[] = [];
  let failedFields = false;
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== 'http://localhost:5173') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push({ path: url.pathname, params: url.searchParams, method: request.method(), body: request.postDataJSON() });
    if (fieldErrors && !failedFields && request.method() === 'PATCH') {
      failedFields = true;
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({
        code: 400, message: '请核对填写内容', data: { fieldErrors },
      }) });
    }
    let data: unknown = [];
    if (url.pathname === '/api/v1/positions') data = directory.filter(row => row.isActive || url.searchParams.get('includeInactive') === 'true');
    else if (url.pathname === '/api/v1/personnel-reference-data/education') data = [
      { id: 'education-first', kind: 'education', name: '虚构第一学历', isActive: true },
      { id: 'education-second', kind: 'education', name: '虚构第二学历', isActive: true },
    ];
    else if (url.pathname === '/api/v1/users') data = { total: 1, items: [{ id: 'active-manager', name: '虚构有效主管', employeeNo: 'MANAGER' },
      ...(!url.searchParams.has('eligibleFor') ? [{ id: 'pending-manager', name: '虚构待入职人员', employeeNo: 'PENDING' }] : [])] };
    else if (url.pathname.endsWith('/reentry/current')) data = null;
    else if (url.pathname === '/api/v1/employee-archives/fixture-person') data = archive;
    else if (url.pathname.includes('/contract-subjects')) data = [{ id: 'fixture-company', name: '虚构公司', internalCompany: 'fuede', isActive: true }];
    else if (request.method() !== 'GET') data = { id: 'fixture-request', requestVersion: 1, profileReviewStatus: 'pending', performanceReviewStatus: 'not_required' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
  });
  await page.addInitScript(fixture => { (window as any).personnelFormFixture = fixture; }, {
    kind, archive, departments: [{ id: 'fixture-dept', name: '虚构部门', fullPath: '虚构部门' }],
  });
  await page.goto('/e2e/fixtures/personnel-form-consistency.html');
  await expect(page.locator('.el-form').first()).toBeVisible();
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  return requests;
}
function field(page: Page, label: string) {
  return page.locator('.el-form-item').filter({ has: page.locator('.el-form-item__label', { hasText: new RegExp(`^${label}$`) }) });
}
async function select(page: Page, label: string, option: string) {
  await field(page, label).locator('.el-select').click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' });
}

test('F03 archive performance selector sends eligibility and excludes pending employees', async ({ page }) => {
  const requests = await open(page, 'archive');
  await field(page, '绩效直属上级').locator('.el-select').click();
  await expect(page.getByRole('option', { name: /虚构有效主管/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /虚构待入职人员/ })).toHaveCount(0);
  expect(requests.some(item => item.params.get('eligibleFor') === 'direct_manager')).toBe(true);
});

test('F04 reentry explains inactive historical position, blocks submit and only accepts active replacement', async ({ page }, info) => {
  const requests = await open(page, 'reentry');
  await expect(field(page, '岗位')).toContainText('虚构历史岗位名称');
  await expect(field(page, '岗位')).toContainText('重新选择启用岗位或清空');
  await field(page, '岗位').locator('.el-select').click();
  await expect(page.getByRole('option', { name: /虚构历史岗位名称/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('option', { name: /虚构其他停用岗位/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await field(page, '再入职日期').locator('input').fill('2026-11-14');
  await field(page, '再入职日期').locator('input').press('Tab');
  await page.getByRole('button', { name: '提交', exact: true }).click();
  expect(requests.filter(item => item.method === 'POST')).toHaveLength(0);
  await screenshot(page, info, 'inactive-position');
  await select(page, '岗位', '虚构有效岗位');
  await expect(field(page, '岗位').locator('.el-form-item__error')).toHaveCount(0);
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByTestId('submitted')).toHaveText('["fixture-request"]');
  expect(requests.find(item => item.method === 'POST')?.body.positionId).toBe('active-position');
});

for (const kind of ['archive', 'reentry', 'employment']) {
  test(`D01 ${kind} preserves same-position stored family through unrelated editing`, async ({ page }) => {
    const requests = await open(page, kind, fixtureArchive('active-position'));
    await expect(field(page, '职系').locator('input')).toHaveValue('历史自由职系');
    await expect(field(page, '职系').locator('input')).toHaveAttribute('readonly', '');
    await page.waitForTimeout(800); // Opening and loading the directory must not trigger the 700ms draft autosave.
    expect(requests.filter(item => item.method !== 'GET')).toHaveLength(0);
    await select(page, '用工类型', '兼职');
    if (kind !== 'archive') {
      const date = field(page, kind === 'reentry' ? '再入职日期' : '生效日期').locator('input');
      await date.fill('2026-11-14');
      await date.press('Tab');
      await page.getByRole('button', { name: kind === 'reentry' ? '提交' : '提交审核', exact: true }).click();
    }
    await expect.poll(() => requests.filter(item => item.method !== 'GET').length).toBeGreaterThan(0);
    const payload = requests.find(item => item.method !== 'GET')!.body;
    expect((kind === 'archive' ? payload.employee : payload).jobFamily).toBe('历史自由职系');
  });
  test(`D01 ${kind} directory family is readonly, switches/clears correctly and retains free text`, async ({ page }, info) => {
    await open(page, kind, fixtureArchive(null));
    await expect(field(page, '岗位名称').locator('input')).toHaveValue('虚构历史岗位名称');
    await expect(field(page, '职系')).toContainText('历史自由职系');
    await select(page, '岗位', kind === 'reentry' ? '虚构有效岗位' : '虚构有效岗位（技术职系）');
    await expect(field(page, '职系').locator('input')).toHaveValue('技术职系');
    await expect(field(page, '职系').locator('input')).toHaveAttribute('readonly', '');
    await expect(field(page, '岗位名称')).toHaveCount(0);
    await field(page, '职系').scrollIntoViewIfNeeded();
    await screenshot(page, info, `${kind}-directory-family`);
    await select(page, '岗位', '虚构无职系岗位');
    await expect(field(page, '职系').locator('input')).toHaveValue('');
    const position = field(page, '岗位');
    await position.locator('.el-select').hover();
    await position.locator('.el-select__clear').click({ force: true });
    await expect(field(page, '岗位名称').locator('input')).toHaveValue('');
    await expect(field(page, '职系')).not.toContainText('历史自由职系');
  });
}

test('F01 ordinary options exclude lifecycle bypass while closed historical ranges retain original options', async ({ page }, info) => {
  await open(page, 'employment');
  await field(page, '员工状态').locator('.el-select').click();
  await expect(page.getByRole('option', { name: '已离职', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await field(page, '变更类型').locator('.el-select').click();
  await expect(page.getByRole('option', { name: '离职', exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: '返聘', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  for (const [label, value] of [['生效日期', '2020-01-01'], ['结束日期', '2020-02-01']]) {
    await field(page, label).locator('input').fill(value);
    await field(page, label).locator('input').press('Tab');
  }
  await select(page, '员工状态', '已离职');
  await select(page, '变更类型', '历史补录');
  await field(page, '员工状态').scrollIntoViewIfNeeded();
  await screenshot(page, info, 'historical-employment');
});

test('F10 past scheduled resignation remains waiting until appliedAt is returned', async ({ page }, info) => {
  await open(page, 'resignation', { latestResignationReview: resignationReview() });
  await expect(page.locator('.approval-flow .el-tag')).toHaveText('已通过，待生效');
  await expect(page.locator('.el-step').last().locator('.el-step__head')).not.toHaveClass(/is-success/);
  await page.locator('.approval-flow').scrollIntoViewIfNeeded();
  await screenshot(page, info, 'resignation-waiting');
  await page.evaluate(review => (window as any).setResignationReview(review), resignationReview('2020-01-02T00:15:00Z'));
  await expect(page.locator('.approval-flow .el-tag')).toHaveText('已生效');
  await expect(page.locator('.el-step').last().locator('.el-step__head')).toHaveClass(/is-success/);
});

test('resignation submission closes the drawer before the parent opens application details', async ({ page }) => {
  await open(page, 'resignation');
  await field(page, '离职原因').locator('textarea').fill('虚构交接测试');
  await page.getByRole('button', { name: '提交审核', exact: true }).click();
  await expect(page.getByTestId('submitted')).toHaveText('["fixture-request"]');
  await expect(page.getByRole('dialog', { name: '办理离职', exact: true })).toHaveCount(0);
});

test('narrow mobile field errors do not overlap the following field', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await open(page, 'reentry');
  const error = field(page, '岗位').locator('.el-form-item__error');
  await expect(error).toBeVisible();
  const errorBox = (await error.boundingBox())!;
  const nextLabel = (await field(page, '职系').locator('.el-form-item__label').boundingBox())!;
  expect(errorBox.y + errorBox.height).toBeLessThanOrEqual(nextLabel.y);
  await field(page, '职系').scrollIntoViewIfNeeded();
  await screenshot(page, info, 'narrow-position-error');
});

test('F05 API field errors stay beside their fields, focus first and clear independently', async ({ page }, info) => {
  await open(page, 'archive', {}, { 'profile.education': '请选择启用的学历', 'profile.school': '请核对学校名称', 'employee.contractSubjectId': '请核对所属公司' });
  const education = field(page, '学历'), school = field(page, '毕业院校');
  await select(page, '学历', '虚构第一学历');
  await expect(education.locator('.el-form-item__error')).toHaveText('请选择启用的学历');
  await expect(education.locator('input')).toBeFocused();
  await expect(education.locator('.el-select')).toContainText('虚构第一学历');
  await expect(school.locator('.el-form-item__error')).toHaveText('请核对学校名称');
  await expect(field(page, '所属公司').locator('.el-form-item__error')).toHaveText('请核对所属公司');
  await select(page, '学历', '虚构第二学历');
  await expect(education.locator('.el-form-item__error')).toHaveCount(0);
  await expect(school.locator('.el-form-item__error')).toHaveText('请核对学校名称');
  await school.scrollIntoViewIfNeeded();
  await screenshot(page, info, 'server-field-errors');
  await school.locator('input').fill('虚构大学');
  await expect(school.locator('.el-form-item__error')).toHaveCount(0);
  await expect(field(page, '所属公司').locator('.el-form-item__error')).toHaveText('请核对所属公司');
});
