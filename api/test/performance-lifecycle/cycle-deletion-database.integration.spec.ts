import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthUser } from '@/common/types/auth.types';
import { CycleTerminationService } from '@/cycles/cycle-termination.service';
import { CycleDeletionService } from '@/cycles/cycle-deletion.service';
import { CyclesService } from '@/cycles/cycles.service';
import { ReportsService } from '@/reports/reports.service';
import { SchedulerService } from '@/scheduler/scheduler.service';
import { backendPid, cycleSnapshot, expectWriteFence, gate, lifecycleContent, observedTransactions,
  openCycleTerminationDatabase, snapshotRows, transactionBudget, verifyQueueAndRelease } from './cycle-termination-database.helper';

describe('cycle logical deletion: real PostgreSQL atomicity and queued authority', () => {
  let db: PrismaClient, second: PrismaClient, service: CycleDeletionService;
  const start = new Date('2038-02-01'), end = new Date('2038-02-28');
  const label = () => `CD_${randomUUID().slice(0, 12)}`;
  beforeAll(async () => { ({ db, second } = await openCycleTerminationDatabase()); service = new CycleDeletionService(db as any); });
  afterAll(async () => { await second?.$disconnect(); await db?.$disconnect(); });
  async function fixture(protectedResult = false) {
    const user = await db.user.create({ data: { name: label(), status: 'active', sysRole: 'hr_user',
      hrCapabilities: ['cycle_plan_edit', 'cycle_terminate', 'cycle_delete'] } });
    const owner: AuthUser = { ...user, hrCapabilities: user.hrCapabilities };
    const parent = await db.assessmentCycle.create({ data: { name: label(), type: 'monthly', startDate: start, endDate: end,
      status: 'self_eval', hrOwnerId: owner.id, createdBy: owner.id, openedAt: start } });
    const employee = await db.user.create({ data: { name: label(), status: 'active' } });
    const task = await db.assessmentTask.create({ data: { cycleId: parent.id, employeeId: employee.id,
      managerId: owner.id, status: protectedResult ? 'approval' : 'self_eval' } });
    const period = await db.assessmentPeriod.create({ data: { taskId: task.id, periodKey: '2038-02', periodType: 'month',
      sequence: 1, periodStart: start, periodEnd: end, selfEvalOpenAt: start, selfEvalDueAt: end, managerDueAt: end, managerId: owner.id } });
    const summary = await db.selfEvalSummary.create({ data: { taskId: task.id, achievements: label(), attachments: [] } });
    const change = await db.goalChangeRequest.create({ data: { taskId: task.id, creatorId: owner.id,
      reason: label(), beforeGoals: [], goals: [{ name: label(), weight: 100 }] } });
    if (protectedResult) {
      await db.gradeResult.create({ data: { taskId: task.id, calculatedScore: '88.25', rawGrade: 'D', calibratedGrade: 'D', coefficient: '0.5000', approvedAt: start, approverId: owner.id } });
      await db.assessmentTask.create({ data: { cycleId: parent.id, employeeId: owner.id, managerId: owner.id, status: 'self_eval' } });
    }
    const stopper = new CycleTerminationService(db as any);
    const impact = await stopper.preview(parent.id, owner);
    await stopper.terminate(parent.id, { reason: label(), expectedPreviewHash: impact.previewHash }, owner);
    return { owner, parent, task, period, change, summary };
  }
  async function remove(f: Awaited<ReturnType<typeof fixture>>, instance = service) {
    const impact = await instance.preview(f.parent.id, f.owner);
    return instance.remove(f.parent.id, { reason: 'CD_ fictional deletion', expectedPreviewHash: impact.previewHash }, f.owner);
  }
  it('deletes all and only eligible descendants, retains content, scores, histories and outside modules', async () => {
    const f = await fixture();
    const closed = await db.assessmentCycle.create({ data: { name: label(), type: 'monthly', startDate: start, endDate: end, hrOwnerId: f.owner.id } });
    const plan = await db.improvementPlan.create({ data: { employeeId: f.task.employeeId, taskId: f.task.id,
      cycleId: f.parent.id, creatorId: f.owner.id, improvementGoal: label() } });
    const original = await lifecycleContent(db, 'assessment_tasks', f.task.id);
    const changeContent = await lifecycleContent(db, 'goal_change_requests', f.change.id);
    const periods = await snapshotRows(db, 'assessment_periods', Prisma.sql`r.task_id=${f.task.id}::uuid`);
    const summaries = await snapshotRows(db, 'self_eval_summaries', Prisma.sql`r.task_id=${f.task.id}::uuid`);
    const unrelated = await snapshotRows(db, 'improvement_plans', Prisma.sql`r.id=${plan.id}::uuid`);
    const other = await cycleSnapshot(db, closed.id);
    const result = await remove(f);
    expect(result).toMatchObject({ deletedTaskCount: 1, deletedGoalChangeCount: 1 });
    expect(await lifecycleContent(db, 'assessment_tasks', f.task.id)).toBe(original);
    expect(await lifecycleContent(db, 'goal_change_requests', f.change.id)).toBe(changeContent);
    expect(await snapshotRows(db, 'assessment_periods', Prisma.sql`r.task_id=${f.task.id}::uuid`)).toBe(periods);
    expect(await snapshotRows(db, 'self_eval_summaries', Prisma.sql`r.task_id=${f.task.id}::uuid`)).toBe(summaries);
    expect(await snapshotRows(db, 'improvement_plans', Prisma.sql`r.id=${plan.id}::uuid`)).toBe(unrelated);
    expect(await cycleSnapshot(db, closed.id)).toEqual(other);
    expect(await db.assessmentCycle.findUniqueOrThrow({ where: { id: f.parent.id } })).toMatchObject({ status: 'self_eval', deletionVersion: 1, deletedById: f.owner.id });
    expect(await db.assessmentTask.findUniqueOrThrow({ where: { id: f.task.id } })).toMatchObject({ status: 'self_eval', lifecycleStatus: 'deleted' });
    expect(await db.auditLog.count({ where: { entityId: { in: [f.parent.id, f.task.id, f.change.id] }, action: { in: ['cycle_deleted', 'lifecycle_deleted'] } } })).toBe(3);
  });
  it('preserves completed valid results for reports without fabricating termination facts', async () => {
    const f = await fixture(true);
    await db.goalChangeRequest.update({ where: { id: f.change.id }, data: { status: 'revoked' } });
    await db.assessmentTask.update({ where: { id: f.task.id }, data: { status: 'closed', closedAt: end } });
    const before = await snapshotRows(db, 'grade_results', Prisma.sql`r.task_id=${f.task.id}::uuid`);
    await remove(f);
    expect(await snapshotRows(db, 'grade_results', Prisma.sql`r.task_id=${f.task.id}::uuid`)).toBe(before);
    expect(await db.assessmentTask.count({ where: { id: f.task.id, OR: [{ lifecycleStatus: 'active' }, { lifecycleStatus: 'deleted', terminatedAt: null }] } })).toBe(1);
  });
  it('archives a published and confirmed result before logical deletion even if older employee archives exist', async () => {
    const f = await fixture(true);
    await db.goalChangeRequest.update({ where: { id: f.change.id }, data: { status: 'revoked' } });
    await db.assessmentTask.update({ where: { id: f.task.id }, data: { status: 'confirmed', publishedAt: end, employeeConfirmedAt: end } });
    await db.gradeResult.update({ where: { taskId: f.task.id }, data: { isPublished: true, publishedAt: end, employeeConfirmedAt: end } });
    const old = await db.assessmentCycle.create({ data: { name: label(), type: 'monthly', startDate: start, endDate: end } });
    await db.performanceArchive.create({ data: { employeeId: f.task.employeeId, cycleId: old.id, employeeName: label(), grade: 'D', totalScore: '70.00' } });
    const before = await snapshotRows(db, 'grade_results', Prisma.sql`r.task_id=${f.task.id}::uuid`);
    await remove(f);
    const archive = await db.performanceArchive.findUnique({ where: { employeeId_cycleId: { employeeId: f.task.employeeId, cycleId: f.parent.id } } });
    expect(archive).toMatchObject({ grade: 'D', totalScore: new Prisma.Decimal('88.25'), coefficient: new Prisma.Decimal('0.5000') });
    expect(await snapshotRows(db, 'grade_results', Prisma.sql`r.task_id=${f.task.id}::uuid`)).toBe(before);
    const history = await new ReportsService(db as any, {} as any).getEmployeeArchive(f.task.employeeId, { ...f.owner, sysRole: 'hr' });
    expect(history.map(row => row.cycleId).sort()).toEqual([old.id, f.parent.id].sort());
  });
  it('preserves an existing archive byte-for-byte and auto-close cannot rewrite a deleted cycle', async () => {
    const f = await fixture(true);
    await db.goalChangeRequest.update({ where: { id: f.change.id }, data: { status: 'revoked' } });
    await db.assessmentTask.update({ where: { id: f.task.id }, data: { status: 'closed', closedAt: end } });
    await db.performanceArchive.create({ data: { employeeId: f.task.employeeId, cycleId: f.parent.id,
      employeeName: label(), grade: 'D', totalScore: '77.00', summary: { original: true } } });
    const before = await db.performanceArchive.findUniqueOrThrow({ where: { employeeId_cycleId: { employeeId: f.task.employeeId, cycleId: f.parent.id } } });
    await remove(f);
    expect(await db.performanceArchive.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
    const snapshot = await cycleSnapshot(db, f.parent.id);
    const scheduler = new SchedulerService({} as any, db as any, {} as any, {} as any, {} as any);
    await (scheduler as any).closeCycle({ id: f.parent.id });
    expect(await cycleSnapshot(db, f.parent.id)).toEqual(snapshot);
  });
  it('auto-close queued behind deletion rechecks the committed tombstone without changing facts', async () => {
    const f = await fixture(), impact = await service.preview(f.parent.id, f.owner), held = gate(), release = gate(), began = gate();
    let blocker = 0, waiter = 0;
    const deleting = new CycleDeletionService(observedTransactions(second, { begin: pid => { blocker = pid; }, beforeCommit: async () => { held.resolve(); await release.promise; } }) as any);
    const a = deleting.remove(f.parent.id, { reason: label(), expectedPreviewHash: impact.previewHash }, f.owner);
    await held.promise;
    const scheduler = new SchedulerService({} as any, observedTransactions(db, { begin: pid => { waiter = pid; began.resolve(); } }) as any, {} as any, {} as any, {} as any);
    const b = (scheduler as any).closeCycle({ id: f.parent.id });
    await verifyQueueAndRelease(db, began.promise, () => ({ waiter, blocker }), release.resolve, [a, b]);
    await a; await b;
    expect(await db.assessmentCycle.findUniqueOrThrow({ where: { id: f.parent.id } })).toMatchObject({ status: 'self_eval', deletedAt: expect.any(Date) });
    expect(await db.assessmentTask.findUniqueOrThrow({ where: { id: f.task.id } })).toMatchObject({ status: 'self_eval', lifecycleStatus: 'deleted' });
  });
  it('rejects the whole operation when protected approval is still unfinished', async () => {
    const f = await fixture(true), before = await cycleSnapshot(db, f.parent.id);
    const impact = await service.preview(f.parent.id, f.owner);
    expect(impact.canDelete).toBe(false);
    await expect(remove(f)).rejects.toThrow(ConflictException);
    expect(await cycleSnapshot(db, f.parent.id)).toEqual(before);
  });
  it('rolls back tasks and changes if anything fails before the cycle audit commits', async () => {
    const f = await fixture(), before = await cycleSnapshot(db, f.parent.id);
    const failing = new CycleDeletionService(observedTransactions(db, { beforeCommit: async () => { throw new Error('CD_forced_rollback'); } }) as any);
    await expect(remove(f, failing)).rejects.toThrow('CD_forced_rollback');
    expect(await cycleSnapshot(db, f.parent.id)).toEqual(before);
  });
  it('rejects duplicate deletion and preserves the first audit and metadata', async () => {
    const f = await fixture(); await remove(f);
    const before = await cycleSnapshot(db, f.parent.id);
    await expect(remove(f)).rejects.toThrow(ConflictException);
    expect(await cycleSnapshot(db, f.parent.id)).toEqual(before);
  });
  it('does not let owner capability or deletion bypass another cycle owner', async () => {
    const f = await fixture();
    const other = await db.user.create({ data: { name: label(), sysRole: 'hr_user', hrCapabilities: ['cycle_delete'] } });
    await expect(service.preview(f.parent.id, { ...f.owner, id: other.id })).rejects.toThrow(ForbiddenException);
    await expect(service.preview(f.parent.id, { ...f.owner, hrCapabilities: ['cycle_plan_edit'] })).rejects.toThrow(ForbiddenException);
  });
  it('rejects a changed impact hash before writing', async () => {
    const f = await fixture(true), impact = await service.preview(f.parent.id, f.owner);
    await db.assessmentTask.update({ where: { id: f.task.id }, data: { status: 'closed', closedAt: end } });
    const before = await cycleSnapshot(db, f.parent.id);
    await expect(service.remove(f.parent.id, { reason: label(), expectedPreviewHash: impact.previewHash }, f.owner)).rejects.toThrow(ConflictException);
    expect(await cycleSnapshot(db, f.parent.id)).toEqual(before);
  });
  it('locks the current actor and rejects a queued delete after a committed revocation', async () => {
    const f = await fixture(), impact = await service.preview(f.parent.id, f.owner), held = gate(), release = gate(), began = gate();
    let blocker = 0, waiter = 0;
    const revocation = second.$transaction(async tx => { blocker = await backendPid(tx);
      await tx.user.update({ where: { id: f.owner.id }, data: { hrCapabilities: ['cycle_terminate'] } }); held.resolve(); await release.promise;
    }, transactionBudget);
    await held.promise;
    const candidate = new CycleDeletionService(observedTransactions(db, { begin: pid => { waiter = pid; began.resolve(); } }) as any);
    const operation = candidate.remove(f.parent.id, { reason: label(), expectedPreviewHash: impact.previewHash }, f.owner);
    const outcome = operation.then(() => 'unexpected success', e => e);
    await verifyQueueAndRelease(db, began.promise, () => ({ waiter, blocker }), release.resolve, [revocation, outcome]);
    expect(await outcome).toBeInstanceOf(ForbiddenException);
    expect(await db.assessmentCycle.findUniqueOrThrow({ where: { id: f.parent.id } })).toMatchObject({ deletedAt: null });
    expect(await db.assessmentTask.findUniqueOrThrow({ where: { id: f.task.id } })).toMatchObject({ lifecycleStatus: 'terminated' });
  });
  it('serializes double clicks and commits exactly one complete cascade', async () => {
    const f = await fixture(), impact = await service.preview(f.parent.id, f.owner), held = gate(), release = gate(), began = gate();
    let blocker = 0, waiter = 0;
    const first = new CycleDeletionService(observedTransactions(second, { begin: pid => { blocker = pid; }, beforeCommit: async () => { held.resolve(); await release.promise; } }) as any);
    const body = { reason: label(), expectedPreviewHash: impact.previewHash };
    const a = first.remove(f.parent.id, body, f.owner); await held.promise;
    const queued = new CycleDeletionService(observedTransactions(db, { begin: pid => { waiter = pid; began.resolve(); } }) as any);
    const b = queued.remove(f.parent.id, body, f.owner).then(() => 'unexpected success', e => e);
    await verifyQueueAndRelease(db, began.promise, () => ({ waiter, blocker }), release.resolve, [a, b]);
    await a; expect(await b).toBeInstanceOf(ConflictException);
    expect(await db.auditLog.count({ where: { entityId: f.parent.id, action: 'cycle_deleted' } })).toBe(1);
  });
  it('database guards reject physical removal, payload rewrites and new children after deletion', async () => {
    const f = await fixture(); await remove(f);
    await expectWriteFence(db.$executeRaw`DELETE FROM assessment_cycles WHERE id=${f.parent.id}::uuid`);
    await expectWriteFence(db.$executeRaw`UPDATE assessment_cycles SET name='CD_illegal' WHERE id=${f.parent.id}::uuid`);
    await expectWriteFence(db.$executeRaw`UPDATE assessment_cycles SET deleted_at=NULL WHERE id=${f.parent.id}::uuid`);
    await expectWriteFence(db.$executeRaw`UPDATE self_eval_summaries SET achievements='CD_illegal' WHERE id=${f.summary.id}::uuid`);
    await expectWriteFence(db.$executeRaw`INSERT INTO assessment_tasks (cycle_id,employee_id,manager_id)
      VALUES (${f.parent.id}::uuid,${f.owner.id}::uuid,${f.owner.id}::uuid)`);
    await expectWriteFence(db.$executeRaw`INSERT INTO goal_change_requests (task_id,creator_id,reason,before_goals,goals)
      VALUES (${f.task.id}::uuid,${f.owner.id}::uuid,'CD_illegal','[]'::jsonb,'[]'::jsonb)`);
  });
  it('database refuses deleting a parent without its still-present descendants', async () => {
    const f = await fixture();
    await expectWriteFence(db.$executeRaw`UPDATE assessment_cycles SET deleted_at=now(),deleted_by_id=${f.owner.id}::uuid,
      deletion_version=1,deletion_reason='CD_invalid_parent' WHERE id=${f.parent.id}::uuid`);
    expect(await db.assessmentCycle.findUniqueOrThrow({ where: { id: f.parent.id } })).toMatchObject({ deletedAt: null });
  });
  it('legacy empty draft removal is logical and repeat attempts cannot replace audit', async () => {
    const f = await fixture();
    const parent = await db.assessmentCycle.create({ data: { name: label(), type: 'monthly', startDate: start, endDate: end, hrOwnerId: f.owner.id } });
    const legacy = new CyclesService(db as any, {} as any);
    await legacy.remove(parent.id, f.owner);
    expect(await db.assessmentCycle.findUniqueOrThrow({ where: { id: parent.id } })).toMatchObject({ deletedAt: expect.any(Date), deletionVersion: 1 });
    await expect(legacy.remove(parent.id, f.owner)).rejects.toThrow(ConflictException);
    expect(await db.auditLog.count({ where: { entityId: parent.id, action: 'cycle_draft_deleted' } })).toBe(1);
  });
});
