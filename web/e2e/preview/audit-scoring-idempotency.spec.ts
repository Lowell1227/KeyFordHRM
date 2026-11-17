import { test as base, expect, type APIRequestContext, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const origin = 'http://localhost:5173';
const actorKeys = ['employee', 'manager', 'outsider', 'hr'] as const;
type ActorKey = typeof actorKeys[number];
type Actor = { id: string; employeeNo: string; name: string };
type Manifest = {
  prefix: string; departmentId: string; actors: Record<ActorKey, Actor>;
  cycleId: string; taskId: string; historyCycleId: string; historyTaskId: string;
  periodIds: [string, string]; versionId: string; itemIds: string[]; sourceIds: string[];
};
type AuditFixture = { f: Manifest; tokens: Record<ActorKey, string> };
type Row = { id: string; [key: string]: unknown };
type StoredState = {
  cycles: Row[]; tasks: Row[]; periods: Row[]; reviews: Row[]; revisions: Row[];
  indicators: Row[]; progress: Row[]; grades: Row[]; flows: Row[]; audits: Row[]; notifications: Row[];
};
type ActionResult = { periodId: string; status: string; draftVersion: number; savedAt: string };
type TaskDetail = {
  id: string; updatedAt: string; status: string;
  indicatorInstances: Array<{ id: string; name: string; indicatorType: string }>;
  gradeResult: { calculatedScore: number | null; rawGrade: string; calibratedGrade: string | null } | null;
};

// JWTs stay in captured pipes and test-local memory. Never include subprocess output in errors.
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
    throw new Error(`Isolated scoring/idempotency fixture failed: ${label}; subprocess output withheld`);
  }
}

