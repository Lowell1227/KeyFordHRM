import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PerformanceLifecycleService } from '@/performance-lifecycle/performance-lifecycle.service';
import { isLifecycleDatabaseConflict } from '@/performance-lifecycle/lifecycle-exception.filter';
import { lockLifecycleRow } from '@/performance-lifecycle/lifecycle-lock';
import { claimTaskVersion } from '@/tasks/task-version';
import { terminateEmploymentPerformance } from '@/performance-lifecycle/lifecycle-employment';

// The parent provisions/migrates this disposable database. This test never starts containers,
// migrates, truncates, reseeds, or connects using the application's DATABASE_URL.
describe('performance lifecycle: isolated real PostgreSQL fence contracts', () => {
  let db: PrismaClient;
  let second: PrismaClient;
  let actor: any;
  let service: PerformanceLifecycleService;
  const views = { findOne: async () => ({}) } as any;
  const date = new Date('2038-01-01');
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  }
  beforeAll(async () => {
    const url = new URL(process.env.PERFORMANCE_LIFECYCLE_TEST_DATABASE_URL ?? '');
    const isolatedPreviewHost = url.hostname === 'postgres' && process.env.HRM_PREVIEW === 'true';
    if ((!['127.0.0.1', 'localhost'].includes(url.hostname) && !isolatedPreviewHost)
      || url.pathname !== '/hrm_lifecycle_test' || url.username !== 'hrm_lifecycle_test') {
      throw new Error('Requires the explicitly provisioned isolated hrm_lifecycle_test database and owner');
    }
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    second = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    await db.$connect(); await second.$connect();
    const marker = await db.$queryRaw<Array<{ guard: string | null }>>`SELECT to_regprocedure('performance_lifecycle_root_guard()')::text AS guard`;
    expect(marker[0]?.guard).not.toBeNull();
    const suffix = randomUUID();
    actor = await db.user.create({ data: { name: `Fictional lifecycle operator ${suffix.slice(0, 8)}`, sysRole: 'hr_user',
      hrCapabilities: ['performance_lifecycle_view', 'performance_lifecycle_terminate', 'performance_lifecycle_delete'] } });
    service = new PerformanceLifecycleService(db as any, views, views, views, views);
  });
  afterAll(async () => { await second?.$disconnect(); await db?.$disconnect(); });
  async function fixture() {
    const employeeId = (await db.user.create({ data: { name: `Fictional lifecycle employee ${randomUUID().slice(0, 8)}` } })).id;
    const cycle = await db.assessmentCycle.create({ data: { name: `Fictional lifecycle ${randomUUID()}`, startDate: date,
      endDate: new Date('2038-03-31'), type: 'probation', workflowVersion: 2, goalWorkflowVersion: 2 } });
    const task = await db.assessmentTask.create({ data: { cycleId: cycle.id, employeeId, status: 'self_eval', managerId: actor.id } });
    const period = await db.assessmentPeriod.create({ data: { taskId: task.id, periodKey: '2038-01', periodType: 'month', sequence: 1,
      periodStart: date, periodEnd: new Date('2038-01-31'), selfEvalOpenAt: date, selfEvalDueAt: date, managerDueAt: date, managerId: actor.id } });
    const change = await db.goalChangeRequest.create({ data: { taskId: task.id, creatorId: actor.id, beforeGoals: [], goals: [] } });
    const plan = await db.improvementPlan.create({ data: { employeeId, creatorId: actor.id, workflowVersion: 3 } });
    const confirmation = await db.confirmationApplication.create({ data: { employeeId, workflowVersion: 2 } });
    return { task, period, change, plan, confirmation };
  }
  const input = (row: { updatedAt: Date; lifecycleVersion: number }) => ({ expectedUpdatedAt: row.updatedAt.toISOString(),
    expectedLifecycleVersion: row.lifecycleVersion, reason: 'Fictional isolated lifecycle contract' });
  async function fenced(operation: Promise<unknown>) {
    let failure: unknown;
    try { await operation; } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(isLifecycleDatabaseConflict(failure)).toBe(true);
  }
  async function waitForLock(pid: number) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await db.$queryRaw<Array<{ waiting: boolean }>>`SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid=${pid}`;
      if (rows[0]?.waiting) return;
      await new Promise((done) => setTimeout(done, 10));
    }
    throw new Error('The second connection did not actually queue on a row lock');
  }
  it('preserves business statuses and prevents root/child writes after task termination', async () => {
    const { task, period, change } = await fixture();
    await service.mutate('task', task.id, 'terminate', input(task), actor);
    expect(await db.assessmentTask.findUnique({ where: { id: task.id } })).toMatchObject({ status: 'self_eval', lifecycleStatus: 'terminated' });
    expect(await db.goalChangeRequest.findUnique({ where: { id: change.id } })).toMatchObject({ status: 'draft', lifecycleStatus: 'terminated' });
    await fenced(db.assessmentTask.update({ where: { id: task.id }, data: { status: 'manager_scoring' } }));
    await fenced(db.assessmentTask.delete({ where: { id: task.id } }));
    await fenced(db.assessmentTask.create({ data: { cycleId: task.cycleId, employeeId: actor.id, lifecycleStatus: 'terminated',
      terminatedAt: date, terminationReason: 'Invalid initial state' } }));
    await fenced(db.assessmentPeriod.update({ where: { id: period.id }, data: { status: 'self_eval' } }));
    await fenced(db.assessmentPeriod.delete({ where: { id: period.id } }));
    await fenced(db.gradeResult.create({ data: { taskId: task.id, calculatedScore: 50 } }));
    const archived = await service.mutate('task', task.id, 'delete', input(await db.assessmentTask.findUniqueOrThrow({ where: { id: task.id } })), actor);
    expect(archived.lifecycleStatus).toBe('deleted');
    expect((await db.assessmentTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('self_eval');
  });
  it('fences each independent record without overwriting original status', async () => {
    const { plan, confirmation, change } = await fixture();
    for (const [kind, row, delegate] of [
      ['improvement_plan', plan, db.improvementPlan], ['confirmation', confirmation, db.confirmationApplication],
      ['goal_change', change, db.goalChangeRequest],
    ] as const) {
      await service.mutate(kind, row.id, 'terminate', input(row), actor);
      await fenced((delegate.update as any)({ where: { id: row.id }, data: { updatedAt: new Date() } }));
      await fenced((delegate.delete as any)({ where: { id: row.id } }));
    }
  });
  it('releases only the ongoing uniqueness slots while retaining terminated business states', async () => {
    const { task, change, confirmation } = await fixture();
    await service.mutate('goal_change', change.id, 'terminate', input(change), actor);
    const replacement = await db.goalChangeRequest.create({ data: { taskId: task.id, creatorId: actor.id, beforeGoals: [], goals: [] } });
    expect(replacement.lifecycleStatus).toBe('active');
    await expect(db.goalChangeRequest.create({ data: { taskId: task.id, creatorId: actor.id, beforeGoals: [], goals: [] } }))
      .rejects.toMatchObject({ code: 'P2002' });
    await service.mutate('confirmation', confirmation.id, 'terminate', input(confirmation), actor);
    expect((await db.confirmationApplication.create({ data: { employeeId: confirmation.employeeId, workflowVersion: 2 } })).lifecycleStatus).toBe('active');
    await expect(db.confirmationApplication.create({ data: { employeeId: confirmation.employeeId, workflowVersion: 2 } }))
      .rejects.toMatchObject({ code: 'P2002' });
    expect((await db.confirmationApplication.findUniqueOrThrow({ where: { id: confirmation.id } })).status).toBe(confirmation.status);
  });
  it('effective offboarding ends only the matching employment and is idempotent', async () => {
    const { task, plan, confirmation, change } = await fixture();
    const employeeId = task.employeeId;
    const old = await db.employmentRecord.create({ data: { userId: employeeId, effectiveFrom: date, entryDate: date,
      employeeNo: 'FICTIONAL-OLD', employeeStatus: 'probation', changeType: 'onboarding' } });
    const reentry = await db.employmentRecord.create({ data: { userId: employeeId, effectiveFrom: new Date('2039-01-01'),
      entryDate: new Date('2039-01-01'), employeeNo: 'FICTIONAL-NEW', employeeStatus: 'probation', changeType: 'onboarding' } });
    await db.assessmentTask.update({ where: { id: task.id }, data: { employmentRecordId: old.id } });
    await db.improvementPlan.update({ where: { id: plan.id }, data: { employmentRecordId: old.id } });
    await db.confirmationApplication.update({ where: { id: confirmation.id }, data: { employmentRecordId: old.id } });
    const futureCycle = await db.assessmentCycle.create({ data: { name: `Fictional reentry ${randomUUID()}`, startDate: date,
      endDate: new Date('2038-03-31'), type: 'probation' } });
    const futureTask = await db.assessmentTask.create({ data: { cycleId: futureCycle.id, employeeId, employmentRecordId: reentry.id } });
    const legacyPlan = await db.improvementPlan.create({ data: { employeeId, creatorId: actor.id, workflowVersion: 3 } });
    const other = await fixture();
    await db.assessmentTask.update({ where: { id: other.task.id }, data: { managerId: employeeId } });
    for (let repeat = 0; repeat < 2; repeat++) await db.$transaction(tx =>
      terminateEmploymentPerformance(tx, employeeId, old.id, new Date('2038-03-01'), actor.id));
    for (const [table, id] of [[db.assessmentTask, task.id], [db.improvementPlan, plan.id],
      [db.confirmationApplication, confirmation.id], [db.goalChangeRequest, change.id]] as const) {
      expect((await (table.findUniqueOrThrow as any)({ where: { id } })).lifecycleStatus).toBe('terminated');
      expect(await db.auditLog.count({ where: { entityId: id, action: 'lifecycle_terminated' } })).toBe(1);
    }
    expect((await db.assessmentTask.findUniqueOrThrow({ where: { id: futureTask.id } })).lifecycleStatus).toBe('active');
    expect((await db.improvementPlan.findUniqueOrThrow({ where: { id: legacyPlan.id } })).lifecycleStatus).toBe('active');
    expect((await db.assessmentTask.findUniqueOrThrow({ where: { id: other.task.id } })).lifecycleStatus).toBe('active');
  });
  it('rejects queued stale period/task writes after the terminating connection commits', async () => {
    const { task, period } = await fixture();
    const held = deferred(), release = deferred(), started = deferred();
    let pid = 0;
    const ending = db.$transaction(async (tx) => {
      await lockLifecycleRow(tx, 'task', task.id);
      await tx.assessmentTask.update({ where: { id: task.id }, data: { lifecycleStatus: 'terminated', lifecycleVersion: { increment: 1 },
        terminatedAt: new Date(), terminationReason: 'Isolated queued write test' } });
      held.resolve(); await release.promise;
    }, { timeout: 20000 });
    await held.promise;
    const writing = second.$transaction(async (tx) => {
      pid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
      started.resolve();
      await claimTaskVersion(tx, task.id, task.updatedAt.toISOString(), 'self_eval');
      return tx.assessmentPeriod.update({ where: { id: period.id }, data: { employeeSubmittedAt: new Date() } });
    }, { timeout: 20000 }).catch((error) => error);
    try { await started.promise; await waitForLock(pid); } finally { release.resolve(); }
    await ending;
    expect(await writing).toBeInstanceOf(ConflictException);
    expect((await db.assessmentPeriod.findUniqueOrThrow({ where: { id: period.id } })).employeeSubmittedAt).toBeNull();
  });
  it('does not let queued lifecycle management outlive capability revocation', async () => {
    const { task } = await fixture();
    const held = deferred(), release = deferred(), started = deferred();
    let pid = 0;
    const revoking = db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: actor.id }, data: { hrCapabilities: [] } });
      held.resolve(); await release.promise;
    }, { timeout: 20000 });
    await held.promise;
    const wrapped = { $transaction: (fn: any, options: any) => second.$transaction(async (tx) => {
      pid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
      started.resolve(); return fn(tx);
    }, { ...options, timeout: 20000 }) };
    const queuedService = new PerformanceLifecycleService(wrapped as any, views, views, views, views);
    const mutation = queuedService.mutate('task', task.id, 'terminate', input(task), actor).catch((error) => error);
    try { await started.promise; await waitForLock(pid); } finally { release.resolve(); }
    await revoking;
    expect(await mutation).toBeInstanceOf(ForbiddenException);
    expect((await db.assessmentTask.findUniqueOrThrow({ where: { id: task.id } })).lifecycleStatus).toBe('active');
  });
});
