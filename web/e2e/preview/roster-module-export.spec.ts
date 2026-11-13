import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const ExcelJS = createRequire(resolve(process.cwd(), '../api/package.json'))('exceljs');
const origin = 'http://localhost:5173';
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15_000 });
test.setTimeout(120_000);

type Fixture = {
  prefix: string; keyword: string; departmentId: string; userIds: string[];
  employee: { id: string; employeeNo: string; name: string };
  archivedEmployeeNo: string; hrToken: string; organizationToken: string; employeeToken: string;
};
let fixture: Fixture | undefined;

function fixtureQuery(source: string) {
  return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 30_000,
    input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();
      (async () => {
        if (!await prisma.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Uninitialized preview');
        ${source}
      })().finally(() => prisma.$disconnect()).catch(() => { console.error('Isolated roster fixture operation failed'); process.exitCode = 1; });`,
  }));
}

function createFixture(): Fixture {
  const prefix = `RE_${randomUUID().slice(0, 8)}`;
  const numberPrefix = `000${Number.parseInt(prefix.slice(3), 16)}`;
  return fixtureQuery(`
    const dept = await prisma.department.findFirstOrThrow({ where: { name: '预览业务部' } });
    const position = await prisma.position.findFirstOrThrow({ where: { code: 'PREVIEW_STAFF' } });
    const subject = await prisma.contractSubject.findFirstOrThrow({ where: { name: '预览签约主体' } });
    const result = await prisma.$transaction(async tx => {
      const hr = await tx.user.create({ data: { employeeNo: '${prefix}_HR', name: '${prefix}_虚构档案HR',
        status: 'active', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'], deptId: dept.id,
        employmentHistory: { create: { effectiveFrom: new Date('2025-01-01T00:00:00Z'),
          entryDate: new Date('2025-01-01T00:00:00Z'), company: 'fuede', deptId: dept.id,
          employeeStatus: 'active', employeeNo: '${prefix}_HR', changeType: 'onboarding', sourceType: 'preview_fixture' } } } });
      const organization = await tx.user.create({ data: { employeeNo: '${prefix}_ORG', name: '${prefix}_虚构组织维护员',
        status: 'active', sysRole: 'hr_user', hrCapabilities: ['organization_edit'], deptId: dept.id,
        employmentHistory: { create: { effectiveFrom: new Date('2025-01-01T00:00:00Z'),
          entryDate: new Date('2025-01-01T00:00:00Z'), company: 'fuede', deptId: dept.id,
          employeeStatus: 'active', employeeNo: '${prefix}_ORG', changeType: 'onboarding', sourceType: 'preview_fixture' } } } });
      const users = [];
      for (let i = 0; i < 22; i++) {
        const employeeNo = '${numberPrefix}' + String(i).padStart(2, '0');
        const resigned = i >= 20;
        const user = await tx.user.create({ data: { employeeNo, name: '${prefix}_人员' + String(i).padStart(2, '0'),
          status: resigned ? 'resigned' : 'active', sysRole: 'employee', deptId: dept.id,
          archivedAt: i === 21 ? new Date('2026-02-01T00:00:00Z') : null,
          positionId: position.id, position: position.name, entryDate: new Date('2024-02-29T00:00:00Z'),
          employeeProfile: { create: { gender: '女', education: '本科', school: '虚构导出测试大学',
            birthDate: new Date('1995-03-08T00:00:00Z'), currentAddress: '虚构导出测试地址一号楼二单元三层',
            childrenCount: 0, bankName: '虚构测试银行', bankBranch: '虚构测试支行' } },
          employmentHistory: { create: { effectiveFrom: new Date('2024-02-29T00:00:00Z'),
            entryDate: new Date('2024-02-29T00:00:00Z'), company: 'fuede', companyText: '虚构导出公司',
            deptId: dept.id, positionId: position.id, position: position.name, jobGrade: '3',
            employeeStatus: resigned ? 'resigned' : 'active', employeeNo,
            leaveDate: resigned ? new Date('2025-12-31T00:00:00Z') : null,
            changeType: resigned ? 'resignation' : 'onboarding', sourceType: 'preview_fixture' } } } });
        users.push({ id: user.id, employeeNo, name: user.name });
      }
      await tx.employeeContract.createMany({ data: [
        { userId: users[0].id, contractType: 'contract', sequence: 0, name: '虚构首份合同',
          contractSubjectId: subject.id, signingCompany: subject.name, signedAt: new Date('2024-02-20T00:00:00Z'),
          effectiveFrom: new Date('2024-02-29T00:00:00Z'), expiresAt: new Date('2025-02-28T00:00:00Z') },
        { userId: users[0].id, contractType: 'renewal', sequence: 7, name: '虚构最新合同',
          contractSubjectId: subject.id, signingCompany: subject.name, signedAt: new Date('2025-02-20T00:00:00Z'),
          effectiveFrom: new Date('2025-03-01T00:00:00Z'), expiresAt: new Date('2027-02-28T00:00:00Z') },
        { userId: users[0].id, contractType: 'transfer', sequence: 9, name: '虚构停用合同', isActive: false,
          signedAt: new Date('2026-10-01T00:00:00Z'), effectiveFrom: new Date('2026-11-01T00:00:00Z'),
          expiresAt: new Date('2027-10-31T00:00:00Z') },
      ] });
      return { prefix: '${prefix}', keyword: '${prefix}_人员', departmentId: dept.id,
        userIds: [hr.id, organization.id, ...users.map(u => u.id)], employee: users[0],
        archivedEmployeeNo: users[21].employeeNo, hrId: hr.id, organizationId: organization.id };
    }, { timeout: 15_000 });
    const { JwtService } = require('@nestjs/jwt'); const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const sign = (sub, employeeNo) => jwt.sign({ sub, employeeNo }, { expiresIn: '20m' });
    console.log(JSON.stringify({ ...result, hrToken: sign(result.hrId, '${prefix}_HR'),
      organizationToken: sign(result.organizationId, '${prefix}_ORG'),
      employeeToken: sign(result.employee.id, result.employee.employeeNo) }));
  `) as Fixture;
}

function removeFixture(f: Fixture) {
  fixtureQuery(`
    const owned = await prisma.user.findMany({ where: { id: { in: ${JSON.stringify(f.userIds)} } }, select: { id: true, name: true } });
    if (owned.length !== 24 || owned.some(u => !u.name.startsWith('${f.prefix}_'))) throw new Error('Fixture ownership mismatch');
    const ids = owned.map(u => u.id);
    await prisma.$transaction(async tx => {
      await tx.auditLog.deleteMany({ where: { userId: { in: ids } } });
      await tx.employeeContract.deleteMany({ where: { userId: { in: ids } } });
      await tx.employmentRecord.deleteMany({ where: { userId: { in: ids } } });
      await tx.employeeProfile.deleteMany({ where: { userId: { in: ids } } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
    }); console.log(JSON.stringify({ removedOwnRosterFixture: true }));
  `);
}

async function request(requestContext: APIRequestContext, token: string, path: string, status = 200) {
  const response = await requestContext.get(`${origin}/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.status(), path).toBe(status);
  return response;
}

function query(f: Fixture, extra: Record<string, string> = {}) {
  return new URLSearchParams({ keyword: f.keyword, deptId: f.departmentId, includeResigned: 'true', ...extra }).toString();
}

async function workbook(response: Awaited<ReturnType<typeof request>>) {
  expect(response.headers()['content-type']).toContain('spreadsheetml');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await response.body());
  return book;
}

function dataRows(sheet: any) {
  const headers = sheet.getRow(2).values.slice(1) as string[];
  return Array.from({ length: Math.max(0, sheet.rowCount - 2) }, (_, i) =>
    Object.fromEntries(headers.map((header, column) => [header, sheet.getRow(i + 3).getCell(column + 1).value])));
}

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'Viewports are exercised explicitly in the desktop project.'));
test.beforeAll(({}, info) => {
  if (info.project.name !== 'desktop') return;
  expect(info.config.globalSetup).toBeNull();
  const [api, web] = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1', 'hrm-web-1'], { encoding: 'utf8' }));
  for (const container of [api, web]) {
    expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
    expect(container.State.Running).toBe(true);
  }
  expect(Object.keys(api.NetworkSettings.Networks)).toEqual(['hrm_internal']);
  expect(web.NetworkSettings.Ports['5173/tcp']).toContainEqual({ HostIp: '127.0.0.1', HostPort: '5173' });
  execFileSync('docker', ['exec', 'hrm-api-1', 'node', 'prisma/preview-guard.cjs'], { stdio: 'pipe', timeout: 15_000 });
  fixture = createFixture();
});
test.afterAll(() => { if (fixture) removeFixture(fixture); });

