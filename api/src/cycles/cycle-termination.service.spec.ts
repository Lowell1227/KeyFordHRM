import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CycleTerminationService } from './cycle-termination.service';

describe('CycleTerminationService', () => {
  let db: any, service: CycleTerminationService, cycle: any, rows: any[], actor: any;
  const date = new Date('2038-01-01');
  const viewer: any = { id: 'operator', sysRole: 'hr_user', hrCapabilities: ['cycle_terminate'], isAssessorOnly: false };
  const task = (id: string, extra = {}) => ({ id, cycleId: 'cycle', status: 'self_eval', lifecycleStatus: 'active',
    lifecycleVersion: 0, updatedAt: date, employee: { name: `Fictional ${id}`, employeeNo: null }, gradeResult: null, ...extra });
  beforeEach(() => {
    cycle = { id: 'cycle', name: 'Fictional cycle', status: 'self_eval', planVersion: 1, hrOwnerId: viewer.id,
      updatedAt: date, openedAt: date, terminatedAt: null, terminationVersion: 0 };
    rows = [task('draft'), task('approved', { approvedAt: date }), task('ended', { lifecycleStatus: 'terminated' })];
    actor = { ...viewer, status: 'active', archivedAt: null, deletedAt: null };
    db = { assessmentCycle: { findUnique: jest.fn(async () => cycle), update: jest.fn(async ({ data }) => { Object.assign(cycle, data); return cycle; }) },
      assessmentTask: { findMany: jest.fn(async () => rows), updateMany: jest.fn(async () => ({ count: 1 })) },
      assessmentPeriod: { findMany: jest.fn(async () => []) },
      goalChangeRequest: { findMany: jest.fn(async () => []), updateMany: jest.fn(async () => ({ count: 1 })) },
      notificationLog: { findMany: jest.fn(async () => []), updateMany: jest.fn(async () => ({ count: 0 })) },
      user: { findUnique: jest.fn(async () => actor) }, auditLog: { create: jest.fn() }, $queryRaw: jest.fn(async () => []) };
    db.$transaction = jest.fn(async fn => fn(db)); service = new CycleTerminationService(db);
  });
  it('previews eligible, protected and already-ended records without writing', async () => {
    const result = await service.preview('cycle', viewer);
    expect(result.summary).toEqual({ total: 3, terminable: 1, protected: 1, alreadyEnded: 1, goalChanges: 0, reminders: 0 });
    expect(result.tasks.map(row => row.disposition)).toEqual(['terminate', 'protected', 'already_ended']);
    expect(db.auditLog.create).not.toHaveBeenCalled(); expect(db.assessmentTask.updateMany).not.toHaveBeenCalled();
  });
  it.each(['hr', 'system_admin', 'hr_user'])('does not infer termination permission from %s role', async sysRole => {
    await expect(service.preview('cycle', { ...viewer, sysRole, hrCapabilities: [] })).rejects.toThrow(ForbiddenException);
  });
  it('retains ownership scope and refuses assessor-only identities', async () => {
    await expect(service.preview('cycle', { ...viewer, id: 'other' })).rejects.toThrow(ForbiddenException);
    await expect(service.preview('cycle', { ...viewer, isAssessorOnly: true })).rejects.toThrow(ForbiddenException);
  });
  it('requires the current impact hash and reason without writing on conflict', async () => {
    const p = await service.preview('cycle', viewer); rows[0].updatedAt = new Date(+date + 1);
    await expect(service.terminate('cycle', { expectedPreviewHash: p.previewHash, reason: 'Fictional cancellation' }, viewer)).rejects.toThrow(ConflictException);
    expect(db.assessmentTask.updateMany).not.toHaveBeenCalled();
  });
  it('rechecks revocation under the writing transaction', async () => {
    const p = await service.preview('cycle', viewer); actor.hrCapabilities = [];
    await expect(service.terminate('cycle', { expectedPreviewHash: p.previewHash, reason: 'Fictional cancellation' }, viewer)).rejects.toThrow(ForbiddenException);
    expect(db.assessmentTask.updateMany).not.toHaveBeenCalled();
  });
  it('stops only eligible tasks and audits the cycle without rewriting results or business status', async () => {
    const p = await service.preview('cycle', viewer);
    const result = await service.terminate('cycle', { expectedPreviewHash: p.previewHash, reason: 'Fictional cancellation' }, viewer);
    expect(result).toMatchObject({ id: 'cycle', terminatedCount: 1, protectedCount: 1, alreadyEndedCount: 1, cancelledGoalChangeCount: 0 });
    expect(db.assessmentTask.updateMany).toHaveBeenCalledTimes(1);
    expect(db.assessmentTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'draft' }),
      data: expect.objectContaining({ lifecycleStatus: 'terminated', terminationReason: 'Fictional cancellation' }) }));
    expect(db.assessmentTask.updateMany.mock.calls[0][0].data.status).toBeUndefined();
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'cycle_terminated' }) }));
  });
  it('does not allow terminating a draft or scheduled period through this path', async () => {
    for (const status of ['draft', 'scheduled', 'launch_blocked', 'closed']) {
      cycle.status = status; await expect(service.preview('cycle', viewer)).rejects.toThrow(ConflictException);
    }
  });
  it('refuses duplicate termination and retains original metadata', async () => {
    const p = await service.preview('cycle', viewer);
    await service.terminate('cycle', { expectedPreviewHash: p.previewHash, reason: 'Fictional cancellation' }, viewer);
    await expect(service.terminate('cycle', { expectedPreviewHash: p.previewHash, reason: 'Different reason' }, viewer)).rejects.toThrow(ConflictException);
    expect(cycle.terminationReason).toBe('Fictional cancellation');
  });
});
