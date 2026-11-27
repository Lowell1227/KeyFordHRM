import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { CycleDeletionService } from './cycle-deletion.service';

describe('CycleDeletionService', () => {
  const at = new Date('2038-01-01');
  const viewer: any = { id: 'operator', sysRole: 'hr_user', hrCapabilities: ['cycle_delete'], isAssessorOnly: false };
  let db: any, service: CycleDeletionService, cycle: any, tasks: any[], changes: any[], actor: any;
  const row = (id: string, fields = {}) => ({ id, cycleId: 'cycle', status: 'self_eval', lifecycleStatus: 'terminated',
    lifecycleVersion: 1, updatedAt: at, terminatedAt: at, employee: { name: `Fictional ${id}`, employeeNo: null }, gradeResult: null, ...fields });
  beforeEach(() => {
    cycle = { id: 'cycle', name: 'Fictional cycle', status: 'self_eval', planVersion: 1, hrOwnerId: viewer.id,
      updatedAt: at, terminatedAt: at, terminationVersion: 1, deletedAt: null, deletionVersion: 0 };
    tasks = [row('stopped'), row('finished', { status: 'closed', lifecycleStatus: 'active', terminatedAt: null }),
      row('removed', { lifecycleStatus: 'deleted' })];
    changes = [{ id: 'change', taskId: 'stopped', status: 'draft', lifecycleStatus: 'terminated', lifecycleVersion: 1, revision: 1, updatedAt: at }];
    actor = { ...viewer, status: 'active', deletedAt: null, archivedAt: null };
    db = {
      assessmentCycle: { findUnique: jest.fn(async () => cycle), updateMany: jest.fn(async ({ data }) => { Object.assign(cycle, data); return { count: 1 }; }) },
      assessmentTask: { findMany: jest.fn(async () => tasks), updateMany: jest.fn(async () => ({ count: 1 })) },
      goalChangeRequest: { findMany: jest.fn(async () => changes), updateMany: jest.fn(async () => ({ count: 1 })) },
      notificationLog: { updateMany: jest.fn(async () => ({ count: 0 })) },
      user: { findUnique: jest.fn(async () => actor) }, auditLog: { create: jest.fn() }, $queryRaw: jest.fn(async () => []),
    };
    db.$transaction = jest.fn(async fn => fn(db)); service = new CycleDeletionService(db);
  });
  it('previews every task and related goal change without writes', async () => {
    const p = await service.preview('cycle', viewer);
    expect(p.summary).toEqual({ total: 3, deletable: 2, blocked: 0, alreadyDeleted: 1, goalChanges: 1 });
    expect(p.canDelete).toBe(true); expect(p.tasks.map(t => t.disposition)).toEqual(['delete', 'delete', 'already_deleted']);
    expect(db.assessmentTask.updateMany).not.toHaveBeenCalled(); expect(db.auditLog.create).not.toHaveBeenCalled();
  });
  it.each(['hr', 'system_admin', 'hr_user'])('does not infer cycle deletion from %s role', async sysRole => {
    await expect(service.preview('cycle', { ...viewer, sysRole, hrCapabilities: [] })).rejects.toThrow(ForbiddenException);
  });
  it('retains owner scope and rejects assessor-only accounts', async () => {
    await expect(service.preview('cycle', { ...viewer, id: 'other' })).rejects.toThrow(ForbiddenException);
    await expect(service.preview('cycle', { ...viewer, isAssessorOnly: true })).rejects.toThrow(ForbiddenException);
  });
  it('requires termination before deleting a launched cycle', async () => {
    cycle.terminatedAt = null;
    await expect(service.preview('cycle', viewer)).rejects.toThrow(ConflictException);
  });
  it('allows an empty unlaunched draft under the original plan-edit capability', async () => {
    cycle.status = 'draft'; cycle.terminatedAt = null; tasks = []; changes = [];
    const p = await service.preview('cycle', { ...viewer, hrCapabilities: ['cycle_plan_edit'] });
    expect(p.canDelete).toBe(true);
  });
  it('refuses a draft that has actual tasks rather than silently deleting them', async () => {
    cycle.status = 'draft'; cycle.terminatedAt = null;
    const p = await service.preview('cycle', { ...viewer, hrCapabilities: ['cycle_plan_edit'] });
    expect(p.canDelete).toBe(false); expect(p.summary.blocked).toBe(3);
  });
  it.each([
    { status: 'approval', lifecycleStatus: 'active', terminatedAt: null, approvedAt: at },
    { status: 'confirmed', lifecycleStatus: 'active', terminatedAt: null, employeeConfirmedAt: at },
    { status: 'published', lifecycleStatus: 'active', terminatedAt: null, publishedAt: at },
    { status: 'appealing', lifecycleStatus: 'active', terminatedAt: null },
  ])('blocks the whole cycle when a result is unfinished: $status', async pending => {
    tasks[1] = row('unfinished', pending);
    const p = await service.preview('cycle', viewer); expect(p.canDelete).toBe(false); expect(p.summary.blocked).toBe(1);
    await expect(service.remove('cycle', { reason: 'Fictional reason', expectedPreviewHash: p.previewHash }, viewer)).rejects.toThrow(ConflictException);
    expect(db.assessmentTask.updateMany).not.toHaveBeenCalled(); expect(db.assessmentCycle.updateMany).not.toHaveBeenCalled();
  });
  it('blocks a still pending goal change on an otherwise completed task', async () => {
    changes[0] = { ...changes[0], taskId: 'finished', lifecycleStatus: 'active', status: 'leader_review' };
    const p = await service.preview('cycle', viewer); expect(p.canDelete).toBe(false); expect(p.summary.blocked).toBe(1);
  });
  it('blocks pending changes even when the parent task was previously deleted', async () => {
    changes[0] = { ...changes[0], taskId: 'removed', lifecycleStatus: 'active', status: 'leader_review' };
    const p = await service.preview('cycle', viewer);
    expect(p.canDelete).toBe(false);
    await expect(service.remove('cycle', { reason: 'Fictional reason', expectedPreviewHash: p.previewHash }, viewer)).rejects.toThrow(ConflictException);
    expect(db.goalChangeRequest.updateMany).not.toHaveBeenCalled();
  });
  it('requires a fresh impact hash and nonempty reason', async () => {
    const p = await service.preview('cycle', viewer); tasks[0].lifecycleVersion++;
    await expect(service.remove('cycle', { reason: 'Fictional reason', expectedPreviewHash: p.previewHash }, viewer)).rejects.toThrow(ConflictException);
    await expect(service.remove('cycle', { reason: ' ', expectedPreviewHash: p.previewHash }, viewer)).rejects.toThrow(BadRequestException);
    expect(db.assessmentTask.updateMany).not.toHaveBeenCalled();
  });
  it('rechecks revoked or disabled authority under the write lock', async () => {
    const p = await service.preview('cycle', viewer); actor.hrCapabilities = [];
    await expect(service.remove('cycle', { reason: 'Fictional reason', expectedPreviewHash: p.previewHash }, viewer)).rejects.toThrow(ForbiddenException);
    expect(db.assessmentTask.updateMany).not.toHaveBeenCalled();
  });
  it('logically deletes the cycle, eligible tasks and changes but not their original business fields', async () => {
    const p = await service.preview('cycle', viewer);
    const result = await service.remove('cycle', { reason: 'Fictional removal', expectedPreviewHash: p.previewHash }, viewer);
    expect(result).toMatchObject({ id: 'cycle', deletedTaskCount: 2, deletedGoalChangeCount: 1, alreadyDeletedTaskCount: 1 });
    expect(db.assessmentTask.updateMany).toHaveBeenCalledTimes(2);
    expect(db.goalChangeRequest.updateMany).toHaveBeenCalledTimes(1);
    for (const args of [...db.assessmentTask.updateMany.mock.calls, ...db.goalChangeRequest.updateMany.mock.calls]) {
      expect(args[0].data).toMatchObject({ lifecycleStatus: 'deleted', deletionReason: 'Fictional removal' });
      expect(args[0].data.status).toBeUndefined(); expect(args[0].data.terminatedAt).toBeUndefined();
    }
    expect(cycle.status).toBe('self_eval'); expect(cycle.terminatedAt).toEqual(at);
    expect(db.auditLog.create).toHaveBeenCalledTimes(4);
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'cycle_deleted' }) }));
  });
  it('rejects duplicate deletion without overwriting its first metadata', async () => {
    const p = await service.preview('cycle', viewer);
    await service.remove('cycle', { reason: 'First reason', expectedPreviewHash: p.previewHash }, viewer);
    await expect(service.remove('cycle', { reason: 'Second reason', expectedPreviewHash: p.previewHash }, viewer)).rejects.toThrow(ConflictException);
    expect(cycle.deletionReason).toBe('First reason');
  });
});