function assertPreview(info: TestInfo) {
  expect(info.config.globalSetup, 'Use playwright.preview.config.ts without ordinary data preparation').toBeNull();
  expect(info.project.use.baseURL).toBe(origin);
  expect(info.project.use.trace).toBe('off');
  expect(info.project.use.video).toBe('off');
  if (process.env.DEBUG || process.env.PWDEBUG) throw new Error('Disable debug logging before using preview credentials');
  let containers;
  try {
    containers = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1', 'hrm-web-1'], {
      encoding: 'utf8', timeout: 15_000, stdio: ['pipe', 'pipe', 'pipe'],
    }));
  } catch {
    throw new Error('Unable to verify isolated preview containers');
  }
  const [api, web] = containers;
  for (const container of containers) {
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
  const prefix = `AUDIT_SI_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const actors = Object.fromEntries(actorKeys.map((key, index) => [key, {
    id: randomUUID(), employeeNo: `${prefix}_${index}`, name: `${prefix} ${key}`,
  }])) as Record<ActorKey, Actor>;
  return { prefix, actors, departmentId: randomUUID(), cycleId: randomUUID(), taskId: randomUUID(),
    historyCycleId: randomUUID(), historyTaskId: randomUUID(), periodIds: [randomUUID(), randomUUID()],
    versionId: randomUUID(), itemIds: [randomUUID(), randomUUID()],
    sourceIds: Array.from({ length: 5 }, () => randomUUID()) };
}

function createActors(f: Manifest): Record<ActorKey, string> {
  return dockerJson('create actors', `
    const f = ${JSON.stringify(f)};
    await prisma.$transaction(async tx => {
      await tx.department.create({ data: { id: f.departmentId, name: f.prefix, company: 'fuede' } });
      for (const [key, actor] of Object.entries(f.actors)) {
        await tx.user.create({ data: { ...actor, deptId: f.departmentId, status: 'active', accountType: 'employee',
          sysRole: key === 'hr' ? 'hr_user' : 'employee', hrCapabilities: key === 'hr' ? ['cycle_plan_edit'] : [],
          employmentHistory: { create: { effectiveFrom: new Date('2020-01-01T00:00:00Z'),
            entryDate: new Date('2020-01-01T00:00:00Z'), company: 'fuede', deptId: f.departmentId,
            employeeStatus: 'active', employeeNo: actor.employeeNo, changeType: 'onboarding', sourceType: 'preview_fixture' } } } });
      }
    });
    const { JwtService } = require('@nestjs/jwt');
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    return Object.fromEntries(Object.entries(f.actors).map(([key, actor]) => [key,
      jwt.sign({ sub: actor.id, employeeNo: actor.employeeNo, sysRole: key === 'hr' ? 'hr_user' : 'employee' },
        { expiresIn: '15m' })]));
  `);
}

function ownedQuery<T>(f: Manifest, label: string, source: string): T {
  return dockerJson<T>(label, `
    const f = ${JSON.stringify(f)};
    const ids = Object.values(f.actors).map(actor => actor.id);
    const taskIds = [f.taskId, f.historyTaskId], cycleIds = [f.cycleId, f.historyCycleId];
    const dept = await prisma.department.findUnique({ where: { id: f.departmentId } });
    if (!dept || dept.name !== f.prefix) throw new Error('Foreign department');
    const users = await prisma.user.findMany({ where: { OR: [{ id: { in: ids } }, { deptId: f.departmentId }] },
      select: { id: true, employeeNo: true, deptId: true, dingtalkId: true, dingtalkUnionId: true } });
    if (users.length !== ids.length || users.some(user => user.deptId !== f.departmentId || user.dingtalkId || user.dingtalkUnionId
      || !Object.values(f.actors).some(actor => actor.id === user.id && actor.employeeNo === user.employeeNo))) throw new Error('Foreign actor');
    const cycles = await prisma.assessmentCycle.findMany({ where: { id: { in: cycleIds } }, orderBy: { id: 'asc' } });
    if (cycles.some(cycle => cycle.name !== f.prefix + (cycle.id === f.historyCycleId ? '_history' : '')
      || cycle.createdBy !== f.actors.hr.id)) throw new Error('Foreign cycle');
    const tasks = await prisma.assessmentTask.findMany({ where: { OR: [{ id: { in: taskIds } }, { cycleId: { in: cycleIds } }] }, orderBy: { id: 'asc' } });
    if (tasks.some(task => !taskIds.includes(task.id) || task.employeeId !== f.actors.employee.id || task.deptId !== f.departmentId
      || task.cycleId !== (task.id === f.historyTaskId ? f.historyCycleId : f.cycleId))) throw new Error('Foreign task');
    ${source}
  `);
}

function removeFixture(f: Manifest) {
  if (!dockerJson<boolean>('cleanup preflight', `return Boolean(await prisma.department.findUnique({ where: { id: '${f.departmentId}' } }));`)) return;
  const remaining = ownedQuery<number>(f, 'cleanup', `
    await prisma.$transaction(async tx => {
      await tx.notificationLog.deleteMany({ where: { userId: { in: ids } } });
      await tx.assessmentPeriod.deleteMany({ where: { taskId: { in: taskIds } } });
      await tx.indicatorVersion.deleteMany({ where: { taskId: { in: taskIds } } });
      await tx.assessmentTask.deleteMany({ where: { id: { in: taskIds }, employeeId: f.actors.employee.id } });
      await tx.assessmentCycle.deleteMany({ where: { id: { in: cycleIds }, createdBy: f.actors.hr.id } });
      await tx.auditLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { entityId: { in: [...taskIds, ...cycleIds, ...f.periodIds] } }] } });
      await tx.employmentRecord.deleteMany({ where: { userId: { in: ids }, sourceType: 'preview_fixture' } });
      await tx.user.deleteMany({ where: { id: { in: ids }, deptId: f.departmentId, employeeNo: { startsWith: f.prefix + '_' } } });
      await tx.department.delete({ where: { id: f.departmentId, name: f.prefix } });
    });
    return await prisma.user.count({ where: { id: { in: ids } } })
      + await prisma.assessmentTask.count({ where: { id: { in: taskIds } } })
      + await prisma.assessmentCycle.count({ where: { id: { in: cycleIds } } })
      + await prisma.assessmentPeriodReviewRevision.count({ where: { periodId: { in: f.periodIds } } })
      + await prisma.notificationLog.count({ where: { userId: { in: ids } } })
      + await prisma.auditLog.count({ where: { userId: { in: ids } } });
  `);
  expect(remaining, 'All owned fixture records are removed').toBe(0);
}

const test = base.extend<{ audit: AuditFixture }>({
  audit: async ({}, use, info) => {
    base.skip(info.project.name !== 'desktop', 'HTTP/database evidence only; mobile explicitly skipped, no viewport/UI claim');
    assertPreview(info);
    const f = manifest();
    try {
      await use({ f, tokens: createActors(f) });
    } finally {
      removeFixture(f);
    }
  },
});
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
test.setTimeout(180_000);

async function api<T = ActionResult>(request: APIRequestContext, audit: AuditFixture, actor: ActorKey,
  method: string, path: string, status = 200, data?: unknown): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Expected preview-local API path');
  let response;
  try {
    response = await request.fetch(`${origin}/api/v1${path}`, {
      method, headers: { authorization: `Bearer ${audit.tokens[actor]}` },
      ...(data === undefined ? {} : { data }), maxRedirects: 0, timeout: 20_000,
    });
  } catch {
    throw new Error(`Audit HTTP transport failed: ${method} ${path}`);
  }
  expect(response.status(), `${actor}: ${method} ${path}`).toBe(status);
  const body = await response.json();
  if (status === 403 || status === 409) expect(body.data == null || Object.keys(body.data).length === 0).toBe(true);
  return body.data as T;
}

function state(f: Manifest): StoredState {
  return ownedQuery<StoredState>(f, 'read state', `
    const orderBy = { id: 'asc' };
    return {
      cycles, tasks,
      periods: await prisma.assessmentPeriod.findMany({ where: { taskId: { in: taskIds } }, orderBy }),
      reviews: await prisma.assessmentPeriodIndicatorReview.findMany({ where: { periodId: { in: f.periodIds } }, orderBy }),
      revisions: await prisma.assessmentPeriodReviewRevision.findMany({ where: { periodId: { in: f.periodIds } }, orderBy }),
      indicators: await prisma.indicatorInstance.findMany({ where: { taskId: { in: taskIds } }, orderBy }),
      progress: await prisma.indicatorProgressUpdate.findMany({ where: { createdBy: { in: ids } }, orderBy }),
      grades: await prisma.gradeResult.findMany({ where: { taskId: { in: taskIds } }, orderBy }),
      flows: await prisma.flowRecord.findMany({ where: { taskId: { in: taskIds } }, orderBy }),
      audits: await prisma.auditLog.findMany({ where: { OR: [{ userId: { in: ids } }, { entityId: { in: [...taskIds, ...f.periodIds] } }] }, orderBy }),
      notifications: await prisma.notificationLog.findMany({ where: { userId: { in: ids } }, orderBy }),
    };
  `);
}

// Historical grades are deliberately different from freshly calculated scores, never repaired by this suite.
function seed(f: Manifest, mode: 'monthly' | 'legacy', legacyIndicators?: Array<{ name: string; indicatorType: string; weight: number }>) {
  ownedQuery(f, 'seed workflow', `
    const mode = ${JSON.stringify(mode)}, indicators = ${JSON.stringify(legacyIndicators ?? [])};
    const at = new Date('2025-04-04T08:00:00Z');
    await prisma.$transaction(async tx => {
      await tx.assessmentCycle.create({ data: { id: f.cycleId, name: f.prefix, type: 'quarterly',
        startDate: new Date('2090-01-01'), endDate: new Date('2090-03-31'), status: mode === 'monthly' ? 'self_eval' : 'manager_score',
        workflowVersion: mode === 'monthly' ? 2 : 1, goalWorkflowVersion: 1,
        scoringFrequency: mode === 'monthly' ? 'monthly' : 'cycle',
        // Keep in-app notifications observable; the mandatory preview guard disables external delivery.
        notificationMode: 'launch_only', createdBy: f.actors.hr.id, hrOwnerId: f.actors.hr.id } });
      await tx.assessmentTask.create({ data: { id: f.taskId, cycleId: f.cycleId, employeeId: f.actors.employee.id,
        managerId: f.actors.manager.id, deptHeadId: f.actors.outsider.id, deptId: f.departmentId,
        status: mode === 'monthly' ? 'self_eval' : 'manager_scoring', indicatorConfirmedAt: at,
        selfEvalSubmittedAt: mode === 'legacy' ? at : null } });
      await tx.assessmentCycle.create({ data: { id: f.historyCycleId, name: f.prefix + '_history', type: 'quarterly',
        startDate: new Date('2025-01-01'), endDate: new Date('2025-03-31'), status: 'closed',
        notificationMode: 'off', createdBy: f.actors.hr.id, hrOwnerId: f.actors.hr.id, publishedAt: at, closedAt: at } });
      await tx.assessmentTask.create({ data: { id: f.historyTaskId, cycleId: f.historyCycleId,
        employeeId: f.actors.employee.id, managerId: f.actors.manager.id, deptId: f.departmentId, status: 'closed',
        publishedAt: at, closedAt: at, gradeResult: { create: { calculatedScore: -40, rawGrade: 'D', calibratedGrade: 'C',
          calibrationNote: f.prefix + ' historical sentinel', isPublished: true, publishedAt: at, approvedAt: at } },
        indicatorInstances: { create: { name: f.prefix + ' historical KPI', indicatorType: 'kpi', weight: 1,
          dimensionWeight: 1, managerScore: 80, finalScore: 80 } } } });
      if (mode === 'legacy') {
        await tx.indicatorInstance.createMany({ data: indicators.map((item, index) => ({ ...item, id: f.sourceIds[index],
          taskId: f.taskId, dimensionName: f.prefix + ' dimension', dimensionWeight: 1, sortOrder: index,
          ...(item.indicatorType === 'veto' ? { managerScore: 100, finalScore: 100 } : {}) })) });
      } else {
        await tx.indicatorInstance.createMany({ data: f.itemIds.map((_, index) => ({ id: f.sourceIds[index],
          taskId: f.taskId, name: f.prefix + ' objective ' + index, indicatorType: 'kpi', weight: 0.5, dimensionWeight: 1 })) });
        await tx.indicatorVersion.create({ data: { id: f.versionId, taskId: f.taskId, version: 1, status: 'active',
          effectiveFromPeriodKey: '2090-01', createdById: f.actors.hr.id, items: { create: f.itemIds.map((id, index) => ({
            id, sourceInstanceId: f.sourceIds[index], name: f.prefix + ' objective ' + index,
            indicatorType: 'kpi', weight: 0.5, dimensionWeight: 1, sortOrder: index })) } } });
        for (const [index, id] of f.periodIds.entries()) {
          await tx.assessmentPeriod.create({ data: { id, taskId: f.taskId, indicatorVersionId: f.versionId,
            periodKey: '2090-0' + (index + 1), periodType: 'month', sequence: index + 1,
            periodStart: new Date(Date.UTC(2090, index, 1)), periodEnd: new Date(Date.UTC(2090, index + 1, 0)),
            selfEvalOpenAt: new Date('2091-01-01'), selfEvalDueAt: new Date('2091-01-03'), managerDueAt: new Date('2091-01-08'),
            managerId: f.actors.manager.id, status: 'self_eval', draftVersion: 0 } });
        }
      }
    });
    return { created: true };
  `);
}

function employeeCommand(f: Manifest, expectedVersion = 0) {
  return { expectedVersion, idempotencyKey: randomUUID(), selfGrade: 'B', indicators: f.itemIds.map(id => ({
    indicatorVersionItemId: id, selfScore: 80, progress: 75, healthStatus: 'on_track', employeeComment: f.prefix + ' employee evidence',
  })) };
}

function managerCommand(f: Manifest, expectedVersion = 1) {
  return { expectedVersion, idempotencyKey: randomUUID(), managerGrade: 'B', indicators: f.itemIds.map(id => ({
    indicatorVersionItemId: id, managerScore: 80, managerComment: f.prefix + ' manager evidence',
  })) };
}

const route = (f: Manifest, action: string, index = 0) => `/assessment-periods/${f.periodIds[index]}/${action}`;

async function replay(request: APIRequestContext, audit: AuditFixture, actor: ActorKey,
  path: string, data: unknown, original: ActionResult) {
  const before = state(audit.f);
  expect(await api(request, audit, actor, 'POST', path, 200, data)).toEqual(original);
  expect(state(audit.f), 'Exact retry must not mutate any stored result or duplicate side effects').toEqual(before);
}

async function denied(request: APIRequestContext, audit: AuditFixture, actor: ActorKey,
  path: string, data: unknown, status: 403 | 409) {
  const before = state(audit.f);
  await api(request, audit, actor, 'POST', path, status, data);
  expect(state(audit.f), 'Rejected key reuse must not write either period, results, logs or notifications').toEqual(before);
}

function expectEffects(s: StoredState, f: Manifest, counts: { revisions: number; flows: number; audits: number; notifications: number; progress: number }) {
  for (const [key, count] of Object.entries(counts)) expect(s[key as keyof typeof counts], key).toHaveLength(count);
  for (const notification of s.notifications) {
    expect(notification).toMatchObject({ channel: 'system', status: 'sent', taskId: f.taskId, cycleId: f.cycleId });
    expect([f.actors.employee.id, f.actors.manager.id]).toContain(notification.userId);
  }
}

function history(s: StoredState, f: Manifest) {
  return { cycle: s.cycles.find(row => row.id === f.historyCycleId), task: s.tasks.find(row => row.id === f.historyTaskId),
    grade: s.grades.find(row => row.taskId === f.historyTaskId), indicators: s.indicators.filter(row => row.taskId === f.historyTaskId) };
}

// Escaped literals preserve the exact requested Chinese names while keeping this new file ASCII.
for (const name of ['\u51cf\u5c11\u5ba2\u6237\u6295\u8bc9', '\u589e\u52a0\u6709\u6548\u5ba2\u6237']) {
  test(`#6 persisted KPI ${name} totals 80 and leaves historical grades untouched`, async ({ request, audit }) => {
    const { f } = audit;
    seed(f, 'legacy', [{ name, indicatorType: 'kpi', weight: 0.5 },
      { name: f.prefix + ' service quality', indicatorType: 'kpi', weight: 0.5 }]);
    const before = state(f);
    const historicalDetail = await api<TaskDetail>(request, audit, 'manager', 'GET', `/tasks/${f.historyTaskId}`);
    expect(historicalDetail.gradeResult).toMatchObject({ calculatedScore: -40, rawGrade: 'D', calibratedGrade: 'C' });
    const detail = await api<TaskDetail>(request, audit, 'manager', 'GET', `/tasks/${f.taskId}`);
    expect(detail.indicatorInstances.map(item => item.indicatorType)).toEqual(['kpi', 'kpi']);
    await api(request, audit, 'manager', 'POST', `/tasks/${f.taskId}/manager-score`, 200, {
      expectedUpdatedAt: detail.updatedAt, indicators: detail.indicatorInstances.map(item => ({ id: item.id, managerScore: 80 })),
      evalSummary: { strengths: f.prefix + ' synthetic review', attachments: [] },
    });
    const result = await api<TaskDetail>(request, audit, 'manager', 'GET', `/tasks/${f.taskId}`);
    expect(result.gradeResult?.calculatedScore, 'Explicit KPI weights produce 80, not name-derived -40/120').toBe(80);
    expect(result.indicatorInstances.map(item => item.indicatorType)).toEqual(['kpi', 'kpi']);
    const after = state(f);
    expect(after.grades.find(row => row.taskId === f.taskId)?.calculatedScore).toBe('80');
    expect(history(after, f)).toEqual(history(before, f));
    expect(await api<TaskDetail>(request, audit, 'manager', 'GET', `/tasks/${f.historyTaskId}`)).toEqual(historicalDetail);
    expect(history(state(f), f)).toEqual(history(before, f));
  });
}