test('real roster export preserves field permissions, filtered scope, typed dates, identifiers and contract history', async ({ request: http }, info) => {
  const f = fixture!;
  const catalog = (await (await request(http, f.hrToken, '/users/export-fields')).json()).data;
  expect(catalog.map((group: any) => group.key)).toEqual(['employment', 'personal', 'contact', 'insurance', 'bank', 'contract', 'history', 'system']);
  const keys = catalog.flatMap((group: any) => group.fields.map((field: any) => field.key));
  expect(keys).toEqual(expect.arrayContaining(['phone', 'currentAddress', 'entryDate', 'latestContractName', 'contractHistory']));
  expect(keys).not.toEqual(expect.arrayContaining(['idNumberEncrypted', 'bankAccountEncrypted']));
  const orgCatalog = (await (await request(http, f.organizationToken, '/users/export-fields')).json()).data;
  const orgKeys = orgCatalog.flatMap((group: any) => group.fields.map((field: any) => field.key));
  expect(orgKeys).toHaveLength(10);
  expect(orgKeys).not.toContain('phone');
  await request(http, f.organizationToken, `/users/export?${query(f, { columns: 'name,phone' })}`, 403);
  await request(http, f.employeeToken, '/users/export-fields', 403);
  await request(http, f.employeeToken, `/users/export?${query(f, { columns: 'name' })}`, 403);
  await request(http, f.hrToken, `/users/export?${query(f, { columns: 'name,idNumberEncrypted' })}`, 400);
  const list = (await (await request(http, f.hrToken, `/users?${query(f, { page: '2', pageSize: '2' })}`)).json()).data;
  expect(list.total).toBe(21);
  expect(list.items).toHaveLength(2);
  const selected = 'name,employeeNo,entryDate,currentAddress,childrenCount,latestContractName,latestEffectiveFrom,contractHistory';
  const book = await workbook(await request(http, f.hrToken, `/users/export?${query(f, { columns: selected, page: '2', pageSize: '2' })}`));
  const roster = book.getWorksheet('花名册');
  const rows = dataRows(roster);
  expect(rows).toHaveLength(21);
  expect(rows.every(row => String(row['姓名']).startsWith(f.keyword))).toBe(true);
  expect(rows.map(row => row['工号'])).not.toContain(f.archivedEmployeeNo);
  const employee = rows.find(row => row['工号'] === f.employee.employeeNo)!;
  expect(employee).toBeDefined();
  expect(typeof employee['工号']).toBe('string');
  expect(String(employee['工号'])).toMatch(/^000/);
  expect(employee['入职日期']).toEqual(new Date('2024-02-29T00:00:00Z'));
  expect(employee['现住址']).toBe('虚构导出测试地址一号楼二单元三层');
  expect(employee['子女数量']).toBe(0);
  expect(employee['合同名称']).toBe('虚构最新合同');
  expect(employee['生效日期']).toEqual(new Date('2025-03-01T00:00:00Z'));
  expect(roster.views[0]).toMatchObject({ state: 'frozen', ySplit: 2 });
  expect(roster.getCell('A1').fill.type).toBe('pattern');
  expect(roster.getCell('A1').alignment.wrapText).toBe(true);
  expect(roster.autoFilter).toBeTruthy();
  const history = book.getWorksheet('历史合同');
  expect(history).toBeDefined();
  const historyValues: string[] = [];
  history.eachRow((row: any) => row.eachCell((cell: any) => historyValues.push(String(cell.value ?? ''))));
  expect(historyValues).toContain('虚构首份合同');
  expect(historyValues).toContain('虚构停用合同');
  expect(historyValues).not.toContain('虚构最新合同');
  const archived = dataRows((await workbook(await request(http, f.hrToken, `/users/export?${query(f, { archived: 'true', columns: 'name,employeeNo,status' })}`))).getWorksheet('花名册'));
  expect(archived).toHaveLength(1);
  expect(archived[0]!['工号']).toBe(f.archivedEmployeeNo);
  const resigned = dataRows((await workbook(await request(http, f.hrToken, `/users/export?${query(f, { status: 'resigned', columns: 'name,status' })}`))).getWorksheet('花名册'));
  expect(resigned).toHaveLength(1);
  expect(resigned[0]!['任职状态']).toBe('已离职');
  const organizationBook = await workbook(await request(http, f.organizationToken, `/users/export?${query(f, { columns: 'name,employeeNo' })}`));
  expect(dataRows(organizationBook.getWorksheet('花名册'))).toHaveLength(21);
  await info.attach('roster-export-contract', { body: JSON.stringify({ isolatedPreview: true, permittedFieldCatalog: true,
    organizationDeniedArchiveFields: true, employeeDeniedExport: true, allFilteredPages: 21, archiveScope: 1,
    currentAndHistoryContractsSeparated: true, identifiersStayText: true, datesTyped: true }), contentType: 'application/json' });
});

