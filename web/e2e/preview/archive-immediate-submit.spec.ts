import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const ExcelJS = createRequire(resolve(process.cwd(), '../api/package.json'))('exceljs');
const origin = 'http://localhost:5173';
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15_000 });
test.setTimeout(180_000);

function fixtureQuery(source: string) {
  return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 25_000,
    input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();
      (async () => {
        if (!await prisma.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Uninitialized preview');
        ${source}
      })().finally(() => prisma.$disconnect()).catch(() => { console.error('Isolated archive fixture operation failed'); process.exitCode = 1; });`,
  }));
}

type Fixture = {
  prefix: string; employee: { id: string; name: string; employeeNo: string };
  operatorId: string; reviewerId: string; managerId: string; newManagerId: string; newManagerName: string;
  departmentId: string; nextDepartmentId: string; positionId: string; subjectId: string; subjectName: string;
  contractId: string; taskId: string; cycleId: string; token: string; reviewerToken: string;
};

function createFixture(): Fixture {
  const prefix = `AI_${randomUUID().slice(0, 8)}`;
  return fixtureQuery(`
    const dept = await prisma.department.findFirstOrThrow({ where: { name: '预览业务部' } });
    const otherDept = await prisma.department.findFirstOrThrow({ where: { name: '预览人事部' } });
    const position = await prisma.position.findFirstOrThrow({ where: { code: 'PREVIEW_STAFF' } });
    const result = await prisma.$transaction(async tx => {
      const subject = await tx.contractSubject.create({ data: { name: '虚构档案主体${prefix}', internalCompany: 'fuede' } });
      const operator = await tx.user.create({ data: { employeeNo: '${prefix}_HR', name: '虚构档案维护员${prefix}',
        status: 'active', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'], deptId: dept.id,
        employmentHistory: { create: { effectiveFrom: new Date('2025-01-01T00:00:00Z'), entryDate: new Date('2025-01-01T00:00:00Z'),
          company: 'fuede', deptId: dept.id, employeeStatus: 'active', employeeNo: '${prefix}_HR', changeType: 'onboarding', sourceType: 'preview_fixture' } } } });
      const reviewer = await tx.user.create({ data: { employeeNo: '${prefix}_REVIEW', name: '虚构到岗确认员${prefix}',
        status: 'active', sysRole: 'hr', deptId: dept.id,
        employmentHistory: { create: { effectiveFrom: new Date('2025-01-01T00:00:00Z'), entryDate: new Date('2025-01-01T00:00:00Z'),
          company: 'fuede', deptId: dept.id, employeeStatus: 'active', employeeNo: '${prefix}_REVIEW', changeType: 'onboarding', sourceType: 'preview_fixture' } } } });
      const manager = await tx.user.create({ data: { employeeNo: '${prefix}_M1', name: '虚构原上级${prefix}', status: 'active', sysRole: 'employee', deptId: dept.id } });
      const nextManager = await tx.user.create({ data: { employeeNo: '${prefix}_M2', name: '虚构新上级${prefix}', status: 'active', sysRole: 'employee', deptId: dept.id } });
      const employee = await tx.user.create({ data: { employeeNo: '${prefix}_EMP', name: '虚构直接提交${prefix}',
        status: 'active', sysRole: 'employee', deptId: dept.id, positionId: position.id, position: position.name,
        entryDate: new Date('2025-01-01T00:00:00Z'), directManagerId: manager.id,
        employeeProfile: { create: { childrenCount: 0, bankName: '虚构原开户行', socialSecurityStatus: '虚构原状态' } },
        employmentHistory: { create: { effectiveFrom: new Date('2025-01-01T00:00:00Z'), entryDate: new Date('2025-01-01T00:00:00Z'),
          company: 'fuede', deptId: dept.id, positionId: position.id, position: position.name, jobGrade: '1',
          employeeStatus: 'active', employeeNo: '${prefix}_EMP', directManagerId: manager.id, changeType: 'onboarding', sourceType: 'preview_fixture' } } } });
      const contract = await tx.employeeContract.create({ data: { userId: employee.id, contractType: 'contract', sequence: 0,
        name: '虚构旧合同', contractSubjectId: subject.id, signingCompany: subject.name,
        effectiveFrom: new Date('2025-01-01T00:00:00Z'), expiresAt: new Date('2025-12-31T00:00:00Z') } });
      const cycle = await tx.assessmentCycle.create({ data: { name: '虚构冻结周期${prefix}', status: 'manager_score',
        startDate: new Date('2025-01-01T00:00:00Z'), endDate: new Date('2025-12-31T00:00:00Z') } });
      const task = await tx.assessmentTask.create({ data: { cycleId: cycle.id, employeeId: employee.id, managerId: manager.id, deptId: dept.id } });
      return { prefix: '${prefix}', employee: { id: employee.id, name: employee.name, employeeNo: employee.employeeNo },
        operatorId: operator.id, reviewerId: reviewer.id, managerId: manager.id, newManagerId: nextManager.id, newManagerName: nextManager.name,
        departmentId: dept.id, nextDepartmentId: otherDept.id, positionId: position.id, subjectId: subject.id, subjectName: subject.name,
        contractId: contract.id, taskId: task.id, cycleId: cycle.id };
    });
    const { JwtService } = require('@nestjs/jwt');
    const token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: result.operatorId, employeeNo: '${prefix}_HR' }, { expiresIn: '15m' });
    const reviewerToken = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: result.reviewerId, employeeNo: '${prefix}_REVIEW' }, { expiresIn: '15m' });
    console.log(JSON.stringify({ ...result, token, reviewerToken }));
  `) as Fixture;
}

function removeFixture(f: Fixture) {
  fixtureQuery(`
    const ownedIds = ${JSON.stringify([f.employee.id, f.operatorId, f.reviewerId, f.managerId, f.newManagerId])};
    const users = await prisma.user.findMany({ where: { id: { in: ownedIds } }, select: { id: true, employeeNo: true } });
    const ids = users.map(u => u.id);
    if (ids.length !== 5 || users.some(u => !u.employeeNo.startsWith('${f.prefix}_'))) throw new Error('Fixture ownership mismatch');
    const referenceAudits = await prisma.auditLog.findMany({ where: { userId: '${f.operatorId}', action: 'create_personnel_reference_data' }, select: { entityId: true } });
    const referenceIds = referenceAudits.map(a => a.entityId);
    const references = await prisma.personnelReferenceData.findMany({ where: { id: { in: referenceIds } } });
    if (references.some(r => !r.name.includes('${f.prefix}'))) throw new Error('Reference ownership mismatch');
    const requests = await prisma.employeeDataChangeRequest.findMany({ where: { OR: [{ userId: { in: ids } }, { createdById: '${f.operatorId}' }] }, select: { id: true } });
    await prisma.$transaction(async tx => {
      await tx.notificationLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { taskId: '${f.taskId}' }] } });
      await tx.auditLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { entityId: { in: [...ids, ...requests.map(r => r.id)] } }] } });
      await tx.assessmentTask.delete({ where: { id: '${f.taskId}' } });
      await tx.assessmentCycle.delete({ where: { id: '${f.cycleId}' } });
      await tx.employeeContract.deleteMany({ where: { userId: { in: ids } } });
      await tx.employmentRecord.deleteMany({ where: { userId: { in: ids } } });
      await tx.employeeNumberAssignment.deleteMany({ where: { userId: { in: ids } } });
      await tx.employeeDataChangeRequest.deleteMany({ where: { id: { in: requests.map(r => r.id) } } });
      await tx.employeeProfile.deleteMany({ where: { userId: { in: ids } } });
      await tx.user.updateMany({ where: { id: { in: ids } }, data: { directManagerId: null } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
      await tx.personnelReferenceData.deleteMany({ where: { id: { in: referenceIds } } });
      await tx.contractSubject.delete({ where: { id: '${f.subjectId}', name: '虚构档案主体${f.prefix}' } });
    }); console.log(JSON.stringify({ removedOwnFixture: true }));
  `);
}

function referenceName(f: Fixture, label: string) { return `虚构${label}${f.prefix}`; }

async function seedReferences(page: Page, f: Fixture, info: TestInfo) {
  // Use the real HTTP contract: an old preview API must fail red, not be bypassed by SQL.
  for (const [kind, label] of [['job_grade', '职级6'], ['job_grade', '职级7'], ['job_grade', '职级8'],
    ['job_grade', '职级9'], ['education', '一致学历']]) {
    const response = await page.request.post(`${origin}/api/v1/personnel-reference-data/${kind}`, {
      headers: { authorization: `Bearer ${f.token}` }, data: { name: referenceName(f, label!) }, maxRedirects: 0,
    });
    await info.attach(`fixture-${label}-http`, { body: JSON.stringify({ layer: 'HTTP fixture, not UI acceptance',
      method: 'POST', path: `/personnel-reference-data/${kind}`, status: response.status() }), contentType: 'application/json' });
    expect(response.status(), `Preview API must support ${kind}; do not restart it from this test`).toBe(201);
  }
}

async function selectReference(page: Page, field: Locator, name: string) {
  const input = field.getByRole('combobox');
  await input.fill(name);
  await page.locator('.personnel-reference-options:visible').getByRole('option', { name, exact: true }).click();
  await expect(field.locator('.el-select__selected-item').filter({ hasText: name })).toBeVisible();
}

async function clearReference(field: Locator, touch: boolean) {
  const input = field.getByRole('combobox');
  if (touch) await input.tap();
  else await input.click();
  const clear = field.locator('.el-select__clear');
  await expect(clear).toBeVisible();
  if (touch) await clear.tap();
  else await clear.click();
}

async function api(page: Page, f: Fixture, method: 'GET' | 'PATCH' | 'POST', path: string, data?: unknown, status = 200) {
  const response = await page.request.fetch(`${origin}/api/v1${path}`, {
    method, headers: { authorization: `Bearer ${f.token}` }, ...(data === undefined ? {} : { data }),
  });
  const body = await response.json();
  expect(response.status(), `${method} ${path}: ${JSON.stringify(body.data?.fieldErrors ?? body.message ?? '')}`).toBe(status);
  return body.data;
}

async function openEditor(page: Page, f: Fixture) {
  await page.addInitScript(token => localStorage.setItem('token', token), f.token);
  await page.goto(`${origin}/users?employeeId=${f.employee.id}`);
  const drawer = page.getByRole('dialog', { name: '员工档案', exact: true });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
  await expect(drawer.locator('.archive-inline-editor')).toBeVisible();
  return drawer;
}

async function exportedEmployee(page: Page, f: Fixture, columns: string) {
  const query = new URLSearchParams({ keyword: f.employee.employeeNo, archived: 'false', columns });
  const response = await page.request.get(`${origin}/api/v1/users/export?${query}`, {
    headers: { authorization: `Bearer ${f.token}` },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('spreadsheetml');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await response.body());
  expect(book.getWorksheet('历史合同')).toBeUndefined();
  const sheet = book.getWorksheet('花名册');
  expect(sheet.rowCount).toBe(3);
  const headers = sheet.getRow(2).values.slice(1) as string[];
  return Object.fromEntries(headers.map((header, column) => [header, sheet.getRow(3).getCell(column + 1).value]));
}

async function snapshot(page: Page, info: TestInfo, name: string) {
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled', scale: 'css' });
}

test.beforeAll(({}, info) => {
  expect(info.config.globalSetup).toBeNull();
  expect(info.project.use.baseURL).toBe(origin);
  const [api, web] = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1', 'hrm-web-1'], { encoding: 'utf8' }));
  for (const container of [api, web]) {
    expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
    expect(container.State.Running).toBe(true);
  }
  execFileSync('docker', ['exec', 'hrm-api-1', 'node', 'prisma/preview-guard.cjs'], { stdio: 'pipe', timeout: 15_000 });
  expect(Object.keys(api.NetworkSettings.Networks)).toEqual(['hrm_internal']);
  expect(web.NetworkSettings.Ports['5173/tcp']).toContainEqual({ HostIp: '127.0.0.1', HostPort: '5173' });
});

test('edit-only HR submits archive, contracts and performance manager immediately while lifecycle and frozen tasks stay independent', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'The HTTP and database contract only needs one run.');
  expect(info.config.globalSetup).toBeNull();
  const f = createFixture();
  try {
    await seedReferences(page, f, info);
    const before = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
    const body = {
      baseVersion: before.archiveVersion,
      employee: { name: `${f.employee.name}已修改`, deptId: f.nextDepartmentId, jobGrade: referenceName(f, '职级7'), workLocation: '虚构新地点',
        company: 'fuede', contractSubjectId: f.subjectId, managerId: f.newManagerId },
      profile: { bankName: '虚构新开户行', socialSecurityStatus: '已缴纳', childrenCount: 1 },
      contracts: [
        { id: f.contractId, contractType: 'contract', name: '虚构旧合同修订', sequence: 0, contractSubjectId: f.subjectId,
          signingCompany: f.subjectName, effectiveFrom: '2025-01-01', expiresAt: '2025-12-31' },
        { contractType: 'renewal', name: '虚构新合同', sequence: 1, contractSubjectId: f.subjectId,
          signingCompany: f.subjectName, effectiveFrom: '2026-01-01', expiresAt: '2026-12-31' },
      ],
      performance: { managerId: f.newManagerId },
    };
    const draft = await api(page, f, 'PATCH', `/employee-archives/${f.employee.id}/draft/save`, body);
    const stillFormal = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
    expect(stillFormal.name).toBe(before.name);
    expect(stillFormal.directManagerId ?? stillFormal.performanceManager?.id).toBe(f.managerId);
    expect(stillFormal.employeeProfile.bankName).toBe('虚构原开户行');
    const submitted = await api(page, f, 'PATCH', `/employee-archives/${f.employee.id}/draft`, {
      ...body, draftId: draft.id, expectedVersion: draft.requestVersion,
    });
    expect(submitted.reviewOutcome).not.toBe('pending');
    const after = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
    expect(after.name).toBe(body.employee.name);
    expect(after.deptId).toBe(f.nextDepartmentId);
    expect(after.currentEmployment.jobGrade).toBe(referenceName(f, '职级7'));
    expect(after.directManagerId ?? after.performanceManager?.id).toBe(f.newManagerId);
    expect(after.employeeProfile).toMatchObject(body.profile);
    const contracts = after.employeeContracts.filter((contract: any) => contract.isActive !== false).sort((a: any, b: any) => a.sequence - b.sequence);
    expect(contracts.map((contract: any) => [contract.name, contract.sequence])).toEqual([['虚构旧合同修订', 0], ['虚构新合同', 1]]);
    const roster = await api(page, f, 'GET', `/users?${new URLSearchParams({ keyword: f.employee.employeeNo, archived: 'false' })}`);
    expect(roster.items).toHaveLength(1);
    expect(roster.items[0]).toMatchObject({ id: f.employee.id, name: body.employee.name, directManagerId: f.newManagerId });
    const exported = await exportedEmployee(page, f, 'name,employeeNo,companyText,rosterManagerName,directManagerName,latestContractType,latestContractName,latestEffectiveFrom');
    expect(exported).toMatchObject({ '姓名': body.employee.name, '工号': f.employee.employeeNo,
      '所属公司': after.currentEmployment.companyText, '花名册直属主管': f.newManagerName,
      '绩效直属上级': roster.items[0].directManagerName, '合同类型': '续签', '合同名称': '虚构新合同',
      '生效日期': new Date('2026-01-01T00:00:00Z') });
    expect(after.changeHistory.some((request: any) => request.id === draft.id && request.appliedAt)).toBe(true);
    const invariant = fixtureQuery(`
      const user = await prisma.user.findUniqueOrThrow({ where: { id: '${f.employee.id}' }, select: { status: true, sysRole: true, employeeNo: true } });
      const operator = await prisma.user.findUniqueOrThrow({ where: { id: '${f.operatorId}' }, select: { sysRole: true, hrCapabilities: true } });
      const task = await prisma.assessmentTask.findUniqueOrThrow({ where: { id: '${f.taskId}' }, select: { managerId: true, deptId: true } });
      const historyCount = await prisma.employmentRecord.count({ where: { userId: '${f.employee.id}' } });
      console.log(JSON.stringify({ user, operator, task, historyCount }));
    `);
    expect(invariant).toMatchObject({ user: { status: 'active', sysRole: 'employee', employeeNo: f.employee.employeeNo },
      operator: { sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] }, task: { managerId: f.managerId, deptId: f.departmentId } });
    expect(invariant.historyCount).toBeGreaterThan(1);
    await api(page, f, 'POST', '/employee-archives/reviews/approve', { requestIds: [draft.id], scopes: ['profile'] }, 403);
    const managerChanged = await api(page, f, 'POST', `/employee-archives/${f.employee.id}/performance-manager-review`, { managerId: f.managerId }, 201);
    expect(managerChanged.reviewOutcome).not.toBe('pending');
    expect((await api(page, f, 'GET', `/employee-archives/${f.employee.id}`)).directManagerId).toBe(f.managerId);
    const resignation = await api(page, f, 'POST', `/employee-archives/${f.employee.id}/employments`, {
      effectiveFrom: '2026-11-13', company: 'fuede', deptId: f.nextDepartmentId, employmentType: 'full_time',
      employeeStatus: 'resigned', entryDate: '2025-01-01', leaveDate: '2026-11-12', changeType: 'resignation', reason: '虚构测试离职',
    }, 201);
    expect(resignation.profileReviewStatus).toBe('pending');
    expect((await api(page, f, 'GET', `/employee-archives/${f.employee.id}`)).status).toBe('active');
    await info.attach('immediate-submit-boundaries', { body: JSON.stringify({ directSubmit: true, draftNotApplied: true,
      contractOrderStable: true, editOnlyRole: true, personnelSettingsImmediate: true, reviewStillDenied: true, resignationStillPending: true,
      frozenTaskUnchanged: true, historyRetained: true, exportEvidence: 'HTTP XLSX readback, not page download' }), contentType: 'application/json' });
  } finally { removeFixture(f); }
});

test('editing a pending employee preserves arrival workflow and edited values survive arrival confirmation', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'One real backend transaction sequence is sufficient.');
  const f = createFixture();
  try {
    await seedReferences(page, f, info);
    // Prepare this run's fictional employee in the same approved-but-not-arrived shape as onboarding.
    const pending = fixtureQuery(`
      const request = await prisma.$transaction(async tx => {
        const request = await tx.employeeDataChangeRequest.create({ data: {
          userId: '${f.employee.id}', employeeNo: '${f.employee.employeeNo}', employeeName: '${f.employee.name}',
          sourceType: 'manual_employee_create', intakeType: 'new_hire', onboardingStatus: 'pending_entry',
          requiresArrivalConfirmation: true, recordStatus: 'submitted', profileReviewStatus: 'approved', performanceReviewStatus: 'approved',
          createdById: '${f.operatorId}', proposedValue: { employee: { name: '${f.employee.name}', company: 'fuede',
            deptId: '${f.departmentId}', positionId: '${f.positionId}', employeeStatus: 'probation', employmentType: 'full_time',
            employeeNo: '${f.employee.employeeNo}', entryDate: '2025-01-01', effectiveDate: '2025-01-01', managerId: '${f.managerId}' },
            profile: {}, performance: { managerId: '${f.managerId}' } },
        } });
        await tx.employmentRecord.updateMany({ where: { userId: '${f.employee.id}' }, data: {
          sourceRequestId: request.id, sourceType: 'manual_employee_create', employeeStatus: 'probation' } });
        await tx.employeeNumberAssignment.create({ data: { userId: '${f.employee.id}', employeeNo: '${f.employee.employeeNo}',
          status: 'reserved', effectiveFrom: new Date('2025-01-01T00:00:00Z'), sourceRequestId: request.id } });
        await tx.user.update({ where: { id: '${f.employee.id}' }, data: { status: 'pending_entry', directManagerId: null } });
        return { id: request.id, requestVersion: request.requestVersion };
      }); console.log(JSON.stringify(request));
    `);
    const original = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
    expect(original.status).toBe('pending_entry');
    const changedName = `${f.employee.name}待到岗修订`;
    const changed = await api(page, f, 'PATCH', `/employee-archives/${f.employee.id}/draft`, {
      baseVersion: original.archiveVersion,
      employee: { name: changedName, deptId: f.nextDepartmentId, jobGrade: referenceName(f, '职级9'), workLocation: '虚构到岗新地点',
        employeeStatus: 'pending_entry', managerId: f.newManagerId },
      profile: { bankName: '虚构待到岗新开户行' }, performance: { managerId: f.newManagerId },
    });
    expect(changed.reviewOutcome).not.toBe('pending');
    const beforeArrival = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
    expect(beforeArrival).toMatchObject({ name: changedName, status: 'pending_entry', deptId: f.nextDepartmentId });
    expect(beforeArrival.employeeProfile.bankName).toBe('虚构待到岗新开户行');
    const application = await api(page, f, 'GET', `/employee-archives/applications/${pending.id}`);
    expect(application.onboardingStatus).toBe('pending_entry');
    expect(application.profileReviewStatus).toBe('approved');
    const arrivalBody = { requestVersion: application.requestVersion, arrivalDate: '2025-01-01' };
    await api(page, f, 'POST', `/employee-archives/applications/${pending.id}/confirm-arrival`, arrivalBody, 403);
    const confirmed = await api(page, { ...f, token: f.reviewerToken }, 'POST', `/employee-archives/applications/${pending.id}/confirm-arrival`, arrivalBody, 201);
    expect(confirmed.onboardingStatus).toBe('effective');
    const arrived = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
    expect(arrived).toMatchObject({ name: changedName, status: 'probation', deptId: f.nextDepartmentId,
      directManagerId: f.newManagerId, employeeNo: f.employee.employeeNo, sysRole: 'employee' });
    expect(arrived.currentEmployment).toMatchObject({ jobGrade: referenceName(f, '职级9'), workLocation: '虚构到岗新地点', directManagerId: f.newManagerId });
    expect(arrived.employeeProfile.bankName).toBe('虚构待到岗新开户行');
    await info.attach('pending-arrival-boundaries', { body: JSON.stringify({ archiveApplied: true, remainedPendingUntilArrival: true,
      editOnlyCannotConfirmArrival: true, confirmedByReviewer: true, arrivalPreservesEdits: true }), contentType: 'application/json' });
  } finally { removeFixture(f); }
});

test('archive rejects overlong fields beside the input and shows direct and sensitive change history', async ({ page }, info) => {
  const f = createFixture();
  try {
    await seedReferences(page, f, info);
    const initial = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
    const invalid = await page.request.patch(`${origin}/api/v1/employee-archives/${f.employee.id}/draft`, {
      headers: { authorization: `Bearer ${f.token}` }, maxRedirects: 0,
      data: { baseVersion: initial.archiveVersion, employee: {}, profile: { education: '文'.repeat(51) }, performance: {} },
    });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).data.fieldErrors['profile.education']).toContain('50');
    expect((await api(page, f, 'GET', `/employee-archives/${f.employee.id}`)).employeeProfile.education).toBeNull();
    const drawer = await openEditor(page, f);
    const education = drawer.locator('[data-archive-field="profile.education"]');
    // Education is now a strict selector; keep the UI length-error coverage on another 50-character field.
    const ethnicity = drawer.locator('[data-archive-field="profile.ethnicity"] input');
    await ethnicity.fill('文'.repeat(51));
    await drawer.getByRole('button', { name: '提交', exact: true }).click();
    await expect(drawer.locator('[data-archive-field="profile.ethnicity"] .el-form-item__error')).toContainText('50');
    await expect(ethnicity).toHaveValue('文'.repeat(51));
    await ethnicity.fill('');
    await selectReference(page, education, referenceName(f, '一致学历'));
    const save = () => page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/employee-archives/${f.employee.id}/draft`
      && response.request().method() === 'PATCH');
    let saved = save();
    await drawer.getByRole('button', { name: '提交', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(drawer.getByRole('button', { name: '编辑档案', exact: true })).toBeVisible();
    let archive = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
    expect(archive.employeeProfile.education).toBe(referenceName(f, '一致学历'));
    const directEvents = [...(archive.archiveEvents ?? []), ...archive.changeHistory.flatMap((request: any) => request.events ?? [])]
      .filter((event: any) => event.action === 'employee_profile_direct_update');
    expect(directEvents).toHaveLength(1);
    expect(directEvents[0].user.id).toBe(f.operatorId);
    await drawer.getByRole('tab', { name: '变更记录', exact: true }).click();
    for (const header of await drawer.locator('.change-history .el-collapse-item__header').all()) await header.click();
    await expect(drawer).toContainText(referenceName(f, '一致学历'));
    await snapshot(page, info, 'direct-change-history');

    for (const value of ['100000000000000001', '100000000000000002']) {
      await drawer.getByRole('tab', { name: '当前档案', exact: true }).click();
      await drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
      await drawer.locator('[data-archive-field="profile.bankAccount"] input').fill(value);
      saved = save();
      await drawer.getByRole('button', { name: '提交', exact: true }).click();
      expect((await saved).status()).toBe(200);
      await expect(drawer.getByRole('button', { name: '编辑档案', exact: true })).toBeVisible();
    }
    archive = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
    const sensitive = archive.changeHistory.find((request: any) => request.baseValue?.profile?.bankAccountConfigured
      && request.proposedValue?.profile?.bankAccountConfigured && request.changedFields?.includes('profile.bankAccount'));
    expect(sensitive).toBeTruthy();
    const serialized = JSON.stringify(archive);
    expect(serialized.includes('100000000000000001') || serialized.includes('100000000000000002')).toBe(false);
    expect(/bankAccountEncrypted|bankAccountFingerprint/.test(serialized)).toBe(false);
    await drawer.getByRole('tab', { name: '变更记录', exact: true }).click();
    for (const header of await drawer.locator('.change-history .el-collapse-item__header').all()) {
      if (!((await header.getAttribute('class')) || '').split(' ').includes('is-active')) await header.click();
    }
    await expect(drawer).toContainText('已更换');
    await snapshot(page, info, 'sensitive-change-safe-history');
    await drawer.getByRole('tab', { name: '当前档案', exact: true }).click();
    await drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
    await clearReference(education, !!info.project.use.hasTouch);
    saved = save();
    await drawer.getByRole('button', { name: '提交', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(drawer.getByRole('button', { name: '编辑档案', exact: true })).toBeEnabled();
    expect((await api(page, f, 'GET', `/employee-archives/${f.employee.id}`)).employeeProfile.education).toBeNull();
    await page.reload();
    await drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
    await expect(education.getByRole('combobox')).toHaveValue('');
    await expect(education.locator('.el-select__selected-item').filter({ hasText: referenceName(f, '一致学历') })).toHaveCount(0);
    expect((await exportedEmployee(page, f, 'name,employeeNo,education'))['学历'] ?? '').toBe('');
  } finally { removeFixture(f); }
});

for (const width of [1440, 1024, 390]) {
  test(`historical pending archive is editable, saves a draft, then submits immediately at ${width}px`, async ({ page }, info) => {
    test.skip(width === 390 ? info.project.name !== 'mobile' : info.project.name !== 'desktop', 'One matching project per viewport.');
    expect(info.config.globalSetup).toBeNull();
    await page.setViewportSize({ width, height: width === 390 ? 844 : width === 1024 ? 768 : 900 });
    const f = createFixture();
    const observed = { errors: [] as string[], external: [] as string[], writes: [] as string[] };
    page.on('pageerror', error => observed.errors.push(error.message));
    page.on('request', request => {
      if (!/^https?:/.test(request.url())) return;
      const url = new URL(request.url());
      if (url.origin !== origin) observed.external.push(url.origin);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) observed.writes.push(url.pathname);
    });
    try {
      await seedReferences(page, f, info);
      const archive = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
      const draft = await api(page, f, 'PATCH', `/employee-archives/${f.employee.id}/draft/save`, {
        baseVersion: archive.archiveVersion, employee: { jobGrade: referenceName(f, '职级6') }, profile: {}, performance: {},
      });
      fixtureQuery(`
        const changed = await prisma.employeeDataChangeRequest.updateMany({ where: { id: '${draft.id}', userId: '${f.employee.id}', sourceType: 'manual_archive_change' },
          data: { recordStatus: 'submitted', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required' } });
        if (changed.count !== 1) throw new Error('Fixture request missing'); console.log(JSON.stringify({ changed: changed.count }));
      `);
      const drawer = await openEditor(page, f);
      const grade = drawer.locator('[data-archive-field="employee.jobGrade"]');
      await expect(grade.locator('.el-select__selected-item').filter({ hasText: referenceName(f, '职级6') })).toBeVisible();
      const openedWrites = observed.writes.length;
      await page.waitForTimeout(1100);
      expect(observed.writes.slice(openedWrites)).toEqual([]);
      await expect(drawer.getByText('已有待处理的档案变更', { exact: true })).toHaveCount(0);
      await snapshot(page, info, 'pending-continues-in-place');
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/employee-archives/${f.employee.id}/draft/save` && response.request().method() === 'PATCH');
      await selectReference(page, grade, referenceName(f, '职级8'));
      expect((await saved).status()).toBe(200);
      await expect(drawer.locator('.archive-footer-state')).toContainText('草稿已保存');
      expect((await api(page, f, 'GET', `/employee-archives/${f.employee.id}`)).currentEmployment.jobGrade).toBe('1');
      await drawer.getByRole('button', { name: '关闭', exact: true }).click();
      const reopened = await openEditor(page, f);
      await expect(reopened.locator('[data-archive-field="employee.jobGrade"] .el-select__selected-item').filter({ hasText: referenceName(f, '职级8') })).toBeVisible();
      const submitted = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/employee-archives/${f.employee.id}/draft` && response.request().method() === 'PATCH');
      await reopened.getByRole('button', { name: '提交', exact: true }).click();
      const response = await submitted;
      expect(response.status()).toBe(200);
      expect((await response.json()).data.reviewOutcome).not.toBe('pending');
      const latest = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
      expect(latest.currentEmployment.jobGrade).toBe(referenceName(f, '职级8'));
      expect(latest.changeHistory.filter((request: any) => request.id === draft.id && request.appliedAt)).toHaveLength(1);
      await expect(page.locator('.el-message--error')).toHaveCount(0);
      expect(observed.errors).toEqual([]);
      expect(observed.external).toEqual([]);
      await snapshot(page, info, 'submitted-and-effective');
      await info.attach('pending-submit-evidence', { body: JSON.stringify({ width, oldRequestResumed: true, draftRetained: true,
        formalBeforeSubmitUnchanged: true, effectiveAfterSubmit: true, errors: observed.errors, external: observed.external }), contentType: 'application/json' });
    } finally { removeFixture(f); }
  });
}
