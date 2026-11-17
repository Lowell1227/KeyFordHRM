import { ForbiddenException, ConflictException } from '@nestjs/common';
import { GoalChangesService } from './goal-changes.service';

describe('GoalChangesService access and revisions', () => {
  const viewer: any = { id: 'employee', sysRole: 'employee', isAssessorOnly: false, canViewAll: false };
  const task: any = { id: 'task', employeeId: 'employee', managerId: 'manager', deptHeadId: 'head', approverId: 'vp',
    employee: { id: 'employee', status: 'active', deletedAt: null, archivedAt: null },
    cycle: { hrOwnerId: 'hr', goalWorkflowVersion: 2, status: 'active' }, goalChangeGrant: { state: 'open', revision: 0 },
    goalApprovedAt: new Date(), participantDisposition: 'active', isExempt: false, periods: [],
    selfEvalSubmittedAt: null, managerScoredAt: null, status: 'goal_confirmed' };
  function setup(request: any = { id: 'request', taskId: 'task', creatorId: 'employee', status: 'draft', revision: 2 }) {
    const tx: any = { $queryRaw: jest.fn().mockResolvedValue([]),
      assessmentTask: { findUnique: jest.fn().mockResolvedValue(task) },
      goalChangeRequest: { findUnique: jest.fn().mockResolvedValue(request), updateMany: jest.fn() },
      goalChangeGrant: { findUnique: jest.fn().mockResolvedValue(task.goalChangeGrant) },
    };
    const prisma: any = { ...tx, $transaction: (fn: any) => fn(tx) };
    return { tx, service: new GoalChangesService(prisma, { create: jest.fn() } as any) };
  }
  it('rejects a stale draft before applying any update', async () => {
    const { service, tx } = setup();
    await expect(service.update('request', { expectedRevision: 1, reason: 'change', goals: [] }, viewer)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.goalChangeRequest.updateMany).not.toHaveBeenCalled();
  });
  it('does not expose another employee request to an unrelated user', async () => {
    const { service } = setup();
    await expect(service.findOne('request', { ...viewer, id: 'stranger' })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('HR global visibility does not bypass the assigned approval actor', async () => {
    const { service, tx } = setup({ id: 'request', taskId: 'task', creatorId: 'employee', status: 'indicator_reviewing', revision: 2 });
    await expect(service.decide('request', { expectedRevision: 2, approve: true }, { ...viewer, id: 'hr', sysRole: 'hr' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.goalChangeRequest.updateMany).not.toHaveBeenCalled();
  });
  it('rechecks revoked grants inside the transaction', async () => {
    const { service, tx } = setup();
    tx.goalChangeGrant.findUnique.mockResolvedValue({ state: 'revoked' });
    await expect(service.update('request', { expectedRevision: 2, reason: 'change', goals: [] }, viewer)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.goalChangeRequest.updateMany).not.toHaveBeenCalled();
  });
});
