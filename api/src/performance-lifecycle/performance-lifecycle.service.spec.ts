import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PerformanceLifecycleService } from './performance-lifecycle.service';

const at = new Date('2026-11-26T00:00:00.000Z');
const viewer = { id: 'hr', sysRole: 'hr', isAssessorOnly: false } as any;
const input = { expectedUpdatedAt: at.toISOString(), expectedLifecycleVersion: 0, reason: 'Duplicate unfinished record' };

describe('performance lifecycle mutations', () => {
  let service: PerformanceLifecycleService;
  let row: any;
  let db: any;
  let view: any;
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
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      notificationLog: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    db.$transaction = (fn: any) => fn(db);
    view = { findOne: jest.fn().mockResolvedValue({}) };
    service = new PerformanceLifecycleService(db, view, view, view, view);
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
});
