import { BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { GoalChangesService } from './goal-changes.service';

describe('GoalChangesService access and revisions', () => {
  const viewer: any = { id: 'employee', sysRole: 'employee', isAssessorOnly: false, canViewAll: false };
  const task: any = { id: 'task', employeeId: 'employee', managerId: 'manager', deptHeadId: 'head', approverId: 'vp',
    lifecycleStatus: 'active', lifecycleVersion: 0, updatedAt: new Date(),
    employee: { id: 'employee', status: 'active', deletedAt: null, archivedAt: null },
    manager: { id: 'manager', status: 'active', deletedAt: null, archivedAt: null },
    deptHead: { id: 'head', status: 'active', deletedAt: null, archivedAt: null },
    approver: { id: 'vp', status: 'active', deletedAt: null, archivedAt: null },
    cycle: { hrOwnerId: 'hr', goalWorkflowVersion: 2, status: 'active' }, goalChangeGrant: { state: 'open', revision: 0 },
    goalApprovedAt: new Date(), participantDisposition: 'active', isExempt: false, periods: [],
    selfEvalSubmittedAt: null, managerScoredAt: null, status: 'goal_confirmed' };
  function setup(request: any = { id: 'request', taskId: 'task', creatorId: 'employee', status: 'draft', revision: 2 }) {
    request = { lifecycleStatus: 'active', lifecycleVersion: 0, updatedAt: new Date(), ...request };
    const tx: any = { $queryRaw: jest.fn(async (query: TemplateStringsArray) => {
      const sql = query.join('');
      if (sql.includes('FROM assessment_periods')) return task.periods.map((period: { id: string }) => ({ id: period.id }));
      if (sql.includes('FROM assessment_tasks')) return [{ id: task.id }];
      throw new Error(`Unexpected goal-change lock query: ${sql}`);
    }),
      assessmentTask: { findUnique: jest.fn().mockResolvedValue(task), findMany: jest.fn().mockResolvedValue([task]) },
      goalChangeRequest: { findUnique: jest.fn().mockResolvedValue(request), findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), updateMany: jest.fn(async ({ where }) => {
          expect(where.lifecycleStatus).toBe('active');
          return { count: 1 };
        }) },
      goalChangeGrant: { findUnique: jest.fn().mockResolvedValue(task.goalChangeGrant) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
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
  it('rejects a request write after its locked parent task has terminated', async () => {
    const { service, tx } = setup();
    tx.assessmentTask.findUnique.mockResolvedValue({ ...task, lifecycleStatus: 'terminated' });
    await expect(service.update('request', { expectedRevision: 2, reason: 'change', goals: [] }, viewer))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.goalChangeRequest.updateMany).not.toHaveBeenCalled();
  });
  it('rejects an ended request even when its locked parent task remains active', async () => {
    const { service, tx } = setup({ id: 'request', taskId: 'task', creatorId: 'employee', status: 'draft', revision: 2,
      lifecycleStatus: 'terminated' });
    await expect(service.update('request', { expectedRevision: 2, reason: 'change', goals: [] }, viewer))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.goalChangeRequest.updateMany).not.toHaveBeenCalled();
  });
  it('opens navigation for an eligible grant or related history, but not an unrelated employee', async () => {
    const { service, tx } = setup();
    expect(await service.entry(viewer)).toEqual({ visible: true });
    tx.assessmentTask.findMany.mockResolvedValue([]);
    expect(await service.entry(viewer)).toEqual({ visible: false });
    tx.goalChangeRequest.findFirst.mockResolvedValue({ id: 'old-request' });
    expect(await service.entry(viewer)).toEqual({ visible: true });
    expect(await service.entry({ ...viewer, isAssessorOnly: true })).toEqual({ visible: true });
  });
  it('returns a manager-created revision as that manager own actionable goal-change task', async () => {
    const request = { id: 'request', taskId: 'task', creatorId: 'manager', status: 'revision', revision: 2,
      task: { ...task, employee: { ...task.employee, name: '虚构员工' }, cycle: { ...task.cycle, name: '虚构周期' } },
      creator: { name: '虚构上级' } };
    const { service, tx } = setup(request);
    tx.goalChangeRequest.findMany.mockResolvedValue([request]);
    const rows = await (service as any).myPending({ ...viewer, id: 'manager' });
    expect(rows).toMatchObject([{ id: 'request', employeeName: '虚构员工', creatorName: '虚构上级',
      currentOwnerId: 'manager', allowedActions: expect.arrayContaining(['edit', 'submit']) }]);
    expect(tx.goalChangeRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ lifecycleStatus: 'active', task: { lifecycleStatus: 'active' }, OR: expect.any(Array) }),
      include: expect.objectContaining({ task: expect.any(Object), creator: expect.any(Object) }),
    }));
  });
  it('pages authorized goal changes in the database before loading task relations', async () => {
    const request = { id: 'request', taskId: 'task', creatorId: 'employee', status: 'active', revision: 2,
      task: { ...task, employee: { ...task.employee, name: '虚构员工' }, cycle: { ...task.cycle, name: '虚构周期' } },
      creator: { name: '虚构发起人' } };
    const { service, tx } = setup(request);
    tx.goalChangeRequest.count.mockResolvedValue(37);
    tx.goalChangeRequest.findMany.mockResolvedValue([request]);
    const result = await (service as any).findPage({ page: 2, pageSize: 10, skip: 10, take: 10,
      scope: 'self', status: 'active', keyword: '虚构' }, viewer);
    expect(result).toMatchObject({ total: 37, page: 2, pageSize: 10,
      items: [{ id: 'request', employeeName: '虚构员工', creatorName: '虚构发起人' }] });
    const where = tx.goalChangeRequest.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(expect.arrayContaining([
      { task: { OR: expect.any(Array) } }, { task: { employeeId: 'employee' } }, { status: 'active' },
      { lifecycleStatus: { not: 'deleted' } },
    ]));
    expect(tx.goalChangeRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10,
      include: expect.objectContaining({ task: expect.any(Object), creator: expect.any(Object) }) }));
    expect(tx.assessmentTask.findUnique).not.toHaveBeenCalled();
  });
  it('submits edited content and its status in one revisioned write', async () => {
    const goal: any = { sourceInstanceId: 'g1', name: '调整目标', description: null, scoringStandard: null,
      targetValue: null, targetValueText: null, unit: null, weight: 1, indicatorType: 'kpi',
      dimensionName: '业务结果', dimensionWeight: 1, sortOrder: 0 };
    const { service, tx } = setup({ id: 'request', taskId: 'task', creatorId: 'employee', status: 'draft', revision: 2,
      reason: null, beforeGoals: [goal], goals: [goal] });
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'request' } as any);
    jest.spyOn(service as any, 'notifyOwner').mockResolvedValue(undefined);
    await service.submit('request', { expectedRevision: 2, reason: ' 调整范围 ', goals: [goal] }, viewer);
    expect(tx.goalChangeRequest.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.goalChangeRequest.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'request', lifecycleStatus: 'active', revision: 2, status: 'draft' },
      data: { reason: '调整范围', goals: [goal], status: 'indicator_reviewing' },
    });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create.mock.calls[0][0].data.action).toBe('submit');
    expect(tx.$queryRaw.mock.calls.map(([query]: [TemplateStringsArray]) => query.join(''))).toEqual([
      expect.stringContaining('FROM assessment_periods'), expect.stringContaining('FROM assessment_tasks'),
    ]);
    expect(tx.assessmentTask.findUnique.mock.invocationCallOrder[0]).toBeLessThan(tx.goalChangeRequest.updateMany.mock.invocationCallOrder[0]);
  });
  it('rejects stale submit before writing edited content', async () => {
    const { service, tx } = setup();
    await expect(service.submit('request', { expectedRevision: 1, reason: '调整', goals: [] }, viewer))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.goalChangeRequest.updateMany).not.toHaveBeenCalled();
  });
  it('rejects partial submit content before changing the draft', async () => {
    const { service, tx } = setup();
    await expect(service.submit('request', { expectedRevision: 2, reason: '调整' }, viewer))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(tx.goalChangeRequest.updateMany).not.toHaveBeenCalled();
  });
});