test('#6 explicit bonus, penalty and veto retain stored semantics despite conflicting names', async ({ request, audit }) => {
  const { f } = audit;
  seed(f, 'legacy', [
    { name: f.prefix + ' KPI', indicatorType: 'kpi', weight: 1 },
    { name: '\u51cf\u5c11\u6295\u8bc9', indicatorType: 'bonus', weight: 0 },
    { name: '\u589e\u52a0\u4ea7\u80fd', indicatorType: 'penalty', weight: 0 },
    { name: f.prefix + ' ordinary quality', indicatorType: 'veto', weight: 0 },
  ]);
  const before = state(f);
  const detail = await api<TaskDetail>(request, audit, 'manager', 'GET', `/tasks/${f.taskId}`);
  const scores: Record<string, number> = { kpi: 80, bonus: 5, penalty: 3 };
  await api(request, audit, 'manager', 'POST', `/tasks/${f.taskId}/manager-score`, 200, {
    expectedUpdatedAt: detail.updatedAt,
    indicators: detail.indicatorInstances.filter(item => item.indicatorType !== 'veto').map(item => ({
      id: item.id, managerScore: scores[item.indicatorType],
    })), evalSummary: { attachments: [] },
  });
  const result = await api<TaskDetail>(request, audit, 'manager', 'GET', `/tasks/${f.taskId}`);
  expect(result.gradeResult?.calculatedScore).toBe(82);
  expect(result.indicatorInstances.map(item => item.indicatorType)).toEqual(['kpi', 'bonus', 'penalty', 'veto']);
  const after = state(f);
  expect(after.indicators.find(row => row.taskId === f.taskId && row.indicatorType === 'veto')).toMatchObject({ finalScore: '100' });
  expect(history(after, f)).toEqual(history(before, f));
});

