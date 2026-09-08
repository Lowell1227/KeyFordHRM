import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CalibrationService } from './calibration.service';

describe('calibration cycle owner scope', () => {
  const owner: any = { id: 'owner', sysRole: 'hr_user', hrCapabilities: ['cycle_plan_edit'] };
  const hr: any = { id: 'hr', sysRole: 'hr' };
  const cycle = { id: 'cycle', name: '虚拟周期', hrOwnerId: 'owner', createdBy: 'creator',
    gradeAMaxRatio: new Prisma.Decimal(0.2), gradeBMaxRatio: new Prisma.Decimal(0.4),
    gradeCMaxRatio: new Prisma.Decimal(0.3), gradeDMaxRatio: new Prisma.Decimal(0.1) };
  const task = (employeeId = 'employee') => ({ id: `task-${employeeId}`, cycleId: 'cycle', employeeId,
    status: 'hr_calibration', isExempt: false, updatedAt: new Date(), managerId: 'manager', deptHeadId: 'head', approverId: null,
    employee: { name: employeeId }, manager: { name: '虚拟上级' }, dept: { name: '虚拟部门' },
    gradeResult: { calculatedScore: new Prisma.Decimal(90), rawGrade: 'A', calibratedGrade: null },
    periods: [], indicatorInstances: [], flowRecords: [] });
  function setup(tasks = [task(), task('owner')]) {
    const tx: any = { $queryRaw: jest.fn(), assessmentCycle: { findUnique: jest.fn().mockResolvedValue(cycle) },
      assessmentTask: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, gradeResult: { updateMany: jest.fn() } };
    const prisma: any = { assessmentCycle: { findUnique: jest.fn().mockResolvedValue(cycle), findMany: jest.fn().mockResolvedValue([cycle]) },
      assessmentTask: { findMany: jest.fn().mockResolvedValue(tasks), findFirst: jest.fn().mockResolvedValue(tasks[0]) },
      assessmentPeriodIndicatorReview: { findMany: jest.fn().mockResolvedValue([]) }, $transaction: jest.fn((fn) => fn(tx)) };
    const flow: any = { transitionTx: jest.fn() };
    return { prisma, tx, flow, service: new CalibrationService(prisma, flow, { create: jest.fn().mockResolvedValue({}) } as any) };
  }

  it('lists only owned cycles without granting creator or unrelated cycle access', async () => {
    const { service, prisma } = setup();
    await (service as any).listCycles(owner);
    expect(prisma.assessmentCycle.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ hrOwnerId: 'owner' }) }));
    await (service as any).listCycles(hr);
    expect(prisma.assessmentCycle.findMany.mock.calls[1][0].where.hrOwnerId).toBeUndefined();
  });

  it.each(['creator', 'other'])('rejects every cycle endpoint for %s before reading or writing tasks', async (id) => {
    const { service, prisma } = setup();
    const viewer = { ...owner, id };
    const requests = [() => service.getWorkbench('cycle', viewer),
      () => (service as any).getGradeDistribution('cycle', viewer),
      () => (service as any).getCandidateDetail('cycle', 'task-employee', viewer),
      () => service.confirm('cycle', { taskIds: ['task-employee'] }, viewer),
      () => service.reject('cycle', { taskIds: ['task-employee'], reason: '补充依据' }, viewer)];
    for (const request of requests) await expect(request()).rejects.toThrow(ForbiddenException);
    expect(prisma.assessmentTask.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('shows own workflow only and excludes own result from both distribution endpoints', async () => {
    const { service } = setup();
    const result = await service.getWorkbench('cycle', owner);
    expect(result.items.find(row => row.taskId === 'task-owner')).toMatchObject({ calculatedScore: null, rawGrade: null,
      canCalibrate: false, canViewDetail: false, actionHint: '本人结果由其他有权限的 HR 处理' });
    expect(result.items.find(row => row.taskId === 'task-employee')).toMatchObject({ canCalibrate: true, canViewDetail: true });
    expect(result.gradeDistribution.A.count).toBe(1);
    expect((await (service as any).getGradeDistribution('cycle', owner)).distribution.A.count).toBe(1);
  });

  it('allows the scoped owner to read another employee basis and blocks own detail', async () => {
    const { service, prisma } = setup();
    expect(await (service as any).getCandidateDetail('cycle', 'task-employee', owner)).toMatchObject({ calculatedScore: 90 });
    prisma.assessmentTask.findFirst.mockResolvedValue(task('owner'));
    await expect((service as any).getCandidateDetail('cycle', 'task-owner', owner)).rejects.toThrow(ForbiddenException);
  });

  it.each(['confirm', 'reject'])('rejects a mixed batch containing self for %s without partial writes', async (action) => {
    const { service, prisma } = setup();
    await expect(service[action]('cycle', { taskIds: ['task-employee', 'task-owner'], reason: '补充依据' }, owner)).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['confirm', 'reject'])('allows an owner to %s another employee while leaving scores untouched', async action => {
    const { service, tx, flow } = setup([task()]);
    await service[action]('cycle', { taskIds: ['task-employee'], reason: '补充依据' }, owner);
    expect(flow.transitionTx).toHaveBeenCalledWith(tx, expect.objectContaining({ targetStatus: action === 'confirm' ? 'approval' : 'manager_scoring' }));
    if (action === 'confirm') expect(tx.gradeResult.updateMany.mock.calls[0][0].data).toEqual({ hrCalibratorId: 'owner', hrCalibratedAt: expect.any(Date) });
  });

  it('rechecks owner in the write transaction after a concurrent responsibility change', async () => {
    const { service, tx, flow } = setup([task()]);
    tx.assessmentCycle.findUnique.mockResolvedValue({ ...cycle, hrOwnerId: 'new-owner' });
    await expect(service.confirm('cycle', { taskIds: ['task-employee'] }, owner)).rejects.toThrow(ForbiddenException);
    expect(flow.transitionTx).not.toHaveBeenCalled();
    expect(tx.gradeResult.updateMany).not.toHaveBeenCalled();
  });

  it('does not let global HR calibrate their own employee result', async () => {
    const { service } = setup([task('hr')]);
    await expect(service.confirm('cycle', { taskIds: ['task-hr'] }, hr)).rejects.toThrow(ForbiddenException);
  });
});
