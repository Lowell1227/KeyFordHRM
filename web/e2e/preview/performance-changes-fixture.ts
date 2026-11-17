import { test as base, expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const origin = 'http://localhost:5173';
const keys = ['employee', 'manager', 'head', 'vp', 'hr1', 'hr2', 'outsider', 'admin'] as const;
export type Role = typeof keys[number];
type Actor = { id: string; employeeNo: string; name: string };
export type Manifest = {
  prefix: string; departmentId: string; actors: Record<Role, Actor>;
  cycleId: string; foreignCycleId: string; taskId: string; foreignTaskId: string;
  versionId: string; sourceIds: string[]; itemIds: string[]; periodIds: string[];
};
export type Fixture = { f: Manifest; tokens: Record<Role, string> };
export type Goal = {
  sourceInstanceId: string | null; name: string; description: string | null; scoringStandard: string | null;
  targetValue: number | null; targetValueText: string | null; unit: string | null; weight: number;
  indicatorType: 'kpi'; dimensionName: string | null; dimensionWeight: number; sortOrder: number;
};
export type Change = {
  id: string; taskId: string; status: string; revision: number; creatorId: string;
  currentOwnerId: string | null; allowedActions: string[]; beforeGoals: Goal[]; goals: Goal[];
  effectiveVersionId: string | null; protectedPeriodKeys: string[];
};
export type Plan = {
  id: string; status: string; revision: number; workflowVersion: number; workflowIssue: string | null;
  currentOwnerId: string | null; allowedActions: string[]; finalScore: number | null;
  goals: Array<{ id: string; name: string; description: string; weight: number }>;
  selfEvaluation: unknown; managerEvaluation: unknown; departmentEvaluation: unknown;
};
export type Row = { id: string; [key: string]: unknown };
export type State = Record<'tasks' | 'periods' | 'reviews' | 'revisions' | 'versions' | 'items'
  | 'instances' | 'progress' | 'grades' | 'changes' | 'grants' | 'plans' | 'audits' | 'notifications', Row[]>;

// Match audit-scoring-idempotency: secrets travel only through captured pipes and local memory.
function dockerJson<T>(label: string, source: string): T {
  try {
    return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
      encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'],
      input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
        const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();
        (async () => {
          const [db] = await prisma.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
          if (db.db !== 'hrm_preview' || db.role !== 'hrm_preview') throw new Error('Wrong database');
          if (!await prisma.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Uninitialized preview');
          const result = await (async () => { ${source} })();
          process.stdout.write(JSON.stringify(result));
        })().finally(() => prisma.$disconnect()).catch(() => { process.exitCode = 1; });`,
    })) as T;
  } catch {
    throw new Error(`Performance preview fixture failed: ${label}; subprocess output withheld`);
  }
}

function assertPreview(info: TestInfo) {
  if (process.env.PERFORMANCE_CHANGES_API_READY !== '1') {
    throw new Error('Controller must declare API ready before setting PERFORMANCE_CHANGES_API_READY=1');
  }
  expect(info.config.globalSetup, 'No ordinary migration/seed setup').toBeNull();
  expect(info.project.use.baseURL).toBe(origin);
  expect(info.project.use.trace).toBe('off');
  expect(info.project.use.video).toBe('off');
  expect(info.project.use.storageState).toBeUndefined();
  if (process.env.DEBUG || process.env.PWDEBUG) throw new Error('Disable credential-bearing debug logs');
  let containers;
  try {
    containers = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1', 'hrm-web-1'], {
      encoding: 'utf8', timeout: 15_000, stdio: ['pipe', 'pipe', 'pipe'],
    }));
  } catch { throw new Error('Unable to verify preview containers; inspect output withheld'); }
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
  const env = Object.fromEntries(web.Config.Env.map((line: string) => {
    const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
  }));
  expect(env.VITE_PREVIEW_MODE).toBe('true');
  expect(env.VITE_DEV_PROXY_TARGET).toBe('http://api:3000');
  dockerJson('environment guard', 'return true;');
}

function manifest(): Manifest {
  const prefix = `PC_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  return { prefix, departmentId: randomUUID(),
    actors: Object.fromEntries(keys.map(key => [key, {
      id: randomUUID(), employeeNo: `${prefix}_${key}`, name: `${prefix} ${key}`,
    }])) as Record<Role, Actor>,
    cycleId: randomUUID(), foreignCycleId: randomUUID(), taskId: randomUUID(), foreignTaskId: randomUUID(),
    versionId: randomUUID(), sourceIds: [randomUUID(), randomUUID()], itemIds: [randomUUID(), randomUUID()],
    periodIds: [randomUUID(), randomUUID(), randomUUID()] };
}

function create(f: Manifest): Record<Role, string> {
  return dockerJson('create fictional actors and approved baseline', `
    const f = ${JSON.stringify(f)};
    await prisma.$transaction(async tx => {
      await tx.department.create({ data: { id: f.departmentId, name: f.prefix, company: 'fuede' } });
      for (const [key, actor] of Object.entries(f.actors)) {
        await tx.user.create({ data: { ...actor, deptId: f.departmentId, status: 'active', accountType: 'employee',
          sysRole: key === 'hr1' ? 'hr' : key === 'hr2' ? 'hr_user' : key === 'admin' ? 'system_admin' : 'employee',
          canViewAll: key === 'admin', mustChangePassword: false,
          hrCapabilities: key === 'hr2' ? ['cycle_plan_edit', 'performance_publish'] : [] } });
      }
      const managers = { employee: 'manager', manager: 'head', head: 'vp' };
      for (const [key, actor] of Object.entries(f.actors)) {
        const directManagerId = managers[key] ? f.actors[managers[key]].id : null;
        await tx.user.update({ where: { id: actor.id }, data: { directManagerId } });
        await tx.employmentRecord.create({ data: { userId: actor.id, employeeNo: actor.employeeNo,
          effectiveFrom: new Date('2020-01-01'), entryDate: new Date('2020-01-01'),
          deptId: f.departmentId, company: 'fuede', directManagerId, employeeStatus: 'active',
          changeType: 'onboarding', sourceType: 'preview_fixture' } });
      }
      await tx.department.update({ where: { id: f.departmentId }, data: {
        leaderId: f.actors.head.id, approverId: f.actors.vp.id } });
      for (const foreign of [false, true]) {
        await tx.assessmentCycle.create({ data: {
          id: foreign ? f.foreignCycleId : f.cycleId, name: f.prefix + (foreign ? '_foreign' : '_main'),
          type: 'quarterly', startDate: new Date('2090-01-01'), endDate: new Date('2090-03-31'),
          status: 'self_eval', workflowVersion: 2, goalWorkflowVersion: 2, scoringFrequency: 'monthly',
          notificationMode: 'off', createdBy: f.actors.hr1.id, hrOwnerId: f.actors[foreign ? 'hr1' : 'hr2'].id } });
        await tx.assessmentTask.create({ data: {
          id: foreign ? f.foreignTaskId : f.taskId, cycleId: foreign ? f.foreignCycleId : f.cycleId,
          employeeId: f.actors[foreign ? 'outsider' : 'employee'].id, deptId: f.departmentId,
          managerId: f.actors.manager.id, deptHeadId: f.actors.head.id, approverId: f.actors.vp.id,
          status: 'goal_confirmed', goalApprovedAt: new Date('2025-01-01'), indicatorConfirmedAt: new Date('2025-01-01') } });
      }
      await tx.indicatorInstance.createMany({ data: f.sourceIds.map((id, index) => ({
        id, taskId: f.taskId, name: f.prefix + ' original ' + index, description: f.prefix + ' baseline description ' + index,
        scoringStandard: 'Synthetic count', targetValue: 10, unit: 'items', weight: 0.5,
        indicatorType: 'kpi', dimensionName: 'Delivery', dimensionWeight: 1, sortOrder: index })) });
      await tx.indicatorVersion.create({ data: { id: f.versionId, taskId: f.taskId, version: 1, status: 'active',
        effectiveFromPeriodKey: '2090-01', createdById: f.actors.hr1.id,
        items: { create: f.itemIds.map((id, index) => ({ id, sourceInstanceId: f.sourceIds[index],
          name: f.prefix + ' original ' + index, description: f.prefix + ' baseline description ' + index,
          scoringStandard: 'Synthetic count', targetValue: 10, unit: 'items', weight: 0.5,
          indicatorType: 'kpi', dimensionName: 'Delivery', dimensionWeight: 1, sortOrder: index })) } } });
      for (const [index, id] of f.periodIds.entries()) {
        await tx.assessmentPeriod.create({ data: { id, taskId: f.taskId, indicatorVersionId: f.versionId,
          periodKey: '2090-0' + (index + 1), sequence: index + 1, periodType: 'month',
          periodStart: new Date(Date.UTC(2090, index, 1)), periodEnd: new Date(Date.UTC(2090, index + 1, 0)),
          managerId: f.actors.manager.id, status: ['completed', 'self_eval', 'unopened'][index],
          selfEvalOpenAt: index === 2 ? new Date('2091-01-01') : new Date(Date.now() - 86400000),
          selfEvalDueAt: new Date('2091-01-03'), managerDueAt: new Date('2091-01-08'), draftVersion: index === 0 ? 2 : index === 1 ? 1 : 0,
          ...(index === 0 ? { employeeSubmittedAt: new Date('2025-01-02'), managerSubmittedAt: new Date('2025-01-03'),
            lockedAt: new Date('2025-01-03'), selfScoreTotal: 71, managerScoreTotal: 72, selfGrade: 'B', managerGrade: 'B' } : {}) } });
        if (index < 2) await tx.assessmentPeriodIndicatorReview.createMany({ data: f.itemIds.map((itemId, goalIndex) => ({
          periodId: id, indicatorVersionItemId: itemId, progress: 45 + goalIndex, healthStatus: 'on_track',
          actualValueText: 'Synthetic actual ' + goalIndex, employeeComment: f.prefix + ' protected content ' + goalIndex,
          problemReason: 'Synthetic reason', nextMonthPlan: 'Synthetic next plan', supportNeeded: 'Synthetic support',
          selfScore: 71 + goalIndex, ...(index === 0 ? { managerScore: 72, managerComment: 'Completed evidence' } : {}) })) });
      }
      for (const stage of ['employee', 'manager']) await tx.assessmentPeriodReviewRevision.create({ data: {
        periodId: f.periodIds[0], stage, revision: 1, idempotencyKey: f.prefix + '_' + stage,
        createdById: f.actors[stage === 'employee' ? 'employee' : 'manager'].id,
        snapshot: { sentinel: f.prefix, stage, itemIds: f.itemIds, score: 72 } } });
      await tx.indicatorProgressUpdate.create({ data: { indicatorInstanceId: f.sourceIds[1],
        periodId: f.periodIds[0], content: f.prefix + ' historical progress', createdBy: f.actors.employee.id } });
      await tx.gradeResult.create({ data: { taskId: f.taskId, calculatedScore: 72, rawGrade: 'B' } });
    }, { timeout: 20000 });
    const { JwtService } = require('@nestjs/jwt'); const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    return Object.fromEntries(Object.entries(f.actors).map(([key, actor]) => [key,
      jwt.sign({ sub: actor.id, employeeNo: actor.employeeNo,
        sysRole: key === 'hr1' ? 'hr' : key === 'hr2' ? 'hr_user' : key === 'admin' ? 'system_admin' : 'employee' }, { expiresIn: '30m' })]));
  `);
}

function owned<T>(f: Manifest, label: string, source: string): T {
  if (!/^PC_[a-f0-9]{10}$/.test(f.prefix)) throw new Error('Invalid fixture prefix');
  return dockerJson<T>(label, `
    const f = ${JSON.stringify(f)}, ids = Object.values(f.actors).map(actor => actor.id);
    const taskIds = [f.taskId, f.foreignTaskId], cycleIds = [f.cycleId, f.foreignCycleId];
    const dept = await prisma.department.findUnique({ where: { id: f.departmentId } });
    if (!dept || dept.name !== f.prefix || dept.parentId || dept.leaderId !== f.actors.head.id || dept.approverId !== f.actors.vp.id) throw new Error('Foreign department');
    const users = await prisma.user.findMany({ where: { OR: [{ id: { in: ids } }, { deptId: f.departmentId }, { directManagerId: { in: ids } }] },
      select: { id: true, employeeNo: true, name: true, deptId: true, dingtalkId: true, dingtalkUnionId: true } });
    if (users.length !== ids.length || users.some(user => user.deptId !== f.departmentId || user.dingtalkId || user.dingtalkUnionId
      || !Object.values(f.actors).some(actor => actor.id === user.id && actor.employeeNo === user.employeeNo && actor.name === user.name))) throw new Error('Foreign actor');
    const employment = await prisma.employmentRecord.findMany({ where: { OR: [{ userId: { in: ids } }, { deptId: f.departmentId }, { directManagerId: { in: ids } }] } });
    if (employment.length !== ids.length || employment.some(row => !ids.includes(row.userId) || row.sourceType !== 'preview_fixture' || row.deptId !== f.departmentId)) throw new Error('Foreign employment');
    const cycles = await prisma.assessmentCycle.findMany({ where: { OR: [{ id: { in: cycleIds } }, { createdBy: { in: ids } }, { hrOwnerId: { in: ids } }] } });
    if (cycles.length !== 2 || cycles.some(row => !cycleIds.includes(row.id) || row.name !== f.prefix + (row.id === f.cycleId ? '_main' : '_foreign') || row.createdBy !== f.actors.hr1.id)) throw new Error('Foreign cycle');
    const tasks = await prisma.assessmentTask.findMany({ where: { OR: [{ id: { in: taskIds } }, { cycleId: { in: cycleIds } }, { deptId: f.departmentId }, { employeeId: { in: ids } }] }, orderBy: { id: 'asc' } });
    if (tasks.length !== 2 || tasks.some(row => !taskIds.includes(row.id) || row.deptId !== f.departmentId
      || row.cycleId !== (row.id === f.taskId ? f.cycleId : f.foreignCycleId)
      || row.employeeId !== f.actors[row.id === f.taskId ? 'employee' : 'outsider'].id)) throw new Error('Foreign task');
    const plans = await prisma.improvementPlan.findMany({ where: { OR: [{ employeeId: { in: ids } }, { creatorId: { in: ids } }, { cycleId: { in: cycleIds } }] }, orderBy: { id: 'asc' } });
    if (plans.some(row => row.employeeId !== f.actors.employee.id || row.creatorId !== f.actors.manager.id
      || !row.improvementNeed?.startsWith(f.prefix) || (row.cycleId && row.cycleId !== f.cycleId))) throw new Error('Foreign improvement plan');
    const changes = await prisma.goalChangeRequest.findMany({ where: { OR: [{ taskId: { in: taskIds } }, { creatorId: { in: ids } }] }, orderBy: { id: 'asc' } });
    if (changes.some(row => !taskIds.includes(row.taskId) || !ids.includes(row.creatorId))) throw new Error('Foreign goal change');
    ${source}
  `);
}

export function state(f: Manifest): State {
  return owned(f, 'read owned state', `
    const orderBy = { id: 'asc' };
    const versions = await prisma.indicatorVersion.findMany({ where: { taskId: { in: taskIds } }, orderBy });
    return { tasks, changes, plans, versions,
      periods: await prisma.assessmentPeriod.findMany({ where: { taskId: { in: taskIds } }, orderBy }),
      reviews: await prisma.assessmentPeriodIndicatorReview.findMany({ where: { periodId: { in: f.periodIds } }, orderBy }),
      revisions: await prisma.assessmentPeriodReviewRevision.findMany({ where: { periodId: { in: f.periodIds } }, orderBy }),
      items: await prisma.indicatorVersionItem.findMany({ where: { indicatorVersionId: { in: versions.map(row => row.id) } }, orderBy }),
      instances: await prisma.indicatorInstance.findMany({ where: { taskId: { in: taskIds } }, orderBy }),
      progress: await prisma.indicatorProgressUpdate.findMany({ where: { createdBy: { in: ids } }, orderBy }),
      grades: await prisma.gradeResult.findMany({ where: { taskId: { in: taskIds } }, orderBy }),
      grants: await prisma.goalChangeGrant.findMany({ where: { taskId: { in: taskIds } } }),
      audits: await prisma.auditLog.findMany({ where: { userId: { in: ids } }, orderBy }),
      notifications: await prisma.notificationLog.findMany({ where: { OR: [{ userId: { in: ids } }, { senderId: { in: ids } }] }, orderBy }) };
  `);
}

export function transferEmployeeToHead(f: Manifest) {
  return owned(f, 'transfer only the owned fictional employee', `
    await prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: f.actors.employee.id }, data: { directManagerId: f.actors.head.id } });
      const changed = await tx.employmentRecord.updateMany({
        where: { userId: f.actors.employee.id, sourceType: 'preview_fixture' },
        data: { directManagerId: f.actors.head.id },
      });
      if (changed.count !== 1) throw new Error('Unexpected fictional employment count');
    });
    return true;
  `);
}

export function cleanup(f: Manifest) {
  if (!dockerJson<boolean>('cleanup preflight', `return Boolean(await prisma.department.findUnique({ where: { id: ${JSON.stringify(f.departmentId)} } }));`)) return;
  const remaining = owned<number>(f, 'cleanup owned fixture only', `
    await prisma.$transaction(async tx => {
      await tx.notificationLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { senderId: { in: ids } }] } });
      await tx.auditLog.deleteMany({ where: { userId: { in: ids } } });
      await tx.improvementPlan.deleteMany({ where: { id: { in: plans.map(row => row.id) } } });
      // Requests reference baseline/effective versions with RESTRICT: remove them first.
      await tx.goalChangeRequest.deleteMany({ where: { id: { in: changes.map(row => row.id) } } });
      await tx.goalChangeGrant.deleteMany({ where: { taskId: { in: taskIds } } });
      await tx.indicatorProgressUpdate.deleteMany({ where: { createdBy: { in: ids } } });
      await tx.assessmentPeriod.deleteMany({ where: { taskId: { in: taskIds } } });
      await tx.indicatorVersion.deleteMany({ where: { taskId: { in: taskIds } } });
      await tx.assessmentTask.deleteMany({ where: { id: { in: taskIds } } });
      await tx.assessmentCycle.deleteMany({ where: { id: { in: cycleIds } } });
      await tx.employmentRecord.deleteMany({ where: { userId: { in: ids }, sourceType: 'preview_fixture' } });
      await tx.user.deleteMany({ where: { id: { in: ids }, deptId: f.departmentId, employeeNo: { startsWith: f.prefix + '_' } } });
      await tx.department.delete({ where: { id: f.departmentId, name: f.prefix } });
    }, { timeout: 20000 });
    return await prisma.user.count({ where: { id: { in: ids } } })
      + await prisma.department.count({ where: { id: f.departmentId } })
      + await prisma.assessmentTask.count({ where: { id: { in: taskIds } } })
      + await prisma.goalChangeRequest.count({ where: { taskId: { in: taskIds } } })
      + await prisma.improvementPlan.count({ where: { employeeId: { in: ids } } });
  `);
  expect(remaining, 'All owned fixture data removed').toBe(0);
}

export const test = base.extend<{ changes: Fixture }>({
  changes: async ({}, use, info) => {
    assertPreview(info);
    const f = manifest();
    try { await use({ f, tokens: create(f) }); } finally { cleanup(f); }
  },
});

export async function http<T>(request: APIRequestContext, fixture: Fixture, role: Role,
  method: string, path: string, data?: unknown): Promise<{ status: number; data: T }> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Preview-local path required');
  try {
    const response = await request.fetch(`${origin}/api/v1${path}`, {
      method, headers: { authorization: `Bearer ${fixture.tokens[role]}` },
      ...(data === undefined ? {} : { data }), maxRedirects: 0, timeout: 20_000,
    });
    const body = await response.json();
    return { status: response.status(), data: body.data as T };
  } catch { throw new Error(`Preview HTTP failed: ${role} ${method} ${path}; transport output withheld`); }
}

export async function api<T>(request: APIRequestContext, fixture: Fixture, role: Role,
  method: string, path: string, status = 200, data?: unknown): Promise<T> {
  const result = await http<T>(request, fixture, role, method, path, data);
  expect(result.status, `${role} ${method} ${path}`).toBe(status);
  if (status >= 400) expect(result.data == null || Object.keys(result.data).length === 0, 'No record in error envelope').toBe(true);
  return result.data;
}

export async function login(page: Page, fixture: Fixture, role: Role, path: string) {
  await page.context().route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(`${origin}/login`);
  await page.evaluate(token => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('token', token);
    localStorage.setItem('expiresAt', String(Date.now() + 25 * 60_000));
    localStorage.setItem('passwordChangeRequired', 'false');
  }, fixture.tokens[role]);
  await page.goto(`${origin}${path}`);
}