test('#16 employee submit binds actor, period, full payload and expectedVersion; retry survives manager completion', async ({ request, audit }) => {
  const { f } = audit;
  seed(f, 'monthly');
  const command = employeeCommand(f);
  const path = route(f, 'employee-submit');
  const result = await api(request, audit, 'employee', 'POST', path, 200, command);
  expect(result).toMatchObject({ periodId: f.periodIds[0], status: 'manager_scoring', draftVersion: 1 });
  const submitted = state(f);
  expectEffects(submitted, f, { revisions: 1, flows: 1, audits: 1, notifications: 1, progress: 2 });
  expect(submitted.periods.find(row => row.id === f.periodIds[0])).toMatchObject({ selfScoreTotal: '80', selfGrade: 'B' });
  expect(submitted.revisions[0]).toMatchObject({ periodId: f.periodIds[0], stage: 'employee', createdById: f.actors.employee.id,
    idempotencyKey: command.idempotencyKey });
  await replay(request, audit, 'employee', path, command, result);
  await replay(request, audit, 'employee', path, command, result);
  for (const actor of ['outsider', 'manager'] as const) await denied(request, audit, actor, path, command, 403);
  await denied(request, audit, 'employee', route(f, 'employee-submit', 1), command, 409);
  await denied(request, audit, 'employee', path, { ...command, expectedVersion: 1 }, 409);
  await denied(request, audit, 'employee', path, { ...command, selfGrade: 'A' }, 409);
  for (const changed of [{ selfScore: 81 }, { progress: 76 }, { healthStatus: 'at_risk' }, { employeeComment: f.prefix + ' changed' }]) {
    await denied(request, audit, 'employee', path, { ...command,
      indicators: [{ ...command.indicators[0], ...changed }, command.indicators[1]] }, 409);
  }
  // A key from the employee stage cannot be adopted by the authorized manager stage.
  await denied(request, audit, 'manager', route(f, 'manager-submit'), { ...managerCommand(f), idempotencyKey: command.idempotencyKey }, 403);
  await denied(request, audit, 'employee', route(f, 'manager-submit'), { ...managerCommand(f), idempotencyKey: command.idempotencyKey }, 409);
  await api(request, audit, 'manager', 'POST', route(f, 'manager-submit'), 200, managerCommand(f));
  expect(state(f).periods.find(row => row.id === f.periodIds[0])).toMatchObject({ status: 'completed', draftVersion: 2 });
  await replay(request, audit, 'employee', path, command, result);
});

