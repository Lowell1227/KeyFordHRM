import { test as base, expect, type APIRequestContext, type APIResponse, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const origin = 'http://localhost:5173';
const actorKeys = ['owner', 'otherHr', 'employee', 'otherEmployee', 'manager', 'otherManager',
  'hrAdmin', 'systemAdmin', 'historicalHr'] as const;
type ActorKey = typeof actorKeys[number];
type Actor = { id: string; employeeNo: string; name: string };
type Manifest = {
  prefix: string; departmentId: string; companyId: string; actors: Record<ActorKey, Actor>;
  cycleId: string; taskId: string; periodId: string; versionId: string; itemId: string;
  probationIds: [string, string, string]; applicationId: string; attachmentId: string; objectKey: string;
};
type AuditFixture = { f: Manifest; tokens: Record<ActorKey, string> };
type ProbationPage = { total: number; page: number; pageSize: number;
  items: Array<{ id: string; employee: { id: string }; manager: { id: string } }> };
type MonthlyState = {
  period: { status: string; draftVersion: number; employeeSubmittedAt: string | null;
    managerSubmittedAt: string | null; lockedAt: string | null; selfScoreTotal: string | null;
    managerScoreTotal: string | null };
  task: { status: string }; grade: { calculatedScore: string | null };
  reviews: Array<{ selfScore: string | null; managerScore: string | null; employeeComment: string | null }>;
  revisionCount: number; flowCount: number; auditCount: number; notificationCount: number;
};

// Tokens travel only through captured pipes into test-local variables, never logs or artifacts.
function dockerJson<T>(label: string, source: string): T {
  try {
    return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
      encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'],
      input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
        const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();
        (async () => {
          const [database] = await prisma.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
          if (database.db !== 'hrm_preview' || database.role !== 'hrm_preview') throw new Error('Wrong database');
          if (!await prisma.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Uninitialized preview');
          const result = await (async () => { ${source} })();
          process.stdout.write(JSON.stringify(result));
        })().finally(() => prisma.$disconnect()).catch(() => { process.exitCode = 1; });`,
    })) as T;
  } catch {
    throw new Error(`Isolated audit fixture failed: ${label}; subprocess output withheld`);
  }
}

function assertPreview(info: TestInfo) {
  expect(info.config.globalSetup, 'Use playwright.preview.config.ts without ordinary data preparation').toBeNull();
  expect(info.project.use.baseURL).toBe(origin);
  expect(info.project.use.trace).toBe('off');
  if (process.env.DEBUG || process.env.PWDEBUG) throw new Error('Disable debug logging before using preview credentials');
  let containers;
  try {
    containers = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1', 'hrm-web-1'], {
      encoding: 'utf8', timeout: 15_000, stdio: ['pipe', 'pipe', 'pipe'],
    }));
  } catch {
    throw new Error('Unable to verify isolated audit containers');
  }
  const [api, web] = containers;
  for (const container of [api, web]) {
    expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
    expect(container.State.Running).toBe(true);
  }
  expect(api.Config.Labels['com.docker.compose.service']).toBe('api');
  expect(web.Config.Labels['com.docker.compose.service']).toBe('web');
  expect(Object.keys(api.NetworkSettings.Networks)).toEqual(['hrm_internal']);
  expect(Object.values(api.NetworkSettings.Ports ?? {}).every(value => value === null)).toBe(true);
  expect(web.NetworkSettings.Ports['5173/tcp']).toEqual([{ HostIp: '127.0.0.1', HostPort: '5173' }]);
  const webEnv = Object.fromEntries(web.Config.Env.map((line: string) => {
    const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
  }));
  expect(webEnv.VITE_PREVIEW_MODE).toBe('true');
  expect(webEnv.VITE_DEV_PROXY_TARGET).toBe('http://api:3000');
  dockerJson('guard', 'return { isolated: true };');
}

function manifest(): Manifest {
  const prefix = `AUDIT_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const actors = Object.fromEntries(actorKeys.map((key, index) => [key, {
    id: randomUUID(), employeeNo: `${prefix}_${index}`, name: `${prefix} ${key}`,
  }])) as Record<ActorKey, Actor>;
  const attachmentId = randomUUID();
  return { prefix, actors, departmentId: randomUUID(), companyId: randomUUID(), cycleId: randomUUID(), taskId: randomUUID(),
    periodId: randomUUID(), versionId: randomUUID(), itemId: randomUUID(),
    probationIds: [randomUUID(), randomUUID(), randomUUID()], applicationId: randomUUID(), attachmentId,
    objectKey: `confirmation-internal/${prefix}/${attachmentId}-audit.png` };
}

function createActors(f: Manifest): Record<ActorKey, string> {
  return dockerJson('create actors', `
    const f = ${JSON.stringify(f)};
    const roles = { owner: 'hr_user', otherHr: 'hr_user', hrAdmin: 'hr', systemAdmin: 'system_admin', historicalHr: 'hr_user' };
    await prisma.$transaction(async tx => {
      await tx.contractSubject.create({ data: { id: f.companyId, name: f.prefix + ' company', internalCompany: 'fuede' } });
      await tx.department.create({ data: { id: f.departmentId, name: f.prefix, company: 'fuede' } });
      for (const [key, actor] of Object.entries(f.actors)) {
        await tx.user.create({ data: { ...actor, deptId: f.departmentId, status: 'active', accountType: 'employee',
          sysRole: roles[key] || 'employee', canViewAll: key === 'otherHr',
          hrCapabilities: ['owner', 'otherHr'].includes(key) ? ['cycle_plan_edit'] : key === 'historicalHr' ? ['confirmation_manage'] : [],
          employmentHistory: { create: { effectiveFrom: new Date('2020-01-01T00:00:00Z'),
            entryDate: new Date('2020-01-01T00:00:00Z'), company: 'fuede', contractSubjectId: f.companyId, deptId: f.departmentId,
            employeeStatus: 'active', employeeNo: actor.employeeNo, changeType: 'onboarding', sourceType: 'preview_fixture' } } } });
      }
    });
    const { JwtService } = require('@nestjs/jwt');
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    return Object.fromEntries(Object.entries(f.actors).map(([key, actor]) => [key,
      jwt.sign({ sub: actor.id, employeeNo: actor.employeeNo, sysRole: roles[key] || 'employee',
        hrCapabilities: key === 'historicalHr' ? ['confirmation_manage'] : [] }, { expiresIn: '15m' })]));
  `);
}

function ownedQuery<T>(f: Manifest, label: string, source: string): T {
  return dockerJson<T>(label, `
    const f = ${JSON.stringify(f)};
    const ids = Object.values(f.actors).map(actor => actor.id);
    const dept = await prisma.department.findUnique({ where: { id: f.departmentId } });
    if (!dept || dept.name !== f.prefix) throw new Error('Foreign department');
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, employeeNo: true, deptId: true } });
    if (users.length !== ids.length || users.some(user => user.deptId !== f.departmentId
      || !Object.values(f.actors).some(actor => actor.id === user.id && actor.employeeNo === user.employeeNo))) throw new Error('Foreign actor');
    ${source}
  `);
}

const minioClientSource = `const storage = new (require('minio').Client)({
  endPoint: process.env.MINIO_ENDPOINT, port: Number(process.env.MINIO_PORT), useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY,
});`;

function removeFixture(f: Manifest) {
  const exists = dockerJson<boolean>('cleanup preflight', `
    return Boolean(await prisma.department.findUnique({ where: { id: '${f.departmentId}' } }));
  `);
  if (!exists) return;
  const result = ownedQuery<{ remaining: number }>(f, 'cleanup', `
    const attachments = await prisma.confirmationMeetingAttachment.findMany({ where: { applicationId: f.applicationId } });
    if (attachments.some(a => a.id !== f.attachmentId || a.objectKey !== f.objectKey || a.uploadedById !== f.actors.historicalHr.id)) throw new Error('Foreign attachment');
    if (attachments.length) {
      ${minioClientSource}
      await storage.removeObject(process.env.MINIO_BUCKET, f.objectKey);
    }
    await prisma.$transaction(async tx => {
      await tx.confirmationMeetingAttachment.deleteMany({ where: { id: f.attachmentId, applicationId: f.applicationId, objectKey: f.objectKey } });
      await tx.confirmationApplication.deleteMany({ where: { id: f.applicationId, employeeId: f.actors.employee.id, createdBy: f.actors.employee.id } });
      await tx.probationReview.deleteMany({ where: { id: { in: f.probationIds }, employeeId: { in: ids }, managerId: { in: ids }, createdBy: f.actors.hrAdmin.id } });
      await tx.notificationLog.deleteMany({ where: { userId: { in: ids } } });
      await tx.assessmentPeriod.deleteMany({ where: { id: f.periodId, taskId: f.taskId } });
      await tx.indicatorVersion.deleteMany({ where: { id: f.versionId, taskId: f.taskId } });
      await tx.assessmentTask.deleteMany({ where: { id: f.taskId, cycleId: f.cycleId, employeeId: f.actors.employee.id } });
      await tx.assessmentCycle.deleteMany({ where: { id: f.cycleId, name: f.prefix, createdBy: f.actors.otherHr.id } });
      await tx.auditLog.deleteMany({ where: { userId: { in: ids } } });
      await tx.employmentRecord.deleteMany({ where: { userId: { in: ids }, sourceType: 'preview_fixture' } });
      await tx.user.deleteMany({ where: { id: { in: ids }, deptId: f.departmentId, employeeNo: { startsWith: f.prefix + '_' } } });
      await tx.department.delete({ where: { id: f.departmentId, name: f.prefix } });
      await tx.contractSubject.delete({ where: { id: f.companyId, name: f.prefix + ' company' } });
    });
    return { remaining: await prisma.user.count({ where: { id: { in: ids } } }) };
  `);
  expect(result.remaining).toBe(0);
}

const test = base.extend<{ audit: AuditFixture }>({
  audit: async ({}, use, info) => {
    base.skip(info.project.name !== 'desktop', 'HTTP/database permission evidence runs once, not once per viewport');
    assertPreview(info);
    const f = manifest();
    try {
      const tokens = createActors(f);
      await use({ f, tokens });
    } finally {
      removeFixture(f);
    }
  },
});
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
test.setTimeout(120_000);

async function send(request: APIRequestContext, audit: AuditFixture, actor: ActorKey,
  method: string, path: string, data?: unknown): Promise<APIResponse> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Expected preview-local API path');
  try {
    return await request.fetch(`${origin}/api/v1${path}`, {
      method, headers: { authorization: `Bearer ${audit.tokens[actor]}` },
      ...(data === undefined ? {} : { data }), maxRedirects: 0, timeout: 20_000,
    });
  } catch {
    // Playwright transport errors may contain request headers; never rethrow them.
    throw new Error(`Audit HTTP transport failed: ${method} ${path}`);
  }
}

async function api<T = unknown>(request: APIRequestContext, audit: AuditFixture, actor: ActorKey,
  method: string, path: string, status = 200, data?: unknown): Promise<T> {
  const response = await send(request, audit, actor, method, path, data);
  expect(response.status(), `${actor}: ${method} ${path}`).toBe(status);
  const body = await response.json();
  if (status === 403) expect(body.data == null || Object.keys(body.data).length === 0).toBe(true);
  return body.data as T;
}

function seedMonthly(f: Manifest) {
  ownedQuery(f, 'seed monthly', `
    const at = new Date('2027-02-04T08:00:00Z');
    await prisma.$transaction(async tx => {
      await tx.assessmentCycle.create({ data: { id: f.cycleId, name: f.prefix, type: 'quarterly',
        startDate: new Date('2027-01-01'), endDate: new Date('2027-03-31'), status: 'hr_calibration',
        scoringFrequency: 'monthly', notificationMode: 'off', createdBy: f.actors.otherHr.id, hrOwnerId: f.actors.owner.id } });
      await tx.assessmentTask.create({ data: { id: f.taskId, cycleId: f.cycleId, employeeId: f.actors.employee.id,
        managerId: f.actors.manager.id, deptId: f.departmentId, status: 'hr_calibration',
        indicatorConfirmedAt: at, selfEvalSubmittedAt: at, managerScoredAt: at, deptReviewedAt: at,
        gradeResult: { create: { calculatedScore: 90, rawGrade: 'A', calibratedGrade: 'A' } } } });
      await tx.indicatorVersion.create({ data: { id: f.versionId, taskId: f.taskId, version: 1,
        status: 'active', effectiveFromPeriodKey: '2027-01', createdById: f.actors.owner.id,
        items: { create: { id: f.itemId, name: f.prefix + ' objective', weight: 1, dimensionWeight: 1 } } } });
      await tx.assessmentPeriod.create({ data: { id: f.periodId, taskId: f.taskId, indicatorVersionId: f.versionId,
        periodKey: '2027-01', periodType: 'month', sequence: 1, periodStart: new Date('2027-01-01'),
        periodEnd: new Date('2027-01-31'), selfEvalOpenAt: new Date('2027-02-01'), selfEvalDueAt: new Date('2027-02-03'),
        managerDueAt: new Date('2027-02-08'), managerId: f.actors.manager.id, status: 'completed', draftVersion: 5,
        employeeSubmittedAt: at, managerSubmittedAt: at, lockedAt: at, selfScoreTotal: 88, managerScoreTotal: 90,
        selfGrade: 'B', managerGrade: 'A', indicatorReviews: { create: { indicatorVersionItemId: f.itemId,
          selfScore: 88, managerScore: 90, employeeComment: 'Synthetic audit employee content', managerComment: 'Synthetic manager opinion' } },
        revisions: { create: { stage: 'employee', revision: 1, idempotencyKey: f.prefix,
          createdById: f.actors.employee.id, snapshot: { marker: f.prefix, selfScore: 88 } } } } });
    });
    return { created: true };
  `);
}

function monthlyState(f: Manifest): MonthlyState {
  return ownedQuery<MonthlyState>(f, 'monthly state', `
    return {
      period: await prisma.assessmentPeriod.findUniqueOrThrow({ where: { id: f.periodId } }),
      task: await prisma.assessmentTask.findUniqueOrThrow({ where: { id: f.taskId } }),
      grade: await prisma.gradeResult.findUniqueOrThrow({ where: { taskId: f.taskId } }),
      reviews: await prisma.assessmentPeriodIndicatorReview.findMany({ where: { periodId: f.periodId } }),
      revisionCount: await prisma.assessmentPeriodReviewRevision.count({ where: { periodId: f.periodId } }),
      flowCount: await prisma.flowRecord.count({ where: { taskId: f.taskId } }),
      auditCount: await prisma.auditLog.count({ where: { entityId: f.periodId } }),
      notificationCount: await prisma.notificationLog.count({ where: { taskId: f.taskId } }),
    };
  `);
}

test('monthly reopen requires assigned hr_user and preserves CAS and denied-write boundaries', async ({ request, audit }) => {
  const { f } = audit;
  seedMonthly(f);
  const before = monthlyState(f);
  const path = `/assessment-periods/${f.periodId}/reopen`;
  const command = { expectedVersion: 5, reason: `${f.prefix} correct synthetic self-evaluation` };
  // otherHr is also the cycle creator and has canViewAll: neither grants write scope.
  await api(request, audit, 'otherHr', 'POST', path, 403, command);
  expect(monthlyState(f)).toEqual(before);
  await api(request, audit, 'owner', 'POST', path, 409, { ...command, expectedVersion: 4 });
  expect(monthlyState(f)).toEqual(before);
  const reopened = await api(request, audit, 'owner', 'POST', path, 200, command);
  expect(reopened).toMatchObject({ periodId: f.periodId, status: 'self_eval', draftVersion: 6 });
  const after = monthlyState(f);
  expect(after.period).toMatchObject({ status: 'self_eval', draftVersion: 6, employeeSubmittedAt: null,
    managerSubmittedAt: null, lockedAt: null, selfScoreTotal: null, managerScoreTotal: null });
  expect(after.task.status).toBe('self_eval');
  expect(after.grade.calculatedScore).toBeNull();
  expect(after.reviews).toEqual([expect.objectContaining({ selfScore: '88', managerScore: null,
    employeeComment: 'Synthetic audit employee content' })]);
  expect(after).toMatchObject({ revisionCount: 1, flowCount: 1, auditCount: 1, notificationCount: 1 });
  await api(request, audit, 'owner', 'POST', path, 409, { ...command, expectedVersion: 6 });
  expect(monthlyState(f)).toEqual(after);
});

function seedProbation(f: Manifest) {
  ownedQuery(f, 'seed probation', `
    await prisma.probationReview.createMany({ data: [
      { id: f.probationIds[0], employeeId: f.actors.employee.id, managerId: f.actors.manager.id, status: 'self_eval' },
      { id: f.probationIds[1], employeeId: f.actors.otherEmployee.id, managerId: f.actors.otherManager.id, status: 'self_eval' },
      { id: f.probationIds[2], employeeId: f.actors.otherEmployee.id, managerId: f.actors.manager.id, status: 'manager_scoring' },
    ].map((row, index) => ({ ...row, hrId: f.actors.hrAdmin.id, createdBy: f.actors.hrAdmin.id,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)) })) });
    return { created: true };
  `);
}

async function probation(request: APIRequestContext, audit: AuditFixture, actor: ActorKey,
  route: 'mine' | 'managed', filters: Record<string, string> = {}) {
  const query = new URLSearchParams({ keyword: audit.f.prefix, pageSize: '100', ...filters });
  return api<ProbationPage>(request, audit, actor, 'GET', `/probation-reviews/${route}?${query}`);
}

function expectRows(result: ProbationPage, ids: string[], total = ids.length) {
  expect(result.total).toBe(total);
  expect(result.items.map(item => item.id).sort()).toEqual([...ids].sort());
}

test('probation mine intersects caller identity with employee, manager, status and keyword filters', async ({ request, audit }) => {
  const { f } = audit;
  seedProbation(f);
  expectRows(await probation(request, audit, 'employee', 'mine'), [f.probationIds[0]]);
  expectRows(await probation(request, audit, 'employee', 'mine', { employeeId: f.actors.employee.id,
    managerId: f.actors.manager.id, status: 'self_eval' }), [f.probationIds[0]]);
  expectRows(await probation(request, audit, 'employee', 'mine', { employeeId: f.actors.otherEmployee.id }), []);
  expectRows(await probation(request, audit, 'employee', 'mine', { employeeId: f.actors.otherEmployee.id,
    managerId: f.actors.otherManager.id, status: 'self_eval', keyword: f.actors.otherEmployee.name }), []);
  expectRows(await probation(request, audit, 'employee', 'mine', { managerId: f.actors.otherManager.id }), []);
  expectRows(await probation(request, audit, 'employee', 'mine', { status: 'manager_scoring' }), []);
  expectRows(await probation(request, audit, 'otherEmployee', 'mine'), [f.probationIds[1], f.probationIds[2]]);
});

test('probation managed cannot replace manager scope through filters or pagination', async ({ request, audit }) => {
  const { f } = audit;
  seedProbation(f);
  expectRows(await probation(request, audit, 'manager', 'managed'), [f.probationIds[0], f.probationIds[2]]);
  expectRows(await probation(request, audit, 'manager', 'managed', { managerId: f.actors.otherManager.id }), []);
  expectRows(await probation(request, audit, 'manager', 'managed', { managerId: f.actors.otherManager.id,
    employeeId: f.actors.otherEmployee.id, keyword: f.actors.otherManager.name, status: 'self_eval' }), []);
  expectRows(await probation(request, audit, 'manager', 'managed', { employeeId: f.actors.otherEmployee.id }), [f.probationIds[2]]);
  expectRows(await probation(request, audit, 'manager', 'managed', { status: 'self_eval' }), [f.probationIds[0]]);
  expectRows(await probation(request, audit, 'manager', 'managed', { keyword: f.actors.otherManager.name }), []);
  const first = await probation(request, audit, 'manager', 'managed', { page: '1', pageSize: '1' });
  const second = await probation(request, audit, 'manager', 'managed', { page: '2', pageSize: '1' });
  expect(first).toMatchObject({ total: 2, page: 1, pageSize: 1 });
  expect(second).toMatchObject({ total: 2, page: 2, pageSize: 1 });
  expect([...first.items, ...second.items].map(item => item.id).sort()).toEqual([f.probationIds[0], f.probationIds[2]].sort());
  expectRows(await probation(request, audit, 'otherManager', 'managed'), [f.probationIds[1]]);
});

function passwordState(f: Manifest, key: ActorKey) {
  return ownedQuery<{ hasPassword: boolean; mustChangePassword: boolean; resetAudits: number }>(f, 'password state', `
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.actors.${key}.id },
      select: { passwordHash: true, mustChangePassword: true } });
    return { hasPassword: user.passwordHash !== null, mustChangePassword: user.mustChangePassword,
      resetAudits: await prisma.auditLog.count({ where: { entityId: f.actors.${key}.id, action: 'reset_password' } }) };
  `);
}

test('HR cannot reset system_admin credentials while legitimate resets still work', async ({ request, audit }) => {
  const { f } = audit;
  const before = passwordState(f, 'systemAdmin');
  expect(before).toEqual({ hasPassword: false, mustChangePassword: false, resetAudits: 0 });
  await api(request, audit, 'hrAdmin', 'PATCH', `/users/${f.actors.systemAdmin.id}/password`, 403, {});
  expect(passwordState(f, 'systemAdmin')).toEqual(before);
  expect(await api(request, audit, 'hrAdmin', 'PATCH', `/users/${f.actors.employee.id}/password`, 200, {}))
    .toEqual({ success: true });
  expect(passwordState(f, 'employee')).toEqual({ hasPassword: true, mustChangePassword: true, resetAudits: 1 });
  expect(await api(request, audit, 'systemAdmin', 'PATCH', `/users/${f.actors.systemAdmin.id}/password`, 200, {}))
    .toEqual({ success: true });
  expect(passwordState(f, 'systemAdmin')).toEqual({ hasPassword: true, mustChangePassword: true, resetAudits: 1 });
});

const attachmentBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=', 'base64');

function seedInternalAttachment(f: Manifest) {
  ownedQuery(f, 'seed confirmation attachment', `
    await prisma.$transaction(async tx => {
      await tx.confirmationApplication.create({ data: { id: f.applicationId, employeeId: f.actors.employee.id,
        managerId: f.actors.manager.id, hrId: f.actors.historicalHr.id, companyApproverId: f.actors.otherManager.id,
        createdBy: f.actors.employee.id, workflowVersion: 2, submissionVersion: 1, status: 'hr_approved',
        managerApprovedAt: new Date(), hrApprovedAt: new Date(), summary: f.prefix + ' synthetic confirmation',
        meetingAttachments: { create: { id: f.attachmentId, objectKey: f.objectKey, name: f.prefix + '.png',
          size: ${attachmentBytes.length}, mimeType: 'image/png', submissionVersion: 1, uploadedById: f.actors.historicalHr.id } } } });
    });
    ${minioClientSource}
    const content = Buffer.from('${attachmentBytes.toString('base64')}', 'base64');
    await storage.putObject(process.env.MINIO_BUCKET, f.objectKey, content, content.length, { 'Content-Type': 'image/png' });
    return { created: true };
  `);
}

function confirmationState(f: Manifest) {
  return ownedQuery(f, 'confirmation state', `
    return { application: await prisma.confirmationApplication.findUniqueOrThrow({ where: { id: f.applicationId } }),
      attachment: await prisma.confirmationMeetingAttachment.findUniqueOrThrow({ where: { id: f.attachmentId } }),
      auditCount: await prisma.auditLog.count({ where: { entityId: f.applicationId } }) };
  `);
}

test('revoked historical HR cannot download internal attachments with an already-issued token', async ({ request, audit }) => {
  const { f } = audit;
  seedInternalAttachment(f);
  const path = `/confirmation-applications/${f.applicationId}/meeting-attachments/${f.attachmentId}/download`;
  const before = confirmationState(f);
  const allowed = await send(request, audit, 'historicalHr', 'GET', path);
  expect(allowed.status()).toBe(200);
  expect(await allowed.body()).toEqual(attachmentBytes);
  const revoked = ownedQuery<{ count: number }>(f, 'revoke synthetic HR capability', `
    return await prisma.user.updateMany({ where: { id: f.actors.historicalHr.id,
      employeeNo: f.actors.historicalHr.employeeNo, deptId: f.departmentId, sysRole: 'hr_user',
      hrCapabilities: { equals: ['confirmation_manage'] } }, data: { hrCapabilities: [] } });
  `);
  expect(revoked.count).toBe(1);
  // Keep hrId/uploader links and the original JWT: current permissions must win over historical identity.
  await api(request, audit, 'historicalHr', 'GET', path, 403);
  await api(request, audit, 'employee', 'GET', path, 403);
  await api(request, audit, 'historicalHr', 'GET', `/storage/download?key=${encodeURIComponent(f.objectKey)}`, 403);
  const stillAllowed = await send(request, audit, 'hrAdmin', 'GET', path);
  expect(stillAllowed.status()).toBe(200);
  expect(await stillAllowed.body()).toEqual(attachmentBytes);
  expect(confirmationState(f)).toEqual(before);
});
