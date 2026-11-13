import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

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
  operatorId: string; managerId: string; newManagerId: string; newManagerName: string;
  departmentId: string; nextDepartmentId: string; positionId: string; subjectId: string;
  contractId: string; taskId: string; cycleId: string; token: string; reviewerToken: string;
};

function createFixture(): Fixture {
  const prefix = `AI_${randomUUID().slice(0, 8)}`;
  return fixtureQuery(`
    const dept = await prisma.department.findFirstOrThrow({ where: { name: '预览业务部' } });
    const otherDept = await prisma.department.findFirstOrThrow({ where: { name: '预览人事部' } });
    const position = await prisma.position.findFirstOrThrow({ where: { code: 'PREVIEW_STAFF' } });
    const subject = await prisma.contractSubject.findFirstOrThrow({ where: { name: '预览签约主体' } });
    const result = await prisma.$transaction(async tx => {
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
        departmentId: dept.id, nextDepartmentId: otherDept.id, positionId: position.id, subjectId: subject.id,
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
    const users = await prisma.user.findMany({ where: { employeeNo: { startsWith: '${f.prefix}_' } }, select: { id: true } });
    const ids = users.map(u => u.id);
    if (ids.length !== 5 || !ids.includes('${f.employee.id}')) throw new Error('Fixture ownership mismatch');
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
    }); console.log(JSON.stringify({ removedOwnFixture: true }));
  `);
}

async function api(page: Page, f: Fixture, method: 'GET' | 'PATCH' | 'POST', path: string, data?: unknown, status = 200) {
  const response = await page.request.fetch(`${origin}/api/v1${path}`, {
    method, headers: { authorization: `Bearer ${f.token}` }, ...(data === undefined ? {} : { data }),
  });
  expect(response.status(), `${method} ${path}`).toBe(status);
  return (await response.json()).data;
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

async function snapshot(page: Page, info: TestInfo, name: string) {
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled', scale: 'css' });
}

test.beforeAll(() => {
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
    const before = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
    const body = {
      baseVersion: before.archiveVersion,
      employee: { name: `${f.employee.name}已修改`, deptId: f.nextDepartmentId, jobGrade: '7', workLocation: '虚构新地点',
        company: 'fuede', contractSubjectId: f.subjectId, managerId: f.newManagerId },
      profile: { bankName: '虚构新开户行', socialSecurityStatus: '已缴纳', childrenCount: 1 },
      contracts: [
        { id: f.contractId, contractType: 'contract', name: '虚构旧合同修订', sequence: 0, contractSubjectId: f.subjectId,
          signingCompany: '预览签约主体', effectiveFrom: '2025-01-01', expiresAt: '2025-12-31' },
        { contractType: 'renewal', name: '虚构新合同', sequence: 1, contractSubjectId: f.subjectId,
          signingCompany: '预览签约主体', effectiveFrom: '2026-01-01', expiresAt: '2026-12-31' },
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
    expect(after.directManagerId ?? after.performanceManager?.id).toBe(f.newManagerId);
    expect(after.employeeProfile).toMatchObject(body.profile);
    const contracts = after.employeeContracts.filter((contract: any) => contract.isActive !== false).sort((a: any, b: any) => a.sequence - b.sequence);
    expect(contracts.map((contract: any) => [contract.name, contract.sequence])).toEqual([['虚构旧合同修订', 0], ['虚构新合同', 1]]);
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
      frozenTaskUnchanged: true, historyRetained: true }), contentType: 'application/json' });
  } finally { removeFixture(f); }
});

test('editing a pending employee preserves arrival workflow and edited values survive arrival confirmation', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'One real backend transaction sequence is sufficient.');
  const f = createFixture();
  try {
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
      employee: { name: changedName, deptId: f.nextDepartmentId, jobGrade: '9', workLocation: '虚构到岗新地点',
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
    expect(arrived.currentEmployment).toMatchObject({ jobGrade: '9', workLocation: '虚构到岗新地点', directManagerId: f.newManagerId });
    expect(arrived.employeeProfile.bankName).toBe('虚构待到岗新开户行');
    await info.attach('pending-arrival-boundaries', { body: JSON.stringify({ archiveApplied: true, remainedPendingUntilArrival: true,
      editOnlyCannotConfirmArrival: true, confirmedByReviewer: true, arrivalPreservesEdits: true }), contentType: 'application/json' });
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
      const archive = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
      const draft = await api(page, f, 'PATCH', `/employee-archives/${f.employee.id}/draft/save`, {
        baseVersion: archive.archiveVersion, employee: { jobGrade: '6' }, profile: {}, performance: {},
      });
      fixtureQuery(`
        const changed = await prisma.employeeDataChangeRequest.updateMany({ where: { id: '${draft.id}', userId: '${f.employee.id}', sourceType: 'manual_archive_change' },
          data: { recordStatus: 'submitted', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required' } });
        if (changed.count !== 1) throw new Error('Fixture request missing'); console.log(JSON.stringify({ changed: changed.count }));
      `);
      const drawer = await openEditor(page, f);
      const grade = drawer.locator('[data-archive-field="employee.jobGrade"] input');
      await expect(grade).toHaveValue('6');
      const openedWrites = observed.writes.length;
      await page.waitForTimeout(1100);
      expect(observed.writes.slice(openedWrites)).toEqual([]);
      await expect(drawer.getByText('已有待处理的档案变更', { exact: true })).toHaveCount(0);
      await snapshot(page, info, 'pending-continues-in-place');
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/employee-archives/${f.employee.id}/draft/save` && response.request().method() === 'PATCH');
      await grade.fill('8');
      expect((await saved).status()).toBe(200);
      await expect(drawer.locator('.archive-footer-state')).toContainText('草稿已保存');
      expect((await api(page, f, 'GET', `/employee-archives/${f.employee.id}`)).currentEmployment.jobGrade).toBe('1');
      await drawer.getByRole('button', { name: '关闭', exact: true }).click();
      const reopened = await openEditor(page, f);
      await expect(reopened.locator('[data-archive-field="employee.jobGrade"] input')).toHaveValue('8');
      const submitted = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/employee-archives/${f.employee.id}/draft` && response.request().method() === 'PATCH');
      await reopened.getByRole('button', { name: '提交', exact: true }).click();
      const response = await submitted;
      expect(response.status()).toBe(200);
      expect((await response.json()).data.reviewOutcome).not.toBe('pending');
      const latest = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
      expect(latest.currentEmployment.jobGrade).toBe('8');
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