test('#16 manager submit replays once after completion without duplicate aggregate, audit or notifications', async ({ request, audit }) => {
  const { f } = audit;
  seed(f, 'monthly');
  await api(request, audit, 'employee', 'POST', route(f, 'employee-submit', 1), 200, employeeCommand(f));
  await api(request, audit, 'manager', 'POST', route(f, 'manager-submit', 1), 200, managerCommand(f));
  await api(request, audit, 'employee', 'POST', route(f, 'employee-submit'), 200, employeeCommand(f));
  const command = managerCommand(f);
  const path = route(f, 'manager-submit');
  const result = await api(request, audit, 'manager', 'POST', path, 200, command);
  expect(result).toMatchObject({ periodId: f.periodIds[0], status: 'completed', draftVersion: 2 });
  const completed = state(f);
  expectEffects(completed, f, { revisions: 4, flows: 2, audits: 5, notifications: 4, progress: 4 });
  expect(completed.grades.find(row => row.taskId === f.taskId)).toMatchObject({ calculatedScore: '80' });
  expect(completed.revisions.find(row => row.idempotencyKey === command.idempotencyKey))
    .toMatchObject({ periodId: f.periodIds[0], stage: 'manager', createdById: f.actors.manager.id });
  expect(completed.audits.filter(row => row.action === 'period_scores_aggregated')).toHaveLength(1);
  await replay(request, audit, 'manager', path, command, result);
  await replay(request, audit, 'manager', path, command, result);
  for (const actor of ['outsider', 'employee'] as const) await denied(request, audit, actor, path, command, 403);
  await denied(request, audit, 'manager', route(f, 'manager-submit', 1), command, 409);
  await denied(request, audit, 'manager', path, { ...command, expectedVersion: 2 }, 409);
  await denied(request, audit, 'manager', path, { ...command, managerGrade: 'A' }, 409);
  for (const changed of [{ managerScore: 81 }, { managerComment: f.prefix + ' changed' }]) {
    await denied(request, audit, 'manager', path, { ...command,
      indicators: [{ ...command.indicators[0], ...changed }, command.indicators[1]] }, 409);
  }
  await denied(request, audit, 'manager', route(f, 'manager-return'), {
    idempotencyKey: command.idempotencyKey, expectedVersion: command.expectedVersion, reason: f.prefix + ' different action',
  }, 409);
  await denied(request, audit, 'manager', route(f, 'employee-submit'), {
    ...employeeCommand(f, 1), idempotencyKey: command.idempotencyKey,
  }, 409);
});

