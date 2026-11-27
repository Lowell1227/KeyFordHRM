import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, PrismaClient, TaskStatus } from '@prisma/client';
import { AuthUser } from '@/common/types/auth.types';
import { CycleTerminationService } from '@/cycles/cycle-termination.service';
import { CyclesService } from '@/cycles/cycles.service';
import { FlowService } from '@/tasks/flow.service';
import { claimTaskVersion } from '@/tasks/task-version';
import { lockLifecycleRow } from '@/performance-lifecycle/lifecycle-lock';
import {
  backendPid, bounded, cycleSnapshot, expectWriteFence, gate, lifecycleContent, observedTransactions,
  openCycleTerminationDatabase, snapshotRows, taskSnapshot, transactionBudget, verifyQueueAndRelease,
} from './cycle-termination-database.helper';

// The coordinator provisions/migrates an owned disposable PG before invoking this suite.
// No containers, migrations, cleanup, application bootstrap or application DATABASE_URL here.
describe('cycle termination: real PostgreSQL integration and two-connection races', () => {
  let db: PrismaClient;
  let second: PrismaClient;
  let service: CycleTerminationService;
  const start = new Date('2038-01-01T00:00:00.000Z');
  const end = new Date('2038-01-31T00:00:00.000Z');
  const reason = 'CT_ fictional cycle termination regression';
  const label = (kind: string) => `CT_${kind}_${randomUUID().slice(0, 12)}`;

  beforeAll(async () => {
    ({ db, second } = await openCycleTerminationDatabase());
    service = new CycleTerminationService(db as any);
  });
  afterAll(async () => { await second?.$disconnect(); await db?.$disconnect(); });

  async function actor(data: Partial<Prisma.UserCreateInput> = {}): Promise<AuthUser> {
    const row = await db.user.create({ data: {
      name: label('actor'), status: 'active', sysRole: 'hr_user', hrCapabilities: ['cycle_terminate'], ...data,
    } });
    return { id: row.id, name: row.name, sysRole: row.sysRole, deptId: row.deptId,
      isAssessorOnly: row.isAssessorOnly, canViewAll: row.canViewAll, hrCapabilities: row.hrCapabilities };
  }

  async function cycle(owner: AuthUser, data: Partial<Prisma.AssessmentCycleUncheckedCreateInput> = {}) {
    return db.assessmentCycle.create({ data: { name: label('cycle'), startDate: start, endDate: end,
      type: 'monthly', status: 'self_eval', openedAt: start, workflowVersion: 5, goalWorkflowVersion: 2,
      createdBy: owner.id, hrOwnerId: owner.id, ...data } });
  }

  async function task(cycleId: string, owner: AuthUser, status: TaskStatus = 'self_eval') {
    const employee = await db.user.create({ data: { name: label('employee'), employeeNo: label('no'), status: 'active' } });
    const root = await db.assessmentTask.create({ data: { cycleId, employeeId: employee.id, managerId: owner.id, status } });
    const period = await db.assessmentPeriod.create({ data: {
      taskId: root.id, periodKey: '2038-01', periodType: 'month', sequence: 1, periodStart: start, periodEnd: end,
      selfEvalOpenAt: start, selfEvalDueAt: end, managerDueAt: end, managerId: owner.id,
    } });
    await db.selfEvalSummary.create({ data: { taskId: root.id, achievements: label('draft'), attachments: [] } });
    await db.managerEvalSummary.create({ data: { taskId: root.id, strengths: label('manager_draft') } });
    await db.flowRecord.create({ data: { taskId: root.id, cycleId, actorId: owner.id,
      nodeType: 'self_eval', action: 'comment', comment: label('history') } });
    return { root, period, employee };
  }

  async function change(taskId: string, owner: AuthUser) {
    return db.goalChangeRequest.create({ data: { taskId, creatorId: owner.id, reason: label('change'),
      beforeGoals: [{ name: 'CT_before', weight: 1 }], goals: [{ name: 'CT_after', weight: 1 }] } });
  }

  async function reminder(taskId: string, cycleId: string, userId: string, status = 'pending') {
    return db.notificationLog.create({ data: { taskId, cycleId, userId, type: 'self_eval',
      title: label('reminder'), channel: 'in_app', status,
      ...(status === 'sent' ? { sentAt: start } : {}) } });
  }

  async function simpleFixture() {
    const owner = await actor();
    const parent = await cycle(owner);
    const first = await task(parent.id, owner);
    const pendingChange = await change(first.root.id, owner);
    const pendingReminder = await reminder(first.root.id, parent.id, first.employee.id);
    return { owner, parent, first, pendingChange, pendingReminder };
  }

  async function terminate(cycleId: string, viewer: AuthUser, instance = service) {
    const preview = await instance.preview(cycleId, viewer);
    return instance.terminate(cycleId, { reason, expectedPreviewHash: preview.previewHash }, viewer);
  }

  async function audit(id: string) {
    return db.auditLog.findMany({ where: { entityId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  async function mixedFixture() {
    const owner = await actor();
    const parent = await cycle(owner, { status: 'published', publishedAt: start });
    const eligible = [await task(parent.id, owner), await task(parent.id, owner, 'approval')];
    const approved = await task(parent.id, owner, 'approval');
    await db.gradeResult.create({ data: { taskId: approved.root.id, calculatedScore: '88.25', calibratedGrade: 'B',
      approverId: owner.id, approvedAt: start, coefficient: '1.0500', calibrationNote: label('approved_fact') } });
    const published = await task(parent.id, owner, 'published');
    await db.gradeResult.create({ data: { taskId: published.root.id, calculatedScore: '92.50', calibratedGrade: 'A',
      isPublished: true, publishedAt: start, coefficient: '1.1000' } });
    await db.appeal.create({ data: { taskId: published.root.id, cycleId: parent.id,
      appellantId: published.employee.id, reason: label('appeal'), attachments: [] } });
    const confirmed = await task(parent.id, owner, 'confirmed');
    const exempted = await task(parent.id, owner, 'exempted');
    await db.assessmentTask.update({ where: { id: exempted.root.id }, data: { isExempt: true, exemptReason: label('exempt') } });
    const closed = await task(parent.id, owner, 'closed');
    const protectedTasks = [approved, published, confirmed, exempted, closed];
    const ended = [await task(parent.id, owner), await task(parent.id, owner)];
    for (const entry of ended) await db.assessmentTask.update({ where: { id: entry.root.id }, data: {
      lifecycleStatus: 'terminated', lifecycleVersion: 1, terminatedAt: start, terminatedById: owner.id,
      terminationReason: label('previous_termination'),
    } });
    await db.assessmentTask.update({ where: { id: ended[1].root.id }, data: {
      lifecycleStatus: 'deleted', lifecycleVersion: 2, deletedAt: start, deletedById: owner.id,
      deletionReason: label('previous_archive'),
    } });
    const version = await db.indicatorVersion.create({ data: { taskId: eligible[0].root.id, version: 1,
      status: 'active', effectiveFromPeriodKey: '2038-01', createdById: owner.id, activatedAt: start } });
    const effectiveChange = await db.goalChangeRequest.create({ data: { taskId: eligible[0].root.id,
      creatorId: owner.id, status: 'active', effectiveVersionId: version.id, beforeGoals: [], goals: [{ name: 'CT_effective' }] } });
    const pendingChanges = [await change(eligible[0].root.id, owner), await change(eligible[1].root.id, owner)];
    pendingChanges[1] = await db.goalChangeRequest.update({ where: { id: pendingChanges[1].id },
      data: { status: 'indicator_reviewing', revision: 1 } });
    await change(approved.root.id, owner);
    const cancelled = [await reminder(eligible[0].root.id, parent.id, eligible[0].employee.id),
      await reminder(eligible[1].root.id, parent.id, eligible[1].employee.id, 'failed')];
    const sent = await reminder(eligible[0].root.id, parent.id, eligible[0].employee.id, 'sent');
    await reminder(approved.root.id, parent.id, approved.employee.id);
    const generalReminder = await db.notificationLog.create({ data: { cycleId: parent.id, userId: owner.id,
      type: 'CT_cycle_notice', title: label('non_task_notice'), channel: 'in_app' } });
    const other = await cycle(owner);
    const otherTask = await task(other.id, owner);
    await change(otherTask.root.id, owner);
    await reminder(otherTask.root.id, other.id, otherTask.employee.id);
    const plan = await db.improvementPlan.create({ data: { employeeId: eligible[0].employee.id,
      cycleId: parent.id, taskId: eligible[0].root.id, creatorId: owner.id, workflowVersion: 3,
      improvementGoal: label('independent_improvement') } });
    const confirmation = await db.confirmationApplication.create({ data: { employeeId: eligible[0].employee.id,
      createdBy: owner.id, workflowVersion: 2 } });
    const subject = await db.contractSubject.create({ data: { name: label('payroll_subject') } });
    const batch = await db.payrollBatch.create({ data: { subjectId: subject.id, month: '2038-01',
      payMonth: '2038-02', purpose: 'trial', createdById: owner.id } });
    const payrollVersion = await db.payrollVersion.create({ data: { batchId: batch.id, version: 1,
      sourceHash: 'c'.repeat(64), sources: { taskId: eligible[0].root.id }, approvalPath: [], reviewerCount: 0,
      calculatedById: owner.id, gross: '123.45' } });
    const payrollLine = await db.payrollLine.create({ data: { versionId: payrollVersion.id,
      employeeId: eligible[0].employee.id, attributionMonth: '2038-01', itemCode: 'personal_performance',
      amount: '123.45', evidence: { taskId: eligible[0].root.id } } });
    return { owner, parent, eligible, protectedTasks, ended, effectiveChange, pendingChanges, cancelled, sent,
      generalReminder, other, plan, confirmation, batch, payrollVersion, payrollLine };
  }

  it('previews every task without writes and terminates only eligible records atomically', async () => {
    const f = await mixedFixture();
    const allBefore = await cycleSnapshot(db, f.parent.id);
    const protectedBefore: Array<Record<string, string>> = [];
    for (const entry of [...f.protectedTasks, ...f.ended]) protectedBefore.push(await taskSnapshot(db, entry.root.id));
    const eligibleBefore: Array<{ content: string; children: Record<string, string> }> = [];
    for (const entry of f.eligible) eligibleBefore.push({
      content: await lifecycleContent(db, 'assessment_tasks', entry.root.id), children: await taskSnapshot(db, entry.root.id),
    });
    const changeContents: string[] = [];
    for (const request of f.pendingChanges) changeContents.push(await lifecycleContent(db, 'goal_change_requests', request.id));
    const outsideBefore = {
      other: await cycleSnapshot(db, f.other.id),
      effective: await snapshotRows(db, 'goal_change_requests', Prisma.sql`r.id=${f.effectiveChange.id}::uuid`),
      plan: await snapshotRows(db, 'improvement_plans', Prisma.sql`r.id=${f.plan.id}::uuid`),
      confirmation: await snapshotRows(db, 'confirmation_applications', Prisma.sql`r.id=${f.confirmation.id}::uuid`),
      payrollBatch: await snapshotRows(db, 'payroll_batches', Prisma.sql`r.id=${f.batch.id}::uuid`),
      payrollVersion: await snapshotRows(db, 'payroll_versions', Prisma.sql`r.id=${f.payrollVersion.id}::uuid`),
      payrollLine: await snapshotRows(db, 'payroll_lines', Prisma.sql`r.id=${f.payrollLine.id}::uuid`),
      sent: await snapshotRows(db, 'notification_logs', Prisma.sql`r.id=${f.sent.id}::uuid`),
      general: await snapshotRows(db, 'notification_logs', Prisma.sql`r.id=${f.generalReminder.id}::uuid`),
    };
    const preview = await service.preview(f.parent.id, f.owner);
    expect(preview).toMatchObject({ cycle: { id: f.parent.id, name: f.parent.name, status: 'published',
      planVersion: 1, terminatedAt: null }, canTerminate: true,
      summary: { total: 9, terminable: 2, protected: 5, alreadyEnded: 2, goalChanges: 2, reminders: 2 } });
    expect(preview.previewHash).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.tasks).toHaveLength(9);
    for (const [entries, disposition] of [[f.eligible, 'terminate'], [f.protectedTasks, 'protected'],
      [f.ended, 'already_ended']] as const) {
      for (const entry of entries) {
        expect(preview.tasks.find((row) => row.id === entry.root.id)).toMatchObject({
          employeeName: entry.employee.name, employeeNo: entry.employee.employeeNo,
          status: entry.root.status, disposition, reason: expect.any(String), lifecycleStatus: expect.any(String),
        });
      }
    }
    expect((await service.preview(f.parent.id, f.owner)).previewHash).toBe(preview.previewHash);
    expect(await cycleSnapshot(db, f.parent.id)).toEqual(allBefore);

    await service.terminate(f.parent.id, { reason, expectedPreviewHash: preview.previewHash }, f.owner);
    const stopped = await db.assessmentCycle.findUniqueOrThrow({ where: { id: f.parent.id } });
    expect(stopped).toMatchObject({ status: 'published', planVersion: 1, terminatedAt: expect.any(Date),
      terminatedById: f.owner.id, terminationReason: reason, terminationVersion: 1 });
    for (const [index, entry] of f.eligible.entries()) {
      expect(await db.assessmentTask.findUniqueOrThrow({ where: { id: entry.root.id } })).toMatchObject({
        status: entry.root.status, lifecycleStatus: 'terminated', lifecycleVersion: 1,
        terminatedAt: expect.any(Date), terminatedById: f.owner.id, terminationReason: reason,
      });
      expect(await audit(entry.root.id)).toHaveLength(1);
      expect((await audit(entry.root.id))[0]).toMatchObject({ userId: f.owner.id, action: 'lifecycle_terminated' });
      expect(await lifecycleContent(db, 'assessment_tasks', entry.root.id)).toBe(eligibleBefore[index].content);
      const after = await taskSnapshot(db, entry.root.id);
      for (const key of Object.keys(after).filter((name) => !['assessment_tasks', 'goal_change_requests', 'notification_logs', 'audit'].includes(name))) {
        expect(after[key]).toBe(eligibleBefore[index].children[key]);
      }
      expect(await db.selfEvalSummary.findUniqueOrThrow({ where: { taskId: entry.root.id } }))
        .toMatchObject({ achievements: expect.stringMatching(/^CT_draft_/), submittedAt: null });
    }
    for (const [index, request] of f.pendingChanges.entries()) {
      expect(await db.goalChangeRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({
        status: request.status, lifecycleStatus: 'terminated', lifecycleVersion: 1,
        beforeGoals: request.beforeGoals, goals: request.goals, reason: request.reason,
      });
      expect(await audit(request.id)).toHaveLength(1);
      expect((await audit(request.id))[0]).toMatchObject({ userId: f.owner.id, action: 'lifecycle_terminated' });
      expect(await lifecycleContent(db, 'goal_change_requests', request.id)).toBe(changeContents[index]);
    }
    for (const row of f.cancelled) expect(await db.notificationLog.findUniqueOrThrow({ where: { id: row.id } }))
      .toMatchObject({ status: 'cancelled', title: row.title, userId: row.userId, sentAt: null });
    const cycleAudit = await audit(f.parent.id);
    expect(cycleAudit).toHaveLength(1);
    expect(cycleAudit[0]).toMatchObject({ userId: f.owner.id, action: 'cycle_terminated',
      newValue: expect.objectContaining({ reason, expectedPreviewHash: preview.previewHash, terminatedCount: 2,
        protectedCount: 5, alreadyEndedCount: 2, cancelledGoalChangeCount: 2 }) });
    for (const [index, entry] of [...f.protectedTasks, ...f.ended].entries()) {
      expect(await taskSnapshot(db, entry.root.id)).toEqual(protectedBefore[index]);
    }
    expect({
      other: await cycleSnapshot(db, f.other.id),
      effective: await snapshotRows(db, 'goal_change_requests', Prisma.sql`r.id=${f.effectiveChange.id}::uuid`),
      plan: await snapshotRows(db, 'improvement_plans', Prisma.sql`r.id=${f.plan.id}::uuid`),
      confirmation: await snapshotRows(db, 'confirmation_applications', Prisma.sql`r.id=${f.confirmation.id}::uuid`),
      payrollBatch: await snapshotRows(db, 'payroll_batches', Prisma.sql`r.id=${f.batch.id}::uuid`),
      payrollVersion: await snapshotRows(db, 'payroll_versions', Prisma.sql`r.id=${f.payrollVersion.id}::uuid`),
      payrollLine: await snapshotRows(db, 'payroll_lines', Prisma.sql`r.id=${f.payrollLine.id}::uuid`),
      sent: await snapshotRows(db, 'notification_logs', Prisma.sql`r.id=${f.sent.id}::uuid`),
      general: await snapshotRows(db, 'notification_logs', Prisma.sql`r.id=${f.generalReminder.id}::uuid`),
    }).toEqual(outsideBefore);
  });

  it.each(['hr', 'system_admin', 'hr_user'] as const)('does not implicitly grant cycle_terminate to %s', async (sysRole) => {
    const viewer = await actor({ sysRole, hrCapabilities: [] });
    const parent = await cycle(viewer);
    await task(parent.id, viewer);
    const before = await cycleSnapshot(db, parent.id);
    await expect(service.preview(parent.id, viewer)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.terminate(parent.id, { reason, expectedPreviewHash: 'a'.repeat(64) }, viewer))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(await cycleSnapshot(db, parent.id)).toEqual(before);
  });

  it('limits explicitly authorized non-global operators to their owned cycles, not createdBy or canViewAll', async () => {
    const owner = await actor();
    const stranger = await actor({ canViewAll: true });
    const parent = await cycle(owner, { createdBy: stranger.id });
    await task(parent.id, owner);
    const preview = await service.preview(parent.id, owner);
    const before = await cycleSnapshot(db, parent.id);
    await expect(service.preview(parent.id, stranger)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.terminate(parent.id, { reason, expectedPreviewHash: preview.previewHash }, stranger))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(await cycleSnapshot(db, parent.id)).toEqual(before);
    await service.terminate(parent.id, { reason, expectedPreviewHash: preview.previewHash }, owner);
  });

  it.each(['hr', 'system_admin'] as const)('allows explicit global %s to manage another owner without expanding scope by role alone', async (sysRole) => {
    const owner = await actor();
    const global = await actor({ sysRole });
    const parent = await cycle(owner);
    await task(parent.id, owner);
    await terminate(parent.id, global);
    expect(await db.assessmentCycle.findUniqueOrThrow({ where: { id: parent.id } }))
      .toMatchObject({ terminatedById: global.id });
  });

  it('does not let an assessor-only account terminate even with an explicit capability and ownership', async () => {
    const viewer = await actor({ isAssessorOnly: true });
    const parent = await cycle(viewer);
    await task(parent.id, viewer);
    const before = await cycleSnapshot(db, parent.id);
    await expect(service.preview(parent.id, viewer)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.terminate(parent.id, { reason, expectedPreviewHash: 'a'.repeat(64) }, viewer))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(await cycleSnapshot(db, parent.id)).toEqual(before);
  });

  it('allows an appeal-stage cycle to stop remaining work without touching its published result', async () => {
    const owner = await actor();
    const parent = await cycle(owner, { status: 'appeal', publishedAt: start });
    const eligible = await task(parent.id, owner);
    const protectedTask = await task(parent.id, owner, 'appealing');
    await db.gradeResult.create({ data: { taskId: protectedTask.root.id, isPublished: true, publishedAt: start,
      calculatedScore: '79.25', calibratedGrade: 'C' } });
    const before = await taskSnapshot(db, protectedTask.root.id);
    await terminate(parent.id, owner);
    expect(await taskSnapshot(db, protectedTask.root.id)).toEqual(before);
    expect(await db.assessmentCycle.findUniqueOrThrow({ where: { id: parent.id } }))
      .toMatchObject({ status: 'appeal', publishedAt: start, terminatedAt: expect.any(Date) });
    expect(await db.assessmentTask.findUniqueOrThrow({ where: { id: eligible.root.id } }))
      .toMatchObject({ lifecycleStatus: 'terminated' });
  });

  it('rejects an all-protected cycle without recording a spurious termination', async () => {
    const owner = await actor();
    const parent = await cycle(owner);
    await task(parent.id, owner, 'confirmed');
    const before = await cycleSnapshot(db, parent.id);
    const preview = await service.preview(parent.id, owner);
    expect(preview).toMatchObject({ canTerminate: false, summary: { total: 1, terminable: 0, protected: 1 } });
    await expect(service.terminate(parent.id, { reason, expectedPreviewHash: preview.previewHash }, owner))
      .rejects.toBeInstanceOf(ConflictException);
    expect(await cycleSnapshot(db, parent.id)).toEqual(before);
  });

  it.each(['draft', 'scheduled', 'closed'] as const)('does not use cycle termination for %s cycles', async (status) => {
    const owner = await actor();
    const parent = await cycle(owner, { status, openedAt: status === 'closed' ? start : null });
    await task(parent.id, owner);
    const before = await cycleSnapshot(db, parent.id);
    await expect(service.terminate(parent.id, { reason, expectedPreviewHash: 'a'.repeat(64) }, owner))
      .rejects.toBeInstanceOf(ConflictException);
    expect(await cycleSnapshot(db, parent.id)).toEqual(before);
  });

  it.each([['empty', ''], ['whitespace', '   '], ['too_long', 'x'.repeat(1001)]])
  ('rejects invalid reasons without any writes: %s', async (_case, invalidReason) => {
    const f = await simpleFixture();
    const preview = await service.preview(f.parent.id, f.owner);
    const before = await cycleSnapshot(db, f.parent.id);
    await expect(service.terminate(f.parent.id, { reason: invalidReason, expectedPreviewHash: preview.previewHash }, f.owner))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(await cycleSnapshot(db, f.parent.id)).toEqual(before);
  });

  it.each(['task_updated_at', 'lifecycle_version', 'approval_result', 'goal_change', 'reminder', 'plan_version'] as const)
  ('rejects a stale preview when %s changes, without partial termination', async (field) => {
    const f = await simpleFixture();
    const preview = await service.preview(f.parent.id, f.owner);
    switch (field) {
      case 'task_updated_at': await db.assessmentTask.update({ where: { id: f.first.root.id },
        data: { updatedAt: new Date(f.first.root.updatedAt.getTime() + 1) } }); break;
      case 'lifecycle_version': await db.assessmentTask.update({ where: { id: f.first.root.id },
        data: { lifecycleVersion: { increment: 1 } } }); break;
      case 'approval_result': await db.gradeResult.create({ data: { taskId: f.first.root.id,
        approvedAt: start, approverId: f.owner.id } }); break;
      case 'goal_change': await db.goalChangeRequest.update({ where: { id: f.pendingChange.id },
        data: { revision: { increment: 1 }, goals: [{ name: 'CT_revised' }] } }); break;
      case 'reminder': await db.notificationLog.update({ where: { id: f.pendingReminder.id }, data: { status: 'failed' } }); break;
      case 'plan_version': await db.assessmentCycle.update({ where: { id: f.parent.id }, data: { planVersion: { increment: 1 } } }); break;
    }
    const changed = await cycleSnapshot(db, f.parent.id);
    expect((await service.preview(f.parent.id, f.owner)).previewHash).not.toBe(preview.previewHash);
    await expect(service.terminate(f.parent.id, { reason, expectedPreviewHash: preview.previewHash }, f.owner))
      .rejects.toBeInstanceOf(ConflictException);
    expect(await cycleSnapshot(db, f.parent.id)).toEqual(changed);
  });

  it('binds preview hashes to the cycle instead of accepting another cycle with matching counts', async () => {
    const f = await simpleFixture();
    const other = await cycle(f.owner);
    await task(other.id, f.owner);
    const preview = await service.preview(f.parent.id, f.owner);
    const before = await cycleSnapshot(db, other.id);
    await expect(service.terminate(other.id, { reason, expectedPreviewHash: preview.previewHash }, f.owner))
      .rejects.toBeInstanceOf(ConflictException);
    expect(await cycleSnapshot(db, other.id)).toEqual(before);
  });

  it('retains a newly saved draft without inventing a formal impact conflict', async () => {
    const f = await simpleFixture();
    const preview = await service.preview(f.parent.id, f.owner);
    const saved = await db.assessmentPeriod.update({ where: { id: f.first.period.id },
      data: { draftVersion: { increment: 1 }, employeeAttachments: [{ name: 'CT_fictional_saved_draft' }] } });
    const summary = await db.selfEvalSummary.update({ where: { taskId: f.first.root.id },
      data: { achievements: 'CT_latest_saved_draft_preserved' } });
    expect((await service.preview(f.parent.id, f.owner)).previewHash).toBe(preview.previewHash);
    await service.terminate(f.parent.id, { reason, expectedPreviewHash: preview.previewHash }, f.owner);
    expect(await db.assessmentPeriod.findUniqueOrThrow({ where: { id: saved.id } })).toEqual(saved);
    expect(await db.selfEvalSummary.findUniqueOrThrow({ where: { taskId: f.first.root.id } })).toEqual(summary);
  });

  it('lets two normal monthly submissions aggregate the same active cycle without lock-upgrade deadlock', async () => {
    const owner = await actor();
    const parent = await cycle(owner);
    const first = await task(parent.id, owner), other = await task(parent.id, owner);
    const ready = [gate(), gate()], aggregate = gate();
    const flow = new FlowService(db as any);
    const writes = [first, other].map((entry, index) => [db, second][index].$transaction(async tx => {
      await lockLifecycleRow(tx, 'task', entry.root.id);
      await tx.assessmentPeriod.update({ where: { id: entry.period.id },
        data: { status: 'manager_scoring', employeeSubmittedAt: start } });
      await tx.assessmentTask.update({ where: { id: entry.root.id }, data: { status: 'manager_scoring' } });
      ready[index].resolve();
      await aggregate.promise;
      await flow.syncCycleStage(tx, parent.id);
    }, transactionBudget));
    try { await bounded(Promise.all(ready.map(item => item.promise)), 'both period writes acquired compatible cycle locks'); }
    finally { aggregate.resolve(); }
    const results = await Promise.allSettled(writes);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await db.assessmentCycle.findUniqueOrThrow({ where: { id: parent.id } })).toMatchObject({ status: 'manager_score' });
  });

  it('rejects an already queued deadline edit after termination commits', async () => {
    const f = await simpleFixture();
    f.owner.hrCapabilities = ['cycle_terminate', 'cycle_plan_edit'];
    await db.user.update({ where: { id: f.owner.id }, data: { hrCapabilities: f.owner.hrCapabilities } });
    const held = gate(), release = gate(), began = gate();
    let blocker = 0, waiter = 0;
    const endingService = new CycleTerminationService(observedTransactions(db, {
      begin: pid => { blocker = pid; }, beforeCommit: async () => { held.resolve(); await release.promise; },
    }) as any);
    const ending = terminate(f.parent.id, f.owner, endingService);
    await bounded(Promise.race([held.promise, ending]), 'termination holds cycle write lock');
    const edits = new CyclesService(observedTransactions(second, { begin: pid => { waiter = pid; began.resolve(); } }) as any, {} as any);
    const editing = edits.updateDeadlines(f.parent.id, { expectedPlanVersion: f.parent.planVersion,
      deadlineSelfEval: new Date('2038-02-05') }, f.owner).then(value => ({ value }), error => ({ error }));
    await verifyQueueAndRelease(db, began.promise, () => ({ waiter, blocker }), release.resolve, [ending, editing]);
    await ending;
    expect((await editing as { error?: unknown }).error).toBeInstanceOf(ConflictException);
    expect(await db.assessmentCycle.findUniqueOrThrow({ where: { id: f.parent.id } })).toMatchObject({
      deadlineSelfEval: null, planVersion: f.parent.planVersion, terminatedAt: expect.any(Date),
    });
  });

  it('keeps terminated cycle configuration read-only even through an older client', async () => {
    const f = await simpleFixture();
    await terminate(f.parent.id, f.owner);
    await expectWriteFence(db.$executeRaw`UPDATE assessment_cycles SET deadline_self_eval=${end} WHERE id=${f.parent.id}::uuid`);
    // A protected result may still advance its original publication stage.
    await db.assessmentCycle.update({ where: { id: f.parent.id }, data: { status: 'published', publishedAt: start, deadlineAppeal: end } });
    expect(await db.assessmentCycle.findUniqueOrThrow({ where: { id: f.parent.id } })).toMatchObject({ status: 'published', terminatedAt: expect.any(Date) });
    await db.assessmentCycle.update({ where: { id: f.parent.id }, data: { status: 'closed', closedAt: end } });
    expect(await db.assessmentCycle.findUniqueOrThrow({ where: { id: f.parent.id } })).toMatchObject({ status: 'closed', closedAt: end });
  });

  it.each(['employee_submit', 'monthly_submit', 'approve_result'] as const)('%s winning the real period/task locks makes queued termination return 409', async (action) => {
    const f = await simpleFixture();
    const companion = await task(f.parent.id, f.owner);
    const preview = await service.preview(f.parent.id, f.owner);
    const held = gate(), release = gate(), began = gate();
    let blocker = 0, waiter = 0;
    let committedSnapshot: unknown;
    const winning = db.$transaction(async (tx) => {
      blocker = await backendPid(tx);
      await lockLifecycleRow(tx, 'task', f.first.root.id);
      if (action === 'employee_submit' || action === 'monthly_submit') {
        if (action === 'employee_submit') {
          await claimTaskVersion(tx, f.first.root.id, f.first.root.updatedAt.toISOString(), 'self_eval');
          await tx.assessmentTask.update({ where: { id: f.first.root.id },
            data: { status: 'manager_scoring', selfEvalSubmittedAt: start } });
        }
        // Monthly submissions can leave the parent task/cycle unchanged.
        await tx.assessmentPeriod.update({ where: { id: f.first.period.id }, data: { status: 'manager_scoring', employeeSubmittedAt: start } });
        await tx.selfEvalSummary.update({ where: { taskId: f.first.root.id }, data: { submittedAt: start, achievements: 'CT_committed_submission' } });
      } else {
        // Only the result row changes: approval facts must invalidate the hash independently of task.updatedAt.
        await tx.gradeResult.create({ data: { taskId: f.first.root.id, calculatedScore: '87.75',
          calibratedGrade: 'B', approvedAt: start, approverId: f.owner.id } });
      }
      committedSnapshot = await cycleSnapshot(tx, f.parent.id);
      held.resolve();
      await release.promise;
    }, transactionBudget);
    await bounded(Promise.race([held.promise, winning]), 'winning write acquired locks');
    const queued = new CycleTerminationService(observedTransactions(second, {
      begin: (pid) => { waiter = pid; began.resolve(); },
    }) as any);
    const losing = queued.terminate(f.parent.id, { reason, expectedPreviewHash: preview.previewHash }, f.owner)
      .then((value) => ({ value }), (error) => ({ error }));
    await verifyQueueAndRelease(db, began.promise, () => ({ waiter, blocker }), release.resolve, [winning, losing]);
    await winning;
    expect((await losing as { error?: unknown }).error).toBeInstanceOf(ConflictException);
    expect(await cycleSnapshot(db, f.parent.id)).toEqual(committedSnapshot);
    expect(await db.assessmentTask.findUniqueOrThrow({ where: { id: companion.root.id } }))
      .toMatchObject({ lifecycleStatus: 'active' });
  });

  it.each(['raw_child_save', 'versioned_submit'] as const)('termination winning real locks rejects a queued %s without saving input', async (action) => {
    const f = await simpleFixture();
    const held = gate(), release = gate(), began = gate();
    let blocker = 0, waiter = 0;
    const endingService = new CycleTerminationService(observedTransactions(db, {
      begin: (pid) => { blocker = pid; },
      beforeCommit: async () => { held.resolve(); await release.promise; },
    }) as any);
    const ending = terminate(f.parent.id, f.owner, endingService);
    await bounded(Promise.race([held.promise, ending.then(() => { throw new Error('Termination did not hold its commit'); })]),
      'termination acquired locks and wrote');
    const writing = second.$transaction(async (tx) => {
      waiter = await backendPid(tx);
      began.resolve();
      if (action === 'versioned_submit') await claimTaskVersion(tx, f.first.root.id, f.first.root.updatedAt.toISOString(), 'self_eval');
      // A direct SQL writer must be fenced too, not only the application version helper.
      return tx.$executeRaw`UPDATE self_eval_summaries SET achievements='CT_late_unsaved_input'
        WHERE task_id=${f.first.root.id}::uuid`;
    }, transactionBudget).then((value) => ({ value }), (error) => ({ error }));
    await verifyQueueAndRelease(db, began.promise, () => ({ waiter, blocker }), release.resolve, [ending, writing]);
    await ending;
    const result = await writing;
    await expectWriteFence('error' in result ? Promise.reject(result.error) : Promise.resolve(result.value));
    expect(await db.selfEvalSummary.findUniqueOrThrow({ where: { taskId: f.first.root.id } }))
      .toMatchObject({ achievements: expect.stringMatching(/^CT_draft_/), submittedAt: null });
    expect(await audit(f.parent.id)).toHaveLength(1);
  });

  it.each(['capability', 'deactivate', 'scope'] as const)('rejects a queued termination after %s revocation commits', async (revocation) => {
    const f = await simpleFixture();
    const preview = await service.preview(f.parent.id, f.owner);
    const held = gate(), release = gate(), began = gate();
    let blocker = 0, waiter = 0;
    const replacement = revocation === 'scope' ? await actor() : null;
    let revokedSnapshot: unknown;
    const revoking = db.$transaction(async (tx) => {
      blocker = await backendPid(tx);
      if (revocation === 'scope') await tx.assessmentCycle.update({ where: { id: f.parent.id }, data: { hrOwnerId: replacement!.id } });
      else await tx.user.update({ where: { id: f.owner.id }, data: revocation === 'capability'
        ? { hrCapabilities: [] } : { status: 'resigned' } });
      revokedSnapshot = await cycleSnapshot(tx, f.parent.id);
      held.resolve(); await release.promise;
    }, transactionBudget);
    await bounded(Promise.race([held.promise, revoking]), 'revocation holds target row');
    const queued = new CycleTerminationService(observedTransactions(second, {
      begin: (pid) => { waiter = pid; began.resolve(); },
    }) as any);
    const ending = queued.terminate(f.parent.id, { reason, expectedPreviewHash: preview.previewHash }, f.owner)
      .then((value) => ({ value }), (error) => ({ error }));
    await verifyQueueAndRelease(db, began.promise, () => ({ waiter, blocker }), release.resolve, [revoking, ending]);
    await revoking;
    expect((await ending as { error?: unknown }).error).toBeInstanceOf(ForbiddenException);
    expect(await cycleSnapshot(db, f.parent.id)).toEqual(revokedSnapshot);
  });

  it('fences post-termination task INSERT and cross-cycle transfer but lets another cycle keep writing', async () => {
    const f = await simpleFixture();
    const other = await cycle(f.owner);
    const otherTask = await task(other.id, f.owner);
    const extraEmployee = await db.user.create({ data: { name: label('late_employee') } });
    await terminate(f.parent.id, f.owner);
    const stopped = await cycleSnapshot(db, f.parent.id);
    await expectWriteFence(db.$executeRaw`INSERT INTO assessment_tasks(cycle_id, employee_id)
      VALUES(${f.parent.id}::uuid, ${extraEmployee.id}::uuid)`);
    await expectWriteFence(db.$executeRaw`UPDATE assessment_tasks SET cycle_id=${f.parent.id}::uuid
      WHERE id=${otherTask.root.id}::uuid`);
    expect(await cycleSnapshot(db, f.parent.id)).toEqual(stopped);
    expect(await db.assessmentTask.findUniqueOrThrow({ where: { id: otherTask.root.id } }))
      .toMatchObject({ cycleId: other.id, lifecycleStatus: 'active' });
    await db.selfEvalSummary.update({ where: { taskId: otherTask.root.id }, data: { achievements: 'CT_other_cycle_can_save' } });
    const added = await db.assessmentTask.create({ data: { cycleId: other.id, employeeId: extraEmployee.id } });
    expect(added.lifecycleStatus).toBe('active');
    expect(await db.selfEvalSummary.findUniqueOrThrow({ where: { taskId: otherTask.root.id } }))
      .toMatchObject({ achievements: 'CT_other_cycle_can_save' });
  });

  it('rejects task creation already queued behind the terminating cycle row lock', async () => {
    const f = await simpleFixture();
    const newcomer = await db.user.create({ data: { name: label('queued_newcomer') } });
    const held = gate(), release = gate(), began = gate();
    let blocker = 0, waiter = 0;
    const endingService = new CycleTerminationService(observedTransactions(db, {
      begin: (pid) => { blocker = pid; }, beforeCommit: async () => { held.resolve(); await release.promise; },
    }) as any);
    const ending = terminate(f.parent.id, f.owner, endingService);
    await bounded(Promise.race([held.promise, ending.then(() => { throw new Error('Missing held termination'); })]), 'cycle lock held');
    const creating = second.$transaction(async (tx) => {
      waiter = await backendPid(tx); began.resolve();
      return tx.$executeRaw`INSERT INTO assessment_tasks(cycle_id, employee_id)
        VALUES(${f.parent.id}::uuid, ${newcomer.id}::uuid)`;
    }, transactionBudget).then((value) => ({ value }), (error) => ({ error }));
    await verifyQueueAndRelease(db, began.promise, () => ({ waiter, blocker }), release.resolve, [ending, creating]);
    await ending;
    const result = await creating;
    await expectWriteFence('error' in result ? Promise.reject(result.error) : Promise.resolve(result.value));
    expect(await db.assessmentTask.count({ where: { cycleId: f.parent.id, employeeId: newcomer.id } })).toBe(0);
    expect(await audit(f.parent.id)).toHaveLength(1);
  });

  it.each([
    ['missing_reason', null, 1], ['blank_reason', '   ', 1], ['missing_version', 'CT_reason', 0],
  ] as const)('database CHECK rejects malformed cycle termination metadata: %s', async (_case, invalidReason, version) => {
    const owner = await actor();
    const parent = await cycle(owner);
    const before = await cycleSnapshot(db, parent.id);
    await expectWriteFence(db.$executeRaw`UPDATE assessment_cycles SET terminated_at=${start},
      terminated_by_id=${owner.id}::uuid, termination_reason=${invalidReason}, termination_version=${version}
      WHERE id=${parent.id}::uuid`);
    expect(await cycleSnapshot(db, parent.id)).toEqual(before);
  });

  it('rolls back tasks, goal changes, reminders, cycle metadata and audits together on a late transaction failure', async () => {
    const f = await simpleFixture();
    await task(f.parent.id, f.owner);
    const before = await cycleSnapshot(db, f.parent.id);
    const fault = new Error('CT_injected_failure_after_real_database_writes');
    let inspectedWrites = false;
    const failing = new CycleTerminationService(observedTransactions(db, { beforeCommit: async (tx) => {
      expect(await tx.assessmentTask.count({ where: { cycleId: f.parent.id, lifecycleStatus: 'terminated' } })).toBe(2);
      expect(await tx.goalChangeRequest.findUniqueOrThrow({ where: { id: f.pendingChange.id } }))
        .toMatchObject({ lifecycleStatus: 'terminated' });
      expect(await tx.notificationLog.findUniqueOrThrow({ where: { id: f.pendingReminder.id } })).toMatchObject({ status: 'cancelled' });
      expect(await tx.assessmentCycle.findUniqueOrThrow({ where: { id: f.parent.id } })).toMatchObject({ terminatedAt: expect.any(Date) });
      expect(await tx.auditLog.count({ where: { entityId: f.parent.id } })).toBe(1);
      inspectedWrites = true;
      throw fault;
    } }) as any);
    await expect(terminate(f.parent.id, f.owner, failing)).rejects.toBe(fault);
    expect(inspectedWrites).toBe(true);
    expect(await cycleSnapshot(db, f.parent.id)).toEqual(before);
    await terminate(f.parent.id, f.owner);
    expect(await audit(f.parent.id)).toHaveLength(1);
    expect(await audit(f.first.root.id)).toHaveLength(1);
    expect(await audit(f.pendingChange.id)).toHaveLength(1);
  });

  it('serializes concurrent termination retries into one set of lifecycle transitions and audits', async () => {
    const f = await simpleFixture();
    const preview = await service.preview(f.parent.id, f.owner);
    const input = { reason, expectedPreviewHash: preview.previewHash };
    const held = gate(), release = gate(), began = gate();
    let blocker = 0, waiter = 0;
    const firstService = new CycleTerminationService(observedTransactions(db, {
      begin: (pid) => { blocker = pid; }, beforeCommit: async () => { held.resolve(); await release.promise; },
    }) as any);
    const first = firstService.terminate(f.parent.id, input, f.owner);
    await bounded(Promise.race([held.promise, first.then(() => { throw new Error('Missing held transaction'); })]), 'first termination holds locks');
    const queued = new CycleTerminationService(observedTransactions(second, { begin: (pid) => { waiter = pid; began.resolve(); } }) as any);
    const retry = queued.terminate(f.parent.id, input, f.owner).then((value) => ({ value }), (error) => ({ error }));
    await verifyQueueAndRelease(db, began.promise, () => ({ waiter, blocker }), release.resolve, [first, retry]);
    await first;
    expect((await retry as { error?: unknown }).error).toBeInstanceOf(ConflictException);
    const once = await cycleSnapshot(db, f.parent.id);
    await expect(service.terminate(f.parent.id, input, f.owner)).rejects.toBeInstanceOf(ConflictException);
    expect(await cycleSnapshot(db, f.parent.id)).toEqual(once);
    for (const id of [f.parent.id, f.first.root.id, f.pendingChange.id]) expect(await audit(id)).toHaveLength(1);
    expect(await db.assessmentTask.findUniqueOrThrow({ where: { id: f.first.root.id } })).toMatchObject({ lifecycleVersion: 1 });
  });
});
