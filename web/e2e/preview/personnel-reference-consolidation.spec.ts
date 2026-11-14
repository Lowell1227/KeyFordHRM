import { expect, test as base, type APIResponse, type Locator, type Page, type Response, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const ExcelJS = createRequire(resolve(process.cwd(), '../api/package.json'))('exceljs');
const origin = 'http://localhost:5173';
// Independent acceptance expectations, not imported from the implementation under test.
const options = [
  { kind: 'job_grade', tab: 'job-grades', label: '职级', field: 'employee.jobGrade', header: '职级' },
  { kind: 'education', tab: 'education', label: '学历', field: 'profile.education', header: '学历' },
  { kind: 'marital_status', tab: 'marital-status', label: '婚姻状况', field: 'profile.maritalStatus', header: '婚姻状况' },
  { kind: 'political_status', tab: 'political-status', label: '政治面貌', field: 'profile.politicalStatus', header: '政治面貌' },
  { kind: 'household_type', tab: 'household-types', label: '户籍类型', field: 'profile.householdType', header: '户籍类型' },
  { kind: 'contact_relation', tab: 'contact-relations', label: '与联系人关系', field: 'profile.emergencyContactRelation', header: '紧急联系人关系' },
  { kind: 'bank_name', tab: 'banks', label: '开户银行', field: 'profile.bankName', header: '开户行' },
  { kind: 'contract_name', tab: 'contract-names', label: '合同名称', field: 'contracts.0.name', header: '合同名称' },
] as const;
type Option = typeof options[number];
type Fixture = {
  prefix: string; userIds: string[]; hrId: string; reviewerId: string; employee: { id: string; employeeNo: string; name: string };
  contractId: string; token: string; reviewerToken: string; organizationToken: string; employeeToken: string;
  onboardingSubject?: { id: string; name: string };
};

function fixtureQuery(source: string) {
  return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 30_000,
    input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();
      (async () => {
        if (!await prisma.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Uninitialized preview');
        ${source}
      })().finally(() => prisma.$disconnect()).catch(() => { console.error('Isolated reference fixture operation failed'); process.exitCode = 1; });`,
  }));
}

function createFixture(): Fixture {
  const prefix = `RC_${randomUUID().slice(0, 8)}`;
  return fixtureQuery(`
    const dept = await prisma.department.findFirstOrThrow({ where: { name: '预览业务部' } });
    const position = await prisma.position.findFirstOrThrow({ where: { code: 'PREVIEW_STAFF' } });
    const subject = await prisma.contractSubject.findFirstOrThrow({ where: { name: '预览签约主体' } });
    const result = await prisma.$transaction(async tx => {
      const users = [];
      for (const [suffix, capability] of [['HR', 'employee_archive_edit'], ['REVIEW', 'employee_archive_review'], ['ORG', 'organization_edit'], ['EMP', null]]) {
        const user = await tx.user.create({ data: { employeeNo: '${prefix}_' + suffix, name: '虚构资料${prefix}_' + suffix,
          status: 'active', sysRole: capability ? 'hr_user' : 'employee', hrCapabilities: capability ? [capability] : [],
          deptId: dept.id, positionId: position.id, position: position.name, entryDate: new Date('2025-01-01T00:00:00Z'),
          employeeProfile: { create: { childrenCount: 0 } },
          employmentHistory: { create: { effectiveFrom: new Date('2025-01-01T00:00:00Z'), entryDate: new Date('2025-01-01T00:00:00Z'),
            company: 'fuede', companyText: subject.name, contractSubjectId: subject.id, deptId: dept.id,
            positionId: position.id, position: position.name, employeeStatus: 'active', employeeNo: '${prefix}_' + suffix,
            changeType: 'onboarding', sourceType: 'preview_fixture' } } } });
        users.push(user);
      }
      const contract = await tx.employeeContract.create({ data: { userId: users[3].id, contractType: 'contract', sequence: 0,
        name: '虚构原合同${prefix}', contractSubjectId: subject.id, signingCompany: subject.name,
        effectiveFrom: new Date('2025-01-01T00:00:00Z'), expiresAt: new Date('2027-12-31T00:00:00Z') } });
      return { prefix: '${prefix}', userIds: users.map(u => u.id), hrId: users[0].id, reviewerId: users[1].id,
        organizationId: users[2].id, employee: { id: users[3].id, name: users[3].name, employeeNo: users[3].employeeNo }, contractId: contract.id };
    });
    const { JwtService } = require('@nestjs/jwt'); const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const sign = (sub, suffix) => jwt.sign({ sub, employeeNo: '${prefix}_' + suffix }, { expiresIn: '20m' });
    console.log(JSON.stringify({ ...result, token: sign(result.hrId, 'HR'), reviewerToken: sign(result.reviewerId, 'REVIEW'),
      organizationToken: sign(result.organizationId, 'ORG'), employeeToken: sign(result.employee.id, 'EMP') }));
  `) as Fixture;
}

function removeFixture(f: Fixture) {
  return fixtureQuery(`
    const onboardingSubject = ${JSON.stringify(f.onboardingSubject ?? null)};
    if (onboardingSubject) {
      const stored = await prisma.contractSubject.findUnique({ where: { id: onboardingSubject.id } });
      if (!stored || stored.name !== onboardingSubject.name || !stored.name.includes('${f.prefix}')) throw new Error('Subject ownership mismatch');
    }
    const baseIds = ${JSON.stringify(f.userIds)};
    const users = await prisma.user.findMany({ where: { id: { in: baseIds } }, select: { id: true, employeeNo: true } });
    if (users.length !== 4 || users.some(u => !u.employeeNo.startsWith('${f.prefix}_'))) throw new Error('Fixture ownership mismatch');
    const requests = await prisma.employeeDataChangeRequest.findMany({
      where: { OR: [{ userId: { in: baseIds } }, { createdById: '${f.hrId}' }] },
      select: { id: true, userId: true, employeeName: true } });
    if (requests.some(r => !r.employeeName.includes('${f.prefix}'))) throw new Error('Application ownership mismatch');
    const ids = [...new Set([...baseIds, ...requests.map(r => r.userId).filter(Boolean)])];
    const ownedUsers = await prisma.user.findMany({ where: { id: { in: ids } }, select: { name: true } });
    if (ownedUsers.some(u => !u.name.includes('${f.prefix}'))) throw new Error('Onboarding ownership mismatch');
    // Exact creator IDs recover even a committed create whose browser response was lost.
    const created = await prisma.auditLog.findMany({ where: { userId: { in: ids }, action: 'create_personnel_reference_data' }, select: { entityId: true } });
    const referenceIds = [...new Set(created.map(a => a.entityId))];
    const references = await prisma.personnelReferenceData.findMany({ where: { id: { in: referenceIds } } });
    if (references.some(r => !r.name.includes('${f.prefix}'))) throw new Error('Reference ownership mismatch');
    await prisma.$transaction(async tx => {
      await tx.notificationLog.deleteMany({ where: { userId: { in: ids } } });
      await tx.auditLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { entityId: { in: [...ids, ...referenceIds, ...requests.map(r => r.id)] } }] } });
      await tx.employeeContract.deleteMany({ where: { userId: { in: ids } } });
      await tx.employmentRecord.deleteMany({ where: { userId: { in: ids } } });
      await tx.employeeNumberAssignment.deleteMany({ where: { userId: { in: ids } } });
      await tx.employeeDataChangeRequest.deleteMany({ where: { id: { in: requests.map(r => r.id) } } });
      await tx.employeeProfile.deleteMany({ where: { userId: { in: ids } } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
      await tx.personnelReferenceData.deleteMany({ where: { id: { in: referenceIds } } });
      if (onboardingSubject) await tx.contractSubject.delete({ where: { id: onboardingSubject.id } });
    });
    console.log(JSON.stringify({ exactUserIdsRemoved: ids.length, exactReferenceIdsRemoved: referenceIds.length,
      remainingUsers: await prisma.user.count({ where: { id: { in: ids } } }),
      remainingReferences: await prisma.personnelReferenceData.count({ where: { id: { in: referenceIds } } }),
      remainingSubjects: onboardingSubject ? await prisma.contractSubject.count({ where: { id: onboardingSubject.id } }) : 0 }));
  `);
}

const test = base.extend<{ fixture: Fixture }>({
  fixture: async ({ page }, use, info) => {
    const f = createFixture();
    const errors: string[] = []; const external: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = route.request().url();
      if (/^https?:/.test(url) && new URL(url).origin !== origin) {
        external.push(new URL(url).origin); return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    await page.addInitScript(token => {
      if (!localStorage.getItem('token')) localStorage.setItem('token', token);
    }, f.token);
    try { await use(f); }
    finally {
      await page.close();
      const cleanup = removeFixture(f);
      await info.attach('isolated-fixture-cleanup', { body: JSON.stringify({ ...cleanup, errors, external }), contentType: 'application/json' });
      expect(cleanup.remainingUsers).toBe(0); expect(cleanup.remainingReferences).toBe(0);
      expect(cleanup.remainingSubjects).toBe(0);
      expect(errors).toEqual([]); expect(external).toEqual([]);
    }
  },
});
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15_000 });
test.setTimeout(240_000);

test.beforeAll(({}, info) => {
  expect(info.config.globalSetup).toBeNull();
  expect(info.project.use.baseURL).toBe(origin);
  const [api, web] = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1', 'hrm-web-1'], { encoding: 'utf8', timeout: 15_000 }));
  for (const container of [api, web]) {
    expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
    expect(container.State.Running).toBe(true);
  }
  expect(Object.keys(api.NetworkSettings.Networks)).toEqual(['hrm_internal']);
  expect(web.NetworkSettings.Ports['5173/tcp']).toEqual([{ HostIp: '127.0.0.1', HostPort: '5173' }]);
  execFileSync('docker', ['exec', 'hrm-api-1', 'node', 'prisma/preview-guard.cjs'], { stdio: 'pipe', timeout: 15_000 });
});

function optionName(f: Fixture, option: Option) { return `虚构${option.label}${f.prefix}`; }
function field(drawer: Locator, path: string) { return drawer.locator(`[data-archive-field="${path}"]`); }
function selected(field: Locator, value: string) { return field.locator('.el-select__selected-item').filter({ hasText: value }); }
function responseFor(page: Page, path: string, method: string) {
  return page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1${path}` && response.request().method() === method);
}
async function evidence(info: TestInfo, name: string, response: Response | APIResponse, layer: string) {
  const body = await response.json();
  await info.attach(name, { body: JSON.stringify({ layer, path: new URL(response.url()).pathname, status: response.status(),
    message: body.message, code: body.code, fieldErrors: body.data?.fieldErrors }), contentType: 'application/json' });
  return body;
}
async function api(page: Page, f: Fixture, path: string, method = 'GET', data?: unknown, token = f.token) {
  return page.request.fetch(`${origin}/api/v1${path}`, { method, headers: { authorization: `Bearer ${token}` },
    ...(data === undefined ? {} : { data }), maxRedirects: 0 });
}
async function archive(page: Page, f: Fixture) {
  const response = await api(page, f, `/employee-archives/${f.employee.id}`);
  expect(response.status()).toBe(200); return (await response.json()).data;
}
async function snapshot(page: Page, info: TestInfo, name: string) {
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled', scale: 'css' });
}
async function directory(page: Page, option: Option) {
  await page.goto(`/basic-data?tab=${option.tab}`);
  await expect(page.getByRole('tab', { name: '档案选项', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('combobox', { name: '资料类别', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `新增${option.label}`, exact: true })).toBeVisible();
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
}
async function createOption(page: Page, f: Fixture, info: TestInfo, option: Option) {
  await directory(page, option);
  await page.getByRole('button', { name: `新增${option.label}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `新增${option.label}`, exact: true });
  const name = optionName(f, option);
  await dialog.getByRole('textbox', { name: `${option.label}名称`, exact: true }).fill(name);
  const pending = responseFor(page, `/personnel-reference-data/${option.kind}`, 'POST');
  await dialog.getByRole('button', { name: `保存${option.label}`, exact: true }).click();
  const response = await pending;
  const body = await evidence(info, `page-create-${option.kind}`, response, 'real page create');
  expect(response.status(), `${option.kind}: old preview API returns 400; not business acceptance`).toBe(201);
  expect(body.data).toMatchObject({ kind: option.kind, name, isActive: true });
  expect(body.data.id).toMatch(/^[a-f0-9-]{36}$/);
  await expect(dialog).not.toBeVisible();
  await page.getByRole('textbox', { name: `搜索${option.label}名称`, exact: true }).fill(name);
  await expect(page.getByText(name, { exact: true }).filter({ visible: true })).toBeVisible();
  return body.data.id as string;
}
async function openEditor(page: Page, f: Fixture) {
  await page.goto(`/users?employeeId=${f.employee.id}`);
  const drawer = page.getByRole('dialog', { name: '员工档案', exact: true });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
  await expect(drawer.locator('.archive-inline-editor')).toBeVisible();
  return drawer;
}
async function choose(page: Page, target: Locator, value: string) {
  await target.getByRole('combobox').fill(value);
  await page.locator('.personnel-reference-options:visible').getByRole('option', { name: value, exact: true }).click();
  await expect(selected(target, value)).toBeVisible();
}
async function submit(page: Page, f: Fixture, drawer: Locator, info: TestInfo, name: string) {
  const pending = responseFor(page, `/employee-archives/${f.employee.id}/draft`, 'PATCH');
  await expect(drawer.getByRole('button', { name: '提交', exact: true })).toBeInViewport();
  await drawer.getByRole('button', { name: '提交', exact: true }).click();
  const response = await pending;
  const body = await evidence(info, name, response, 'real page explicit archive submit');
  expect(response.status()).toBe(200); expect(body.data.reviewOutcome).not.toBe('pending');
  await expect(drawer.getByRole('button', { name: '编辑档案', exact: true })).toBeVisible();
  return response.request().postDataJSON();
}
async function exportFromPage(page: Page, f: Fixture, info: TestInfo, expected: Record<string, string>, name: string) {
  await page.goto('/users');
  await page.getByPlaceholder('搜索姓名、当前工号或历史工号').fill(f.employee.employeeNo);
  const queried = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/users'
    && new URL(r.url()).searchParams.get('keyword') === f.employee.employeeNo);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  const list = await queried; expect(list.status()).toBe(200);
  expect((await list.json()).data.items.map((u: { id: string }) => u.id)).toEqual([f.employee.id]);
  await page.getByRole('button', { name: '导出花名册', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导出花名册', exact: true });
  await expect(dialog.getByText('预计导出 1 条记录', { exact: true })).toBeVisible();
  await expect(dialog.locator('.el-loading-mask:visible')).toHaveCount(0);
  await dialog.getByRole('button', { name: '清空', exact: true }).click();
  for (const header of ['姓名', '工号', ...Object.keys(expected)]) {
    await dialog.getByText(header, { exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: header, exact: true })).toBeChecked();
  }
  await expect(dialog.getByRole('button', { name: '导出 Excel', exact: true })).toBeInViewport();
  await snapshot(page, info, `${name}-dialog`);
  const downloading = page.waitForEvent('download');
  const exporting = responseFor(page, '/users/export', 'GET');
  await dialog.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const response = await exporting; expect(response.status()).toBe(200);
  expect(new URL(response.url()).searchParams.get('keyword')).toBe(f.employee.employeeNo);
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/^花名册-\d{8}\.xlsx$/);
  const path = info.outputPath(`${name}-fictional.xlsx`);
  await download.saveAs(path);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(path);
  const sheet = workbook.getWorksheet('花名册');
  expect(sheet.rowCount).toBe(3); expect(workbook.getWorksheet('历史合同')).toBeUndefined();
  const headers = sheet.getRow(2).values.slice(1) as string[];
  const row = Object.fromEntries(headers.map((header, i) => [header, sheet.getRow(3).getCell(i + 1).value]));
  expect(row).toEqual({ '姓名': f.employee.name, '工号': f.employee.employeeNo, ...expected });
  await expect(dialog).not.toBeVisible();
  await info.attach(name, { body: JSON.stringify({ layer: 'page click -> browser download -> ExcelJS readback',
    status: response.status(), rows: 1, row }), contentType: 'application/json' });
}

test('all eight dictionaries: page create, strict selection, explicit submit, reopen and browser XLSX download', async ({ page, fixture: f }, info) => {
  for (const option of options) await createOption(page, f, info, option);
  await snapshot(page, info, 'eight-dictionaries-created');
  const drawer = await openEditor(page, f);
  for (const option of options) {
    const target = field(drawer, option.field);
    if (options.indexOf(option) < 6) {
      const unknown = `未维护${f.prefix}`;
      await target.getByRole('combobox').fill(unknown);
      await expect(page.locator('.personnel-reference-options:visible').getByRole('option', { name: unknown, exact: true })).toHaveCount(0);
      await target.getByRole('combobox').press('Escape');
      await expect(selected(target, unknown)).toHaveCount(0);
    }
    await choose(page, target, optionName(f, option));
  }
  await expect(drawer.locator('.archive-footer-state')).toContainText('草稿已保存');
  const draftOnly = await archive(page, f);
  expect(draftOnly.currentEmployment.jobGrade).toBeNull();
  expect(draftOnly.employeeProfile.education).toBeNull();
  const payload = await submit(page, f, drawer, info, 'eight-dictionaries-submit');
  const saved = await archive(page, f);
  for (const option of options) {
    const [section, key] = option.field.split('.');
    const actual = section === 'contracts' ? saved.employeeContracts.find((c: { id: string }) => c.id === f.contractId).name
      : section === 'employee' ? saved.currentEmployment[key!] : saved.employeeProfile[key!];
    expect(actual).toBe(optionName(f, option));
    expect(section === 'contracts' ? payload.contracts[0].name : payload[section!][key!]).toBe(optionName(f, option));
  }
  const reopened = await openEditor(page, f);
  for (const option of options) {
    await expect(selected(field(reopened, option.field), optionName(f, option))).toBeVisible();
  }
  await snapshot(page, info, 'eight-dictionaries-reopened');
  await exportFromPage(page, f, info, Object.fromEntries(options.map(o => [o.header, optionName(f, o)])), 'eight-dictionaries-export');
});

test('new onboarding selects all eight page-created options and preserves them through a different reviewer and arrival', async ({ page, fixture: f }, info) => {
  test.setTimeout(300_000);
  f.onboardingSubject = fixtureQuery(`
    const subject = await prisma.contractSubject.create({ data: { name: '虚构入职主体${f.prefix}', internalCompany: 'fuede', isActive: true } });
    console.log(JSON.stringify({ id: subject.id, name: subject.name }));
  `);
  for (const option of options) await createOption(page, f, info, option);
  const name = `虚构新选项入职${f.prefix}`;
  const entryDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(Date.now() - 86_400_000));
  await page.goto('/entry-exit');
  await page.getByRole('button', { name: '办理入职', exact: true }).click();
  const create = page.getByRole('dialog', { name: '办理入职', exact: true });
  await field(create, 'employee.name').getByRole('textbox').fill(name);
  await create.getByRole('button', { name: '下一步', exact: true }).click();
  await field(create, 'employee.companyText').getByRole('combobox').fill(f.onboardingSubject!.name);
  await page.getByRole('option', { name: f.onboardingSubject!.name, exact: true }).click();
  await field(create, 'employee.deptId').getByRole('combobox').click();
  await page.getByRole('treeitem').filter({ hasText: '预览业务部' }).click();
  await field(create, 'employee.employeeStatus').locator('.el-select__wrapper').click();
  await page.getByRole('option', { name: '在职', exact: true }).click();
  for (const key of ['employee.entryDate', 'employee.effectiveFrom']) {
    const input = field(create, key).locator('input');
    await input.fill(entryDay); await input.press('Tab'); await expect(input).toHaveValue(entryDay);
  }
  await choose(page, field(create, options[0].field), optionName(f, options[0]));
  await create.getByRole('button', { name: '下一步', exact: true }).click();
  await create.getByRole('button', { name: '个人与教育', exact: true }).click();
  for (const option of options.slice(1, 5)) await choose(page, field(create, option.field), optionName(f, option));
  await create.getByRole('button', { name: '联系与保障', exact: true }).click();
  for (const option of options.slice(5, 7)) await choose(page, field(create, option.field), optionName(f, option));
  await create.getByRole('button', { name: '合同与附件', exact: true }).click();
  await create.getByRole('button', { name: '新增合同', exact: true }).click();
  await choose(page, field(create, options[7].field), optionName(f, options[7]));
  await field(create, 'contracts.0.contractSubjectId').getByRole('combobox').fill(f.onboardingSubject!.name);
  await page.getByRole('option', { name: f.onboardingSubject!.name, exact: true }).click();
  const contractDate = field(create, 'contracts.0.effectiveFrom').locator('input');
  await contractDate.fill(entryDay); await contractDate.press('Tab');
  await create.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(create.getByRole('heading', { name: '检查并提交', exact: true })).toBeVisible();
  await snapshot(page, info, 'onboarding-options-before-submit');
  const submitting = responseFor(page, '/employee-archives', 'POST');
  await create.getByRole('button', { name: '提交', exact: true }).click();
  const submission = await submitting;
  const submitted = (await evidence(info, 'onboarding-page-submit', submission, 'real new-onboarding page submit')).data;
  expect(submission.status()).toBe(201);
  expect(submitted).toMatchObject({ createdById: f.hrId, profileReviewStatus: 'pending', intakeType: 'new_hire' });
  const payload = submission.request().postDataJSON();
  for (const option of options) {
    const [section, key] = option.field.split('.');
    expect(section === 'contracts' ? payload.contracts[0].name : payload[section!][key!]).toBe(optionName(f, option));
  }
  await expect(create).not.toBeVisible();
  const detail = page.getByRole('dialog', { name: /办理详情$/ });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('button', { name: '通过', exact: true })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: '确认到岗', exact: true })).toHaveCount(0);

  await page.evaluate(token => localStorage.setItem('token', token), f.reviewerToken);
  await page.goto(`/entry-exit?tab=applications&requestId=${submitted.id}`);
  const me = await api(page, f, '/auth/me', 'GET', undefined, f.reviewerToken);
  expect((await me.json()).data.id).toBe(f.reviewerId); expect(f.reviewerId).not.toBe(f.hrId);
  await expect(detail).toContainText(name);
  const approving = responseFor(page, '/employee-archives/reviews/approve', 'POST');
  await detail.getByRole('button', { name: '通过', exact: true }).click();
  const approval = await approving;
  expect(approval.status()).toBe(201);
  expect((await evidence(info, 'onboarding-page-review', approval, 'real page review by different fictional identity')).data.failed).toEqual([]);
  const readApplication = async () => {
    const response = await api(page, f, `/employee-archives/applications/${submitted.id}`);
    expect(response.status()).toBe(200); return (await response.json()).data;
  };
  const approved = await readApplication();
  expect(approved).toMatchObject({ createdById: f.hrId, profileReviewedById: f.reviewerId, onboardingStatus: 'pending_entry' });
  const beforeArrival = await api(page, f, `/employee-archives/${approved.userId}`);
  expect((await beforeArrival.json()).data.status).toBe('pending_entry');
  const arriving = responseFor(page, `/employee-archives/applications/${submitted.id}/confirm-arrival`, 'POST');
  await detail.getByRole('button', { name: '确认到岗', exact: true }).click();
  const arrival = await arriving;
  expect(arrival.status()).toBe(201);
  expect((await evidence(info, 'onboarding-page-arrival', arrival, 'real page arrival confirmation')).data.onboardingStatus).toBe('effective');
  expect(await readApplication()).toMatchObject({ arrivalConfirmedById: f.reviewerId, onboardingStatus: 'effective' });
  await detail.getByRole('button', { name: '查看员工档案', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/users\\?employeeId=${approved.userId}`));
  await expect(page.getByRole('dialog', { name: '员工档案', exact: true })).toContainText(name);
  const response = await api(page, f, `/employee-archives/${approved.userId}`);
  expect(response.status()).toBe(200); const formal = (await response.json()).data;
  expect(formal.status).toBe('active');
  const contract = formal.employeeContracts.find((c: { name: string }) => c.name === optionName(f, options[7]));
  expect(contract).toBeTruthy();
  for (const option of options) {
    const [section, key] = option.field.split('.');
    expect(section === 'contracts' ? contract.name : section === 'employee' ? formal.currentEmployment[key!] : formal.employeeProfile[key!])
      .toBe(optionName(f, option));
  }
  await page.evaluate(token => localStorage.setItem('token', token), f.token);
  const onboarded = { ...f, employee: { id: approved.userId, employeeNo: formal.employeeNo, name }, contractId: contract.id };
  const reopened = await openEditor(page, onboarded);
  for (const option of options) await expect(selected(field(reopened, option.field), optionName(f, option))).toBeVisible();
  await snapshot(page, info, 'onboarding-options-arrived-and-reopened');
  await exportFromPage(page, onboarded, info, Object.fromEntries(options.map(o => [o.header, optionName(f, o)])), 'onboarding-options-export');
});

test('page disable and rename retain historical values; bank and contract accept custom text without creating dictionary rows', async ({ page, fixture: f }, info) => {
  const grade = options[0]; const education = options[1];
  const gradeId = await createOption(page, f, info, grade);
  const educationId = await createOption(page, f, info, education);
  let drawer = await openEditor(page, f);
  await choose(page, field(drawer, grade.field), optionName(f, grade));
  await choose(page, field(drawer, education.field), optionName(f, education));
  await submit(page, f, drawer, info, 'before-directory-changes');

  await directory(page, education);
  await page.getByRole('textbox', { name: '搜索学历名称', exact: true }).fill(optionName(f, education));
  await page.getByRole('button', { name: '停用', exact: true }).filter({ visible: true }).click();
  const disabled = responseFor(page, `/personnel-reference-data/education/${educationId}`, 'PATCH');
  await page.getByRole('button', { name: '停用学历', exact: true }).click();
  const disableResponse = await disabled;
  expect(disableResponse.status()).toBe(200);
  expect((await evidence(info, 'page-disable-education', disableResponse, 'real page disable')).data.isActive).toBe(false);

  await directory(page, grade);
  await page.getByRole('textbox', { name: '搜索职级名称', exact: true }).fill(optionName(f, grade));
  await page.getByRole('button', { name: '修改名称', exact: true }).filter({ visible: true }).click();
  const renameDialog = page.getByRole('dialog', { name: '修改职级名称', exact: true });
  const renamed = `${optionName(f, grade)}新名`;
  await renameDialog.getByRole('textbox', { name: '职级名称', exact: true }).fill(renamed);
  const renaming = responseFor(page, `/personnel-reference-data/job_grade/${gradeId}`, 'PATCH');
  await renameDialog.getByRole('button', { name: '保存职级', exact: true }).click();
  const renameResponse = await renaming; expect(renameResponse.status()).toBe(200);
  expect((await evidence(info, 'page-rename-grade', renameResponse, 'real page rename')).data.name).toBe(renamed);
  await expect(renameDialog).not.toBeVisible();
  const unchanged = await archive(page, f);
  expect(unchanged.currentEmployment.jobGrade).toBe(optionName(f, grade));
  expect(unchanged.employeeProfile.education).toBe(optionName(f, education));

  drawer = await openEditor(page, f);
  for (const [option, marker] of [[education, '原值已停用'], [grade, '原值尚未维护']] as const) {
    const target = field(drawer, option.field);
    await expect(selected(target, optionName(f, option))).toBeVisible();
    await expect(target).toContainText(marker);
    await target.getByRole('combobox').click();
    const old = page.locator('.personnel-reference-options:visible').getByRole('option').filter({ hasText: optionName(f, option) }).first();
    await expect(old).toHaveAttribute('aria-disabled', 'true');
    await target.getByRole('combobox').press('Escape');
  }
  const bank = `虚构自由银行${f.prefix}`; const contract = `虚构自由合同${f.prefix}`;
  await choose(page, field(drawer, 'profile.bankName'), bank);
  await choose(page, field(drawer, 'contracts.0.name'), contract);
  await submit(page, f, drawer, info, 'retain-history-custom-text-submit');
  drawer = await openEditor(page, f);
  await expect(selected(field(drawer, grade.field), optionName(f, grade))).toBeVisible();
  await expect(selected(field(drawer, education.field), optionName(f, education))).toBeVisible();
  await expect(selected(field(drawer, 'profile.bankName'), bank)).toBeVisible();
  await expect(selected(field(drawer, 'contracts.0.name'), contract)).toBeVisible();
  await snapshot(page, info, 'history-retained-and-free-input');
  const saved = await archive(page, f);
  expect(saved.currentEmployment.jobGrade).toBe(optionName(f, grade));
  expect(saved.employeeProfile).toMatchObject({ education: optionName(f, education), bankName: bank });
  expect(saved.employeeContracts.find((c: { id: string }) => c.id === f.contractId).name).toBe(contract);
  for (const kind of ['bank_name', 'contract_name']) {
    const response = await api(page, f, `/personnel-reference-data/${kind}?includeInactive=true`);
    expect(response.status()).toBe(200);
    expect((await response.json()).data.some((r: { name: string }) => [bank, contract].includes(r.name))).toBe(false);
  }
  await exportFromPage(page, f, info, { '职级': optionName(f, grade), '学历': optionName(f, education), '开户行': bank, '合同名称': contract }, 'historical-values-export');
  // A changed value must use the active renamed item; inactive education cannot be selected anew.
  drawer = await openEditor(page, f);
  await choose(page, field(drawer, grade.field), renamed);
  const educationField = field(drawer, education.field);
  if (info.project.use.hasTouch) await educationField.getByRole('combobox').tap();
  else await educationField.getByRole('combobox').click();
  const clear = educationField.locator('.el-select__clear');
  await expect(clear).toBeVisible();
  if (info.project.use.hasTouch) await clear.tap();
  else await clear.click();
  await educationField.getByRole('combobox').fill(optionName(f, education));
  await expect(page.locator('.personnel-reference-options:visible').getByRole('option').filter({ hasText: optionName(f, education) })).toHaveCount(0);
  await educationField.getByRole('combobox').press('Escape');
  await submit(page, f, drawer, info, 'active-renamed-grade-and-clear-education');
  const final = await archive(page, f);
  expect(final.currentEmployment.jobGrade).toBe(renamed); expect(final.employeeProfile.education).toBeNull();
});

test('HTTP only: six unmanaged new values are rejected with field errors and no formal mutation', async ({ page, fixture: f }, info) => {
  test.skip(info.project.name !== 'desktop', 'HTTP evidence is independent of viewport; UI flows run in both projects.');
  for (const option of options.slice(0, 6)) {
    const before = await archive(page, f);
    const [section, key] = option.field.split('.');
    const response = await api(page, f, `/employee-archives/${f.employee.id}/draft`, 'PATCH', {
      baseVersion: before.archiveVersion, employee: {}, profile: {}, performance: {},
      [section!]: { [key!]: `未维护${f.prefix}` },
    });
    const body = await evidence(info, `http-unmanaged-${option.kind}`, response, 'direct HTTP, not page validation');
    expect.soft(response.status(), option.field).toBe(400);
    expect.soft(body.data?.fieldErrors?.[option.field], option.field).toMatch(/启用|基础资料/);
    const after = await archive(page, f);
    expect.soft(after.archiveVersion, `${option.field} must not mutate formal archive`).toBe(before.archiveVersion);
    expect.soft(section === 'employee' ? after.currentEmployment[key!] : after.employeeProfile[key!]).toBeNull();
  }
});

test('HTTP only: permission matrix, duplicate names and illegal dictionary kinds do not expand access', async ({ page, fixture: f }, info) => {
  test.skip(info.project.name !== 'desktop', 'HTTP permission proof is not mobile UI proof.');
  for (const option of options) {
    const path = `/personnel-reference-data/${option.kind}`;
    const allowed = await api(page, f, path, 'GET', undefined, f.reviewerToken);
    await evidence(info, `http-reviewer-read-${option.kind}`, allowed, 'direct HTTP permissions');
    expect.soft(allowed.status()).toBe(200);
    for (const [role, token] of [['organization-only', f.organizationToken], ['employee', f.employeeToken]]) {
      for (const method of ['GET', 'POST', 'PATCH']) {
        const response = await api(page, f, method === 'PATCH' ? `${path}/${randomUUID()}` : path,
          method, method === 'GET' ? undefined : { name: `虚构拒绝${f.prefix}` }, token);
        await evidence(info, `http-${role}-${method}-${option.kind}`, response, 'direct HTTP permissions, not UI acceptance');
        expect.soft(response.status(), `${role} ${method} ${path}`).toBe(403);
      }
    }
    for (const method of ['POST', 'PATCH']) {
      const response = await api(page, f, method === 'PATCH' ? `${path}/${randomUUID()}` : path,
        method, { name: `虚构拒绝${f.prefix}` }, f.reviewerToken);
      await evidence(info, `http-reviewer-${method}-${option.kind}`, response, 'direct HTTP read-only role');
      expect.soft(response.status()).toBe(403);
    }
  }
  const name = `虚构重名学历${f.prefix}`;
  const created = await api(page, f, '/personnel-reference-data/education', 'POST', { name });
  await evidence(info, 'http-duplicate-fixture-create', created, 'direct HTTP fixture');
  expect(created.status()).toBe(201);
  const duplicate = await api(page, f, '/personnel-reference-data/education', 'POST', { name });
  await evidence(info, 'http-duplicate-name', duplicate, 'direct HTTP uniqueness');
  expect(duplicate.status()).toBe(409);
  const listed = await api(page, f, '/personnel-reference-data/education?includeInactive=true');
  expect((await listed.json()).data.filter((r: { name: string }) => r.name === name)).toHaveLength(1);
  for (const kind of ['employment_type', 'contract_type', 'sys_role', 'department']) {
    const response = await api(page, f, `/personnel-reference-data/${kind}`, 'POST', { name: `虚构非法${f.prefix}` });
    await evidence(info, `http-illegal-${kind}`, response, 'direct HTTP invalid kind');
    expect(response.status()).toBe(400);
  }
});
