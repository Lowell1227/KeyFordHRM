import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const origin = 'http://localhost:5173';
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15_000, trace: 'off', video: 'off' });
test.setTimeout(120_000);

type Fixture = {
  prefix: string; ids: string[]; operatorId: string; reviewerId: string; managerId: string;
  arrivalId: string; departmentId: string; positionId: string;
  employee: { id: string; name: string; employeeNo: string }; token: string;
  references: { id: string; name: string }[];
  options: { a: string; b: string; revoked: string; edit: string; concurrentA: string; concurrentB: string };
};

function fixtureQuery(source: string) {
  try {
    return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
      encoding: 'utf8', timeout: 25_000, stdio: ['pipe', 'pipe', 'pipe'],
      input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
        const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();
        (async () => {
          if (!await prisma.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Uninitialized preview');
          ${source}
        })().finally(() => prisma.$disconnect()).catch(() => { process.exitCode = 1; });`,
    }));
  } catch {
    // Subprocess errors must not expose signed tokens or container configuration.
    throw new Error('Isolated concurrency fixture operation failed');
  }
}

function createFixture(): Fixture {
  const prefix = `CA_${randomUUID().slice(0, 8)}`;
  return fixtureQuery(`
    const dept = await prisma.department.findFirstOrThrow({ where: { name: '预览业务部' } });
    const position = await prisma.position.findFirstOrThrow({ where: { code: 'PREVIEW_STAFF' } });
    const result = await prisma.$transaction(async tx => {
      const options = Object.fromEntries(Object.entries({ a: '虚构窗口A已提交', b: '虚构窗口B保留输入',
        revoked: '虚构撤权前保留输入', edit: '虚构仅编辑能力修改', concurrentA: 'Synthetic concurrent A', concurrentB: 'Synthetic concurrent B' })
        .map(([key, label]) => [key, label + '${prefix}']));
      const references = [];
      for (const name of Object.values(options)) references.push(await tx.personnelReferenceData.create({
        data: { kind: 'education', name }, select: { id: true, name: true } }));
      const employment = employeeNo => ({ effectiveFrom: new Date('2025-01-01T00:00:00Z'), entryDate: new Date('2025-01-01T00:00:00Z'),
        company: 'fuede', deptId: dept.id, employeeStatus: 'active', employeeNo, changeType: 'onboarding', sourceType: 'preview_fixture' });
      const operator = await tx.user.create({ data: { employeeNo: '${prefix}_HR', name: '虚构并发维护员${prefix}',
        status: 'active', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'], deptId: dept.id,
        employmentHistory: { create: employment('${prefix}_HR') } } });
      const reviewer = await tx.user.create({ data: { employeeNo: '${prefix}_REVIEW', name: '虚构并发审核员${prefix}',
        status: 'active', sysRole: 'hr', deptId: dept.id, employmentHistory: { create: employment('${prefix}_REVIEW') } } });
      const manager = await tx.user.create({ data: { employeeNo: '${prefix}_M1', name: '虚构并发上级${prefix}',
        status: 'active', sysRole: 'employee', deptId: dept.id } });
      const arrival = await tx.user.create({ data: { employeeNo: '${prefix}_M2', name: '虚构到岗人员${prefix}',
        status: 'active', sysRole: 'employee', deptId: dept.id } });
      const employee = await tx.user.create({ data: { employeeNo: '${prefix}_EMP', name: '虚构并发档案${prefix}',
        status: 'active', sysRole: 'employee', deptId: dept.id, positionId: position.id, position: position.name,
        entryDate: new Date('2025-01-01T00:00:00Z'), directManagerId: manager.id,
        employeeProfile: { create: { childrenCount: 0, education: '虚构原学历' } },
        employmentHistory: { create: { ...employment('${prefix}_EMP'), positionId: position.id, position: position.name,
          jobGrade: '1', directManagerId: manager.id } } } });
      return { prefix: '${prefix}', references, options, ids: [operator.id, reviewer.id, manager.id, arrival.id, employee.id],
        operatorId: operator.id, reviewerId: reviewer.id, managerId: manager.id, arrivalId: arrival.id,
        departmentId: dept.id, positionId: position.id,
        employee: { id: employee.id, name: employee.name, employeeNo: employee.employeeNo } };
    });
    const { JwtService } = require('@nestjs/jwt');
    const token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: result.operatorId, employeeNo: '${prefix}_HR' }, { expiresIn: '15m' });
    console.log(JSON.stringify({ ...result, token }));
  `);
}

function removeFixture(f: Fixture) {
  const result = fixtureQuery(`
    const expected = ${JSON.stringify(f.ids)};
    const users = await prisma.user.findMany({ where: { employeeNo: { startsWith: '${f.prefix}_' } }, select: { id: true } });
    const ids = users.map(u => u.id);
    if (ids.length !== 5 || expected.some(id => !ids.includes(id))) throw new Error('Fixture ownership mismatch');
    const requests = await prisma.employeeDataChangeRequest.findMany({
      where: { OR: [{ userId: { in: ids } }, { createdById: { in: ids } }] }, select: { id: true, userId: true, createdById: true } });
    if (requests.some(r => !ids.includes(r.userId) || !ids.includes(r.createdById))) throw new Error('Foreign request ownership');
    await prisma.$transaction(async tx => {
      await tx.notificationLog.deleteMany({ where: { userId: { in: ids } } });
      await tx.auditLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { entityId: { in: [...ids, ...requests.map(r => r.id)] } }] } });
      await tx.employeeContract.deleteMany({ where: { userId: { in: ids } } });
      await tx.employmentRecord.deleteMany({ where: { userId: { in: ids } } });
      await tx.employeeNumberAssignment.deleteMany({ where: { userId: { in: ids } } });
      await tx.employeeDataChangeRequest.deleteMany({ where: { id: { in: requests.map(r => r.id) } } });
      await tx.employeeProfile.deleteMany({ where: { userId: { in: ids } } });
      await tx.user.updateMany({ where: { id: { in: ids } }, data: { directManagerId: null } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
      for (const reference of ${JSON.stringify(f.references)}) {
        await tx.personnelReferenceData.delete({ where: { id: reference.id, name: reference.name, kind: 'education' } });
      }
    });
    console.log(JSON.stringify({ remaining: await prisma.user.count({ where: { id: { in: expected } } }) }));
  `);
  expect(result.remaining).toBe(0);
}

async function request(page: Page, f: Fixture, method: string, path: string, data?: unknown) {
  return page.request.fetch(`${origin}/api/v1${path}`, {
    method, headers: { authorization: `Bearer ${f.token}` }, ...(data === undefined ? {} : { data }),
  });
}

async function api(page: Page, f: Fixture, method: string, path: string, data?: unknown, status = 200) {
  const response = await request(page, f, method, path, data);
  const body = await response.json();
  expect(response.status(), `${method} ${path}: ${JSON.stringify(body.message ?? '')}`).toBe(status);
  if (status === 403) {
    expect(body.data == null || Object.keys(body.data).length === 0).toBe(true);
    return body;
  }
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

function submitted(page: Page, f: Fixture) {
  return page.waitForResponse(response => response.request().method() === 'PATCH'
    && response.url() === `${origin}/api/v1/employee-archives/${f.employee.id}/draft`);
}

async function selectEducation(page: Page, drawer: ReturnType<Page['locator']>, value: string) {
  await drawer.locator('[data-archive-field="profile.education"] .el-select').click();
  await page.getByRole('option', { name: value, exact: true }).click();
}

async function snapshot(page: Page, info: TestInfo, name: string) {
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled', scale: 'css' });
}

test.beforeAll(() => {
  const [apiContainer, webContainer] = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1', 'hrm-web-1'], { encoding: 'utf8' }));
  for (const container of [apiContainer, webContainer]) {
    expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
    expect(container.State.Running).toBe(true);
  }
  execFileSync('docker', ['exec', 'hrm-api-1', 'node', 'prisma/preview-guard.cjs'], { stdio: 'pipe', timeout: 15_000 });
  expect(Object.keys(apiContainer.NetworkSettings.Networks)).toEqual(['hrm_internal']);
  expect(webContainer.NetworkSettings.Ports['5173/tcp']).toContainEqual({ HostIp: '127.0.0.1', HostPort: '5173' });
});

test('two real archive editors reject stale B with 409, retain input and preserve A', async ({ page, context }, info) => {
  expect(info.config.globalSetup).toBeNull();
  const f = createFixture();
  const second = await context.newPage();
  try {
    const a = await openEditor(page, f);
    const b = await openEditor(second, f);
    const inputA = a.locator('[data-archive-field="profile.education"] .el-select');
    const inputB = b.locator('[data-archive-field="profile.education"] .el-select');
    await expect(inputA).toContainText('虚构原学历');
    await expect(inputB).toContainText('虚构原学历');
    const responseA = submitted(page, f);
    await selectEducation(page, a, f.options.a);
    await a.getByRole('button', { name: '提交', exact: true }).click();
    const resultA = await responseA;
    expect(resultA.status()).toBe(200);
    await expect(a.getByRole('button', { name: '编辑档案', exact: true })).toBeVisible();
    const afterA = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
    expect(afterA.employeeProfile.education).toBe(f.options.a);
    // B remains open with the original archive version; no reload or network interception.
    const responseB = submitted(second, f);
    await selectEducation(second, b, f.options.b);
    await b.getByRole('button', { name: '提交', exact: true }).click();
    const resultB = await responseB;
    const formal = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
    const payloadA = resultA.request().postDataJSON();
    const payloadB = resultB.request().postDataJSON();
    const evidence = {
      viewport: info.project.name, twoEditorsOpenedBeforeSubmit: true,
      aSubmit: resultA.status(), bSubmit: resultB.status(), aBaseVersion: payloadA.baseVersion ?? null,
      bBaseVersion: payloadB.baseVersion ?? null, aDraftId: payloadA.draftId ?? null, bDraftId: payloadB.draftId ?? null,
      afterAVersion: afterA.archiveVersion, afterAEducation: afterA.employeeProfile.education,
      finalEducation: formal.employeeProfile.education,
    };
    await info.attach('real-two-page-responses', { contentType: 'application/json', body: JSON.stringify(evidence, null, 2) });
    await snapshot(second, info, 'two-page-response-state');
    expect(resultB.status(), JSON.stringify(evidence)).toBe(409);
    expect(payloadA.baseVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(payloadB.baseVersion).toBe(payloadA.baseVersion);
    await expect(inputB).toContainText(f.options.b);
    await expect(b.locator('.archive-save-error')).toContainText('本次输入已保留');
    expect(formal.employeeProfile.education).toBe(f.options.a);
    await b.locator('.archive-save-error').scrollIntoViewIfNeeded();
    await snapshot(second, info, 'stale-editor-input-retained');
    await info.attach('real-two-page-evidence', { contentType: 'application/json', body: JSON.stringify({
      viewport: info.project.name, twoEditorsOpenedBeforeSubmit: true, sameBaseVersion: true,
      aSubmit: 200, bSubmit: 409, bInputRetained: true, formalEducationIsA: true,
    }) });
  } finally {
    await second.close();
    await page.close();
    removeFixture(f);
  }
});

test('revoked maintenance capability denies existing page and unchanged token history/export with 403', async ({ page }, info) => {
  const f = createFixture();
  try {
    const drawer = await openEditor(page, f);
    const education = drawer.locator('[data-archive-field="profile.education"] .el-select');
    const saved = page.waitForResponse(response => response.request().method() === 'PATCH'
      && response.url().endsWith(`/employee-archives/${f.employee.id}/draft/save`));
    await selectEducation(page, drawer, f.options.revoked);
    expect((await saved).status()).toBe(200);
    await expect(drawer.locator('.archive-footer-state')).toContainText('草稿已保存');
    const before = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
    expect(Array.isArray(before.changeHistory)).toBe(true);
    const exportPath = `/users/export?columns=name,employeeNo&keyword=${encodeURIComponent(f.prefix)}`;
    expect((await request(page, f, 'GET', exportPath)).status()).toBe(200);
    const revoked = fixtureQuery(`
      const result = await prisma.user.updateMany({ where: { id: '${f.operatorId}', employeeNo: '${f.prefix}_HR',
        sysRole: 'hr_user', hrCapabilities: { equals: ['employee_archive_edit'] } }, data: { hrCapabilities: [] } });
      console.log(JSON.stringify({ count: result.count }));
    `);
    expect(revoked.count).toBe(1);
    const submission = submitted(page, f);
    await drawer.getByRole('button', { name: '提交', exact: true }).click();
    expect((await submission).status()).toBe(403);
    await expect(education).toContainText(f.options.revoked);
    await expect(drawer.locator('.archive-save-error')).toContainText('没有修改该档案的权限');
    await expect(drawer.locator('.archive-save-error')).toContainText('本次输入已保留');
    // History is returned by the archive endpoint; there is no separate /history route.
    await api(page, f, 'GET', `/employee-archives/${f.employee.id}`, undefined, 403);
    await api(page, f, 'GET', exportPath, undefined, 403);
    const persisted = fixtureQuery(`
      const profile = await prisma.employeeProfile.findUniqueOrThrow({ where: { userId: '${f.employee.id}' }, select: { education: true } });
      console.log(JSON.stringify(profile));
    `);
    expect(persisted.education).toBe('虚构原学历');
    await drawer.locator('.archive-save-error').scrollIntoViewIfNeeded();
    await snapshot(page, info, 'revoked-editor-input-retained');
    await info.attach('real-revocation-evidence', { contentType: 'application/json', body: JSON.stringify({
      viewport: info.project.name, samePageAndToken: true, beforeHistory: 200, beforeExport: 200,
      afterPageSubmit: 403, afterHistory: 403, afterExport: 403, inputRetained: true, formalUnchanged: true,
    }) });
  } finally {
    await page.close();
    removeFixture(f);
  }
});

test('HTTP permission matrix: edit-only can edit but cannot review or confirm arrival', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Backend permission matrix runs once; this is HTTP/database evidence, not review/arrival UI evidence.');
  const f = createFixture();
  try {
    const before = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
    await api(page, f, 'PATCH', `/employee-archives/${f.employee.id}/draft`, {
      baseVersion: before.archiveVersion, employee: {}, profile: { education: f.options.edit },
    });
    expect((await api(page, f, 'GET', `/employee-archives/${f.employee.id}`)).employeeProfile.education).toBe(f.options.edit);
    const review = await api(page, f, 'POST', `/employee-archives/${f.employee.id}/employments`, {
      effectiveFrom: '2026-11-13', company: 'fuede', deptId: f.departmentId, employmentType: 'full_time',
      employeeStatus: 'resigned', entryDate: '2025-01-01', leaveDate: '2026-11-12', changeType: 'resignation', reason: '虚构权限核验离职',
    }, 201);
    expect(review.profileReviewStatus).toBe('pending');
    await api(page, f, 'POST', '/employee-archives/reviews/approve', { requestIds: [review.id], scopes: ['profile'] }, 403);
    const pending = fixtureQuery(`
      const request = await prisma.$transaction(async tx => {
        const request = await tx.employeeDataChangeRequest.create({ data: {
          userId: '${f.arrivalId}', employeeNo: '${f.prefix}_M2', employeeName: '虚构到岗人员${f.prefix}',
          sourceType: 'manual_employee_create', intakeType: 'new_hire', onboardingStatus: 'pending_entry',
          requiresArrivalConfirmation: true, recordStatus: 'submitted', profileReviewStatus: 'approved', performanceReviewStatus: 'approved',
          createdById: '${f.operatorId}', proposedValue: { employee: { name: '虚构到岗人员${f.prefix}', company: 'fuede',
            deptId: '${f.departmentId}', positionId: '${f.positionId}', employeeStatus: 'probation', employmentType: 'full_time',
            employeeNo: '${f.prefix}_M2', entryDate: '2025-01-01', effectiveDate: '2025-01-01', managerId: '${f.managerId}' },
            profile: {}, performance: { managerId: '${f.managerId}' } },
        } });
        await tx.user.update({ where: { id: '${f.arrivalId}', employeeNo: '${f.prefix}_M2' }, data: { status: 'pending_entry' } });
        await tx.employmentRecord.create({ data: { userId: '${f.arrivalId}', sourceRequestId: request.id, sourceType: 'manual_employee_create',
          effectiveFrom: new Date('2025-01-01T00:00:00Z'), entryDate: new Date('2025-01-01T00:00:00Z'), company: 'fuede',
          deptId: '${f.departmentId}', employeeStatus: 'probation', employeeNo: '${f.prefix}_M2', changeType: 'onboarding' } });
        await tx.employeeNumberAssignment.create({ data: { userId: '${f.arrivalId}', employeeNo: '${f.prefix}_M2',
          status: 'reserved', effectiveFrom: new Date('2025-01-01T00:00:00Z'), sourceRequestId: request.id } });
        return { id: request.id, requestVersion: request.requestVersion };
      }); console.log(JSON.stringify(request));
    `);
    await api(page, f, 'POST', `/employee-archives/applications/${pending.id}/confirm-arrival`, {
      requestVersion: pending.requestVersion, arrivalDate: '2025-01-01',
    }, 403);
    const state = fixtureQuery(`
      const operator = await prisma.user.findUniqueOrThrow({ where: { id: '${f.operatorId}' }, select: { sysRole: true, hrCapabilities: true } });
      const review = await prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: '${review.id}' }, select: { profileReviewStatus: true, appliedAt: true } });
      const arrival = await prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: '${pending.id}' }, select: { onboardingStatus: true, arrivalConfirmedAt: true, requestVersion: true } });
      const employee = await prisma.user.findUniqueOrThrow({ where: { id: '${f.employee.id}' }, select: { status: true } });
      const pendingUser = await prisma.user.findUniqueOrThrow({ where: { id: '${f.arrivalId}' }, select: { status: true } });
      console.log(JSON.stringify({ operator, review, arrival, employee, pendingUser }));
    `);
    expect(state).toEqual({ operator: { sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] },
      review: { profileReviewStatus: 'pending', appliedAt: null },
      arrival: { onboardingStatus: 'pending_entry', arrivalConfirmedAt: null, requestVersion: pending.requestVersion },
      employee: { status: 'active' }, pendingUser: { status: 'pending_entry' } });
    await info.attach('real-http-permission-matrix', { contentType: 'application/json', body: JSON.stringify({
      evidenceLayer: 'real HTTP and isolated database, desktop once', edit: 200, review: 403, arrival: 403,
      rejectedActionsDidNotChangeState: true, reviewAndArrivalUIExercised: false,
    }) });
  } finally { removeFixture(f); }
});

test('N08 HTTP simultaneous same-base submissions commit exactly one winner and one audit', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Real HTTP/database concurrency runs once; this is not simultaneous UI submission evidence.');
  const f = createFixture();
  try {
    const before = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
    const values = [f.options.concurrentA, f.options.concurrentB];
    const responses = await Promise.all(values.map(education => request(page, f, 'PATCH',
      `/employee-archives/${f.employee.id}/draft`, { baseVersion: before.archiveVersion, employee: {}, profile: { education } })));
    const statuses = responses.map(response => response.status());
    const formal = await api(page, f, 'GET', `/employee-archives/${f.employee.id}`);
    const auditState = fixtureQuery(`
      const events = await prisma.auditLog.findMany({ where: { entityType: 'user', entityId: '${f.employee.id}',
        action: 'employee_profile_direct_update' }, select: { userId: true, oldValue: true, newValue: true } });
      const requestCount = await prisma.employeeDataChangeRequest.count({ where: { userId: '${f.employee.id}' } });
      console.log(JSON.stringify({ requestCount, events: events.map(event => ({ actorId: event.userId,
        beforeEducation: event.oldValue?.education, afterEducation: event.newValue?.education })) }));
    `);
    const evidence = { evidenceLayer: 'real simultaneous HTTP and isolated database, desktop once', statuses,
      versionAdvanced: formal.archiveVersion !== before.archiveVersion,
      finalEducation: formal.employeeProfile.education, directAuditCount: auditState.events.length,
      requestCount: auditState.requestCount };
    await info.attach('same-base-concurrent-http', { contentType: 'application/json', body: JSON.stringify(evidence, null, 2) });
    expect([...statuses].sort(), JSON.stringify(evidence)).toEqual([200, 409]);
    const winner = statuses.indexOf(200);
    expect(formal.employeeProfile.education).toBe(values[winner]);
    expect(formal.archiveVersion).not.toBe(before.archiveVersion);
    expect(auditState).toEqual({ requestCount: 0, events: [{ actorId: f.operatorId,
      beforeEducation: '虚构原学历', afterEducation: values[winner] }] });
    // Retrying the loser remains stale; a current same-value submit remains a no-op.
    await api(page, f, 'PATCH', `/employee-archives/${f.employee.id}/draft`, {
      baseVersion: before.archiveVersion, employee: {}, profile: { education: values[1 - winner] },
    }, 409);
    await api(page, f, 'PATCH', `/employee-archives/${f.employee.id}/draft`, {
      baseVersion: formal.archiveVersion, employee: {}, profile: { education: values[winner] },
    }, 400);
    expect((await api(page, f, 'GET', `/employee-archives/${f.employee.id}`)).archiveVersion).toBe(formal.archiveVersion);
    const finalAudit = fixtureQuery(`
      const count = await prisma.auditLog.count({ where: { entityType: 'user', entityId: '${f.employee.id}', action: 'employee_profile_direct_update' } });
      console.log(JSON.stringify({ count }));
    `);
    expect(finalAudit.count).toBe(1);
  } finally { removeFixture(f); }
});
