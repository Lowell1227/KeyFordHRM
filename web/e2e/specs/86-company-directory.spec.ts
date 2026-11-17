import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { employeeReviewDifferences } from '../../src/views/admin/components/employee-review-differences';

// UI and request-contract evidence only; all API traffic is intercepted, no real data is used.
const baseURL = 'http://127.0.0.1:18779';
const response = (data: unknown) => ({ code: 0, data, message: 'success' });
const companies = [
  { id: 'company-new', name: '虚构新公司（无旧映射）', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'company-contract', name: '虚构合同签约公司', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'company-inactive', name: '已改名的停用公司', isActive: false, createdAt: '', updatedAt: '' },
];
function archive(company: Record<string, unknown> = {}) {
  const employment = { id: 'employment-fixture', company: null, companyText: null, contractSubjectId: null,
    deptId: 'fixture-dept', positionId: null, position: null, effectiveFrom: '2020-01-01',
    employeeStatus: 'active', employmentType: 'full_time', ...company };
  return { id: 'fixture-person', archiveVersion: 'fixture-version', name: '虚构公司员工', employeeNo: 'COMPANY_FIXTURE',
    status: 'active', positionId: null, position: null, deptId: 'fixture-dept', entryDate: '2020-01-01',
    dept: { id: 'fixture-dept', name: '虚构部门', company: 'fuede' }, currentEmployment: employment,
    employmentHistory: [employment], employeeContracts: [{ id: 'fixture-contract', name: '历史合同',
      signingCompany: '独立合同快照', contractSubjectId: 'company-contract', contractType: 'contract', sequence: 0 }],
    employeeProfile: null };
}
function newHireDraft() {
  return { id: 'fixture-draft', requestVersion: 1, sourceType: 'manual_employee_create', recordStatus: 'draft',
    profileReviewStatus: 'pending', performanceReviewStatus: 'not_required', proposedValue: {
      employee: { name: '虚构新入职员工', company: null, companyText: null, contractSubjectId: null,
        deptId: 'fixture-dept', positionId: 'fixture-position', position: '虚构岗位', entryDate: '2026-11-16', effectiveFrom: '2026-11-16',
        employmentType: 'full_time', employeeStatus: 'probation' }, profile: {}, performance: {},
      contracts: [{ name: '虚构劳动合同', contractType: 'contract', contractSubjectId: 'company-contract', signingCompany: '虚构合同签约公司' }],
      draftMeta: { currentStep: 1, completedSteps: [0], layoutVersion: 2 },
    } };
}
async function setup(page: Page, kind: string, company: Record<string, unknown> = {}, capability = 'employee_archive_edit') {
  const record = archive(company);
  const requests: { path: string; method: string; body: any }[] = [];
  await page.addInitScript(fixture => {
    (window as any).companyDirectoryFixture = fixture;
    localStorage.setItem('token', 'fixture-only');
    localStorage.setItem('expiresAt', String(Date.now() + 600000));
  }, { kind, capability, archive: record, draft: kind === 'create' ? newHireDraft() : undefined,
    departments: [{ id: 'fixture-dept', name: '虚构部门', fullPath: '虚构部门', company: 'fuede', children: [] }] });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== baseURL) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const method = request.method();
    const body = request.postDataJSON();
    requests.push({ path: url.pathname, method, body });
    let data: unknown = [];
    if (url.pathname.endsWith('/auth/me')) data = { id: 'fixture-editor', name: '虚构HR', sysRole: 'hr_user', hrCapabilities: [capability] };
    else if (url.pathname.includes('/contract-subjects')) data = method === 'GET' ? companies : { ...companies[0], ...body };
    else if (url.pathname.endsWith('/notifications/unread-count')) data = 0;
    else if (url.pathname.endsWith('/positions')) data = [{ id: 'fixture-position', name: '虚构岗位', isActive: true, jobFamily: null, jobFamilyId: null }];
    else if (url.pathname.endsWith('/reentry/current')) data = null;
    else if (url.pathname === '/api/v1/employee-archives/fixture-person') data = record;
    else if (url.pathname.endsWith('/users')) data = { items: [], total: 0 };
    else if (url.pathname.includes('identity')) data = { outcome: 'new_person', candidates: [], conflicts: [], warnings: [] };
    else if (method !== 'GET') data = { id: 'fixture-request', requestVersion: 2, profileReviewStatus: 'pending', performanceReviewStatus: 'not_required' };
    await route.fulfill({ json: response(data) });
  });
  await page.goto('/e2e/fixtures/company-directory.html');
  await expect(page.locator('.el-form').first()).toBeVisible();
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  return requests;
}
function field(page: Page, label: string) {
  return page.locator('.el-form-item').filter({ has: page.locator('.el-form-item__label', { hasText: new RegExp(`^${label}$`) }) });
}
async function chooseCompany(page: Page) {
  await field(page, '所属公司').getByRole('combobox').click();
  const option = page.getByRole('option').filter({ hasText: companies[0]!.name });
  await expect(option).not.toHaveAttribute('aria-disabled', 'true');
  await option.click();
  await expect(field(page, '所属公司')).toContainText(companies[0]!.name);
}
async function chooseInternship(page: Page) {
  await field(page, '用工类型').locator('.el-select').click();
  const options = page.getByRole('option').filter({ visible: true });
  await expect(options).toHaveText(['全职', '兼职', '实习', '返聘', '外部']);
  await page.getByRole('option', { name: '实习', exact: true }).click();
  await expect(field(page, '用工类型')).toContainText('实习');
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' });
}