for (const width of [1440, 1024, 390]) {
  test(`${width}px real HR can select modules and download the complete queried roster`, async ({ page }, info) => {
    const f = fixture!;
    await page.setViewportSize({ width, height: width === 390 ? 844 : width === 1024 ? 768 : 900 });
    await page.addInitScript(token => localStorage.setItem('token', token), f.hrToken);
    await page.goto(`${origin}/users`);
    await page.getByPlaceholder('搜索姓名、当前工号或历史工号').fill(f.keyword);
    const loaded = page.waitForResponse(response => response.url().includes('/api/v1/users?') && new URL(response.url()).searchParams.get('keyword') === f.keyword);
    await page.getByRole('button', { name: '查询', exact: true }).click();
    expect((await loaded).status()).toBe(200);
    await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
    // Editing a filter without querying must not change the export snapshot.
    await page.getByPlaceholder('搜索姓名、当前工号或历史工号').fill('尚未查询的条件');
    await page.getByRole('button', { name: '导出花名册', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '导出花名册', exact: true });
    await expect(dialog.getByText('预计导出 21 条记录', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/全部未归档员工|全部部门.*全部系统权限|包含其他分页/)).toHaveCount(0);
    await dialog.getByRole('button', { name: '清空', exact: true }).click();
    const exportButton = dialog.getByRole('button', { name: '导出 Excel', exact: true });
    await expect(exportButton).toBeDisabled();
    const basic = dialog.getByRole('checkbox', { name: '选择基本与任职模块', exact: true });
    await dialog.getByText('基本与任职', { exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: '姓名', exact: true })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: '入职日期', exact: true })).toBeChecked();
    await dialog.getByText('姓名', { exact: true }).click();
    await expect(basic).toBeChecked({ indeterminate: true });
    await dialog.getByText('基本与任职', { exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: '姓名', exact: true })).toBeChecked();
    await dialog.getByText('当前合同', { exact: true }).click();
    await dialog.getByText('合同历史', { exact: true }).click();
    await expect(exportButton).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`roster-module-${width}.png`), fullPage: true, animations: 'disabled', scale: 'css' });
    const downloaded = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toMatch(/^花名册-\d{8}\.xlsx$/);
    const downloadedPath = await download.path();
    expect(downloadedPath).toBeTruthy();
    await download.saveAs(info.outputPath(`fictional-roster-${width}.xlsx`));
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(downloadedPath!);
    const rows = dataRows(book.getWorksheet('花名册'));
    expect(rows).toHaveLength(21);
    expect(rows.every(row => String(row['姓名']).startsWith(f.keyword))).toBe(true);
    expect(rows.find(row => row['工号'] === f.employee.employeeNo)!['合同名称']).toBe('虚构最新合同');
    expect(book.getWorksheet('历史合同')).toBeDefined();
    await expect(dialog).not.toBeVisible();
  });
}