test('#16 manager return binds action and reason; exact retry cannot undo later resubmit or completion', async ({ request, audit }) => {
  const { f } = audit;
  seed(f, 'monthly');
  await api(request, audit, 'employee', 'POST', route(f, 'employee-submit'), 200, employeeCommand(f));
  const draft = managerCommand(f);
  await api(request, audit, 'manager', 'PUT', route(f, 'manager-draft'), 200, {
    expectedVersion: draft.expectedVersion, managerGrade: draft.managerGrade, indicators: draft.indicators,
  });
  const command = { expectedVersion: 2, idempotencyKey: randomUUID(), reason: f.prefix + ' revise supporting evidence' };
  const path = route(f, 'manager-return');
  const result = await api(request, audit, 'manager', 'POST', path, 200, command);
  expect(result).toMatchObject({ periodId: f.periodIds[0], status: 'self_eval', draftVersion: 3 });
  const returned = state(f);
  expectEffects(returned, f, { revisions: 2, flows: 2, audits: 2, notifications: 2, progress: 2 });
  expect(returned.periods.find(row => row.id === f.periodIds[0])).toMatchObject({
    employeeSubmittedAt: null, managerSubmittedAt: null, lockedAt: null, managerScoreTotal: null, managerGrade: null,
  });
  expect(returned.reviews).toEqual(expect.arrayContaining(f.itemIds.map(indicatorVersionItemId => expect.objectContaining({
    indicatorVersionItemId, managerScore: null, managerComment: null, selfScore: '80',
  }))));
  expect(returned.revisions.find(row => row.idempotencyKey === command.idempotencyKey)).toMatchObject({
    periodId: f.periodIds[0], stage: 'manager', createdById: f.actors.manager.id, snapshot: expect.objectContaining({ action: 'return' }),
  });
  await replay(request, audit, 'manager', path, command, result);
  for (const actor of ['outsider', 'employee'] as const) await denied(request, audit, actor, path, command, 403);
  await denied(request, audit, 'manager', route(f, 'manager-return', 1), command, 409);
  await denied(request, audit, 'manager', path, { ...command, expectedVersion: 3 }, 409);
  await denied(request, audit, 'manager', path, { ...command, reason: f.prefix + ' different reason' }, 409);
  await denied(request, audit, 'manager', route(f, 'manager-submit'), {
    ...managerCommand(f, 2), idempotencyKey: command.idempotencyKey,
  }, 409);
  const resubmitted = await api(request, audit, 'employee', 'POST', route(f, 'employee-submit'), 200, employeeCommand(f, 3));
  expect(resubmitted).toMatchObject({ status: 'manager_scoring', draftVersion: 4 });
  await replay(request, audit, 'manager', path, command, result);
  const completed = await api(request, audit, 'manager', 'POST', route(f, 'manager-submit'), 200, managerCommand(f, 4));
  expect(completed).toMatchObject({ status: 'completed', draftVersion: 5 });
  await replay(request, audit, 'manager', path, command, result);
});