for (const width of [1440, 390]) {
  test(`directory saves a company name without requiring a mapping at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const requests = await setup(page, 'directory');
    await page.getByRole('button', { name: /新增(主体|公司)/, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('combobox')).toHaveCount(0);
    await dialog.getByRole('textbox').fill('虚构新增公司');
    await screenshot(page, info, 'company-name-only');
    await dialog.getByRole('button', { name: /保存(主体|公司)/, exact: true }).click();
    await expect.poll(() => requests.find(row => row.method === 'POST')?.body).toEqual({ name: '虚构新增公司' });
  });

  test(`new hire submits unmapped company separately from contract at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const requests = await setup(page, 'create');
    await chooseCompany(page);
    await chooseInternship(page);
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.getByRole('button', { name: '合同与附件', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await screenshot(page, info, 'new-hire-review');
    await page.getByRole('button', { name: '提交', exact: true }).click();
    await expect(page.getByTestId('submitted')).toHaveText('["fixture-request"]');
    const body = requests.find(row => row.method === 'POST' && row.path === '/api/v1/employee-archives')!.body;
    expect(body.employee.contractSubjectId).toBe('company-new');
    expect(body.company ?? null).toBeNull();
    expect(body.employmentType).toBe('internship');
    expect(body.contracts[0].contractSubjectId).toBe('company-contract');
  });

  for (const kind of ['reentry', 'employment', 'archive']) {
    test(`${kind} accepts an unmapped company at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      const requests = await setup(page, kind);
      await chooseCompany(page);
      await chooseInternship(page);
      if (kind !== 'archive') {
        const date = field(page, kind === 'reentry' ? '再入职日期' : '生效日期').locator('input');
        await date.fill('2026-11-16'); await date.press('Tab');
      }
      await screenshot(page, info, kind);
      await page.getByRole('button', { name: kind === 'employment' ? '提交审核' : '提交', exact: true }).click();
      await expect(page.getByTestId('submitted')).not.toHaveText('[]');
      const body = kind === 'archive' ? JSON.parse(await page.getByTestId('submitted').innerText())[0].employee
        : requests.find(row => row.method === 'POST')!.body;
      expect(body.contractSubjectId).toBe('company-new');
      expect(body.company ?? null).toBeNull();
      expect(body.employmentType).toBe('internship');
    });
  }
}

for (const company of [
  { company: null, companyText: '历史未知公司', contractSubjectId: null },
  { company: 'fuede', companyText: null, contractSubjectId: null },
  { company: null, companyText: '已冻结的历史公司名', contractSubjectId: 'company-inactive' },
  { company: null, companyText: null, contractSubjectId: null },
]) test(`unrelated archive edit preserves ${JSON.stringify(company)}`, async ({ page }) => {
  await setup(page, 'archive', company);
  await page.waitForTimeout(800); // Autosave threshold: loading company choices must not create a draft.
  await field(page, '姓名').locator('input').fill('虚构员工更名');
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByTestId('submitted')).not.toHaveText('[]');
  const payload = JSON.parse(await page.getByTestId('submitted').innerText())[0];
  expect(payload.employee.company ?? null).toBe(company.company);
  expect(payload.employee.companyText ?? null).toBe(company.companyText);
  expect(payload.employee.contractSubjectId ?? null).toBe(company.contractSubjectId);
  expect(payload.contracts[0].signingCompany).toBe('独立合同快照');
});

test('review-only HR can read companies but cannot maintain the directory', async ({ page }) => {
  await setup(page, 'directory', {}, 'employee_archive_review');
  await expect(page.getByText(companies[0]!.name, { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /新增(主体|公司)/, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /编辑(主体|公司)/, exact: true })).toHaveCount(0);
});

function companyChanges(before: Record<string, unknown>, after: Record<string, unknown>) {
  return employeeReviewDifferences({ sourceType: 'manual_archive_change', baseValue: { employee: before },
    proposedValue: { employee: after } }).flatMap(group => group.fields);
}
test('review combines directory selection and legacy code cleanup into one company change', () => {
  expect(companyChanges({ company: 'fuede' }, { company: null, contractSubjectId: 'new-company', companyText: '虚构新公司' }))
    .toEqual([{ key: 'employee.companyText', label: '所属公司', kind: '修改', before: '孚德', after: '虚构新公司' }]);
});
test('review retains changes between distinct company IDs even when their names match', () => {
  const changes = companyChanges({ contractSubjectId: 'old', companyText: '同名公司' }, { contractSubjectId: 'new', companyText: '同名公司' });
  expect(changes).toHaveLength(1);
  expect(changes[0]?.label).toBe('所属公司');
  expect(changes[0]?.before).not.toBe(changes[0]?.after);
});
test('review ignores compatibility code cleanup when the actual company is unchanged', () => {
  expect(companyChanges({ company: 'fuede', companyText: '冻结公司名', contractSubjectId: 'same' }, { company: null })).toEqual([]);
  expect(companyChanges({ company: 'fuede' }, { company: 'fansibao' })).toEqual([
    { key: 'employee.companyText', label: '所属公司', kind: '修改', before: '孚德', after: '凡思堡' },
  ]);
});
