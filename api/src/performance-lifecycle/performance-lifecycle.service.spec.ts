import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PerformanceLifecycleService } from './performance-lifecycle.service';

const at = new Date('2026-11-26T00:00:00.000Z');
const viewer = { id: 'hr', sysRole: 'hr', isAssessorOnly: false } as any;
const input = { expectedUpdatedAt: at.toISOString(), expectedLifecycleVersion: 0, reason: 'Duplicate unfinished record' };

describe('performance lifecycle mutations', () => {
  let service: PerformanceLifecycleService;
  let row: any;
  let db: any;
  let view: any;
  let goalView: any;
  const specialist = { id: 'specialist', sysRole: 'hr_user', isAssessorOnly: false, canViewAll: false,
    hrCapabilities: ['cycle_plan_edit', 'performance_publish', 'performance_lifecycle_terminate', 'performance_lifecycle_delete'] } as any;
  beforeEach(() => {
    row = { id: 'record', status: 'self_eval', employeeId: 'employee', lifecycleStatus: 'active', lifecycleVersion: 0,
      updatedAt: at, goalApprovedAt: at, employmentRecordId: 'employment' };
    db = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'record' }]),
      user: { findUnique: jest.fn().mockResolvedValue({ ...viewer, status: 'active', deletedAt: null, archivedAt: null }) },
      assessmentTask: { findUnique: jest.fn(async () => ({ ...row })), updateMany: jest.fn(async ({ where, data }) => {
        if (where.lifecycleVersion !== row.lifecycleVersion) return { count: 0 };
        Object.assign(row, data, { lifecycleVersion: row.lifecycleVersion + 1 });
        return { count: 1 };
      }) },
      goalChangeRequest: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
      notificationLog: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    db.$transaction = (fn: any) => fn(db);
    view = { findOne: jest.fn().mockResolvedValue({}) };
    goalView = { findOne: jest.fn().mockRejectedValue(new ForbiddenException()) };
    service = new PerformanceLifecycleService(db, view, view, view, view, goalView);
  });
  it('terminates under the existing task row lock without changing effective goals or status', async () => {
    const result = await service.mutate('task', 'record', 'terminate', input, viewer);
    expect(result.lifecycleStatus).toBe('terminated');
    expect(row.status).toBe('self_eval');
    expect(row.goalApprovedAt).toBe(at);
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      entityType: 'assessment_task', action: 'lifecycle_terminated',
    }) }));
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.assessmentTask.updateMany.mock.invocationCallOrder[0]);
  });
  it('rejects stale original business version even when lifecycle version is unchanged', async () => {
    row.updatedAt = new Date(at.getTime() + 1);
    await expect(service.mutate('task', 'record', 'terminate', input, viewer)).rejects.toThrow(ConflictException);
    expect(db.assessmentTask.updateMany).not.toHaveBeenCalled();
  });
  it('rechecks revoked management authority inside the transaction', async () => {
    db.user.findUnique.mockResolvedValue({ ...viewer, sysRole: 'hr_user', hrCapabilities: [], status: 'active' });
    await expect(service.mutate('task', 'record', 'terminate', input, viewer)).rejects.toThrow(ForbiddenException);
    expect(db.assessmentTask.updateMany).not.toHaveBeenCalled();
  });
  it('retains original detail/data-scope checks even for lifecycle managers', async () => {
    view.findOne.mockRejectedValue(new ForbiddenException());
    await expect(service.mutate('task', 'record', 'terminate', input, viewer)).rejects.toThrow(ForbiddenException);
    expect(db.assessmentTask.updateMany).not.toHaveBeenCalled();
  });
  it('does not repeat a termination or logically remove unfinished work', async () => {
    await expect(service.mutate('task', 'record', 'delete', input, viewer)).rejects.toThrow(ConflictException);
    row.lifecycleStatus = 'terminated';
    row.lifecycleVersion = 1;
    await expect(service.mutate('task', 'record', 'terminate', input, viewer)).rejects.toThrow(ConflictException);
  });
  function goalOnlyActor() {
    view.findOne.mockRejectedValue(new ForbiddenException('Full assessment is not in scope'));
    goalView.findOne.mockImplementation(async (_id, actor) => {
      if (!['cycle_plan_edit', 'performance_publish'].every(c => actor.hrCapabilities?.includes(c))) throw new ForbiddenException('Goal not in scope');
      return { id: row.id, currentHandlerId: 'employee', currentStep: 'employee_drafting' };
    });
    db.user.findUnique.mockResolvedValue({ ...specialist, status: 'active', deletedAt: null, archivedAt: null });
  }
  it('reads lifecycle metadata under the existing goal-only ledger scope without full assessment access', async () => {
    goalOnlyActor();
    await expect(service.findOne('task', 'record', specialist)).resolves.toMatchObject({
      id: 'record', allowedActions: ['lifecycle_terminate'],
    });
    expect(goalView.findOne).toHaveBeenCalledWith('record', specialist);
  });
  it('lets a goal-only specialist terminate then delete with reason, row lock, current scope and audit intact', async () => {
    goalOnlyActor();
    const first = await service.mutate('task', 'record', 'terminate', input, specialist);
    expect(first.lifecycleStatus).toBe('terminated');
    await expect(service.mutate('task', 'record', 'delete', { ...input,
      expectedLifecycleVersion: row.lifecycleVersion, expectedUpdatedAt: row.updatedAt.toISOString() }, specialist)).resolves.toMatchObject({ lifecycleStatus: 'deleted' });
    expect(row.status).toBe('self_eval'); expect(row.goalApprovedAt).toBe(at);
    expect(db.auditLog.create).toHaveBeenCalledTimes(2);
    expect(goalView.findOne).toHaveBeenCalledTimes(4);
  });
  it('does not turn lifecycle capability alone into a data-scope grant', async () => {
    goalOnlyActor(); const unscoped = { ...specialist, hrCapabilities: ['performance_lifecycle_terminate'] };
    await expect(service.findOne('task', 'record', unscoped)).rejects.toThrow(ForbiddenException);
    await expect(service.mutate('task', 'record', 'terminate', input, unscoped)).rejects.toThrow(ForbiddenException);
    expect(db.assessmentTask.updateMany).not.toHaveBeenCalled();
  });
  it('keeps unavailable frozen-reviewer warnings when goal-only access is used', async () => {
    goalOnlyActor();
    goalView.findOne.mockResolvedValue({ currentHandlerId: 'reviewer', currentStep: 'manager_review' });
    db.user.findMany = jest.fn().mockResolvedValue([]);
    await expect(service.findOne('task', 'record', specialist)).resolves.toMatchObject({ handoverRequired: true, unavailableReviewerIds: ['reviewer'] });
  });
  it('rechecks revoked goal-ledger scope even when lifecycle capability remains', async () => {
    goalOnlyActor();
    db.user.findUnique.mockResolvedValue({ ...specialist, status: 'active', hrCapabilities: ['performance_lifecycle_terminate'] });
    await expect(service.mutate('task', 'record', 'terminate', input, specialist)).rejects.toThrow(ForbiddenException);
    expect(db.assessmentTask.updateMany).not.toHaveBeenCalled();
  });
  it('does not use goal access after a missing object or infrastructure failure', async () => {
    for (const failure of [new NotFoundException(), new Error('unavailable')]) {
      view.findOne.mockRejectedValue(failure);
      await expect(service.findOne('task', 'record', specialist)).rejects.toBe(failure);
    }
    expect(goalView.findOne).not.toHaveBeenCalled();
  });
  it.each(['goal_change', 'improvement_plan', 'confirmation'] as const)('never uses goal access to bypass %s scope', async kind => {
    goalOnlyActor();
    await expect(service.findOne(kind, 'record', specialist)).rejects.toThrow(ForbiddenException);
    expect(goalView.findOne).not.toHaveBeenCalled();
  });
});
