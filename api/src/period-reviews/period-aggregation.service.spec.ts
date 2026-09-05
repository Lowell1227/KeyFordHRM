import { Prisma } from '@prisma/client';
import { PeriodAggregationService } from './period-aggregation.service';

/**
 * 新模型：聚合只刷新整周期参考总分，不推导 rawGrade、不自动流转状态。
 * 最终等级由直属上级在「整周期结果评定」中独立录入。
 */
describe('PeriodAggregationService', () => {
  const tx = {
    $queryRaw: jest.fn(),
    assessmentTask: { findUnique: jest.fn() },
    gradeResult: { upsert: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const flow = { transitionTx: jest.fn() };
  const service = new PeriodAggregationService(flow as any);

  beforeEach(() => {
    jest.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([]);
  });

  it('serializes task aggregation before reading period completion', async () => {
    const order: string[] = [];
    tx.$queryRaw.mockImplementation(async () => { order.push('lock'); return []; });
    tx.assessmentTask.findUnique.mockImplementation(async () => {
      order.push('read');
      return {
        id: 'task-1', cycleId: 'cycle-1', status: 'manager_scoring',
        managerId: 'manager-1', deptHeadId: 'head-1', cycle: { workflowVersion: 2 },
        periods: [completedPeriod(88)],
      };
    });

    await service.refreshTask('task-1', tx as any, 'manager-1');

    expect(order.slice(0, 2)).toEqual(['lock', 'read']);
  });

  it('does not create a quarter score when a required month has no result', async () => {
    tx.assessmentTask.findUnique.mockResolvedValue({
      id: 'task-1', cycleId: 'cycle-1', status: 'manager_scoring',
      managerId: 'manager-1', deptHeadId: 'head-1',
      periods: [
        completedPeriod(80),
        completedPeriod(90),
        { status: 'no_result', managerScoreTotal: null, employeeSubmittedAt: null, managerSubmittedAt: null, lockedAt: null },
      ],
    });

    const result = await service.refreshTask('task-1', tx as any, 'manager-1');

    expect(result).toEqual({ complete: false, score: null, targetStatus: null });
    expect(tx.gradeResult.upsert).not.toHaveBeenCalled();
    expect(flow.transitionTx).not.toHaveBeenCalled();
  });

  it('averages monthly totals into the reference score without deriving rawGrade or transitioning', async () => {
    tx.assessmentTask.findUnique.mockResolvedValue({
      id: 'task-1', cycleId: 'cycle-1', status: 'manager_scoring',
      managerId: 'manager-1', deptHeadId: 'head-1', cycle: { workflowVersion: 2 },
      periods: [completedPeriod(80), completedPeriod(90), completedPeriod(85.555, 'C')],
    });

    const result = await service.refreshTask('task-1', tx as any, 'manager-1');

    expect(result).toEqual({ complete: true, score: 85.19, targetStatus: null });
    expect(tx.gradeResult.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ calculatedScore: 85.19 }),
      update: expect.objectContaining({ calculatedScore: 85.19 }),
    }));
    expect(tx.gradeResult.upsert).toHaveBeenCalledWith(expect.not.objectContaining({
      create: expect.objectContaining({ rawGrade: expect.anything() }),
    }));
    expect(flow.transitionTx).not.toHaveBeenCalled();
  });

  it('does not create an early score while any required period is unfinished', async () => {
    tx.assessmentTask.findUnique.mockResolvedValue({
      id: 'task-1', cycleId: 'cycle-1', status: 'manager_scoring',
      managerId: 'manager-1', deptHeadId: 'head-1',
      periods: [
        completedPeriod(88),
        { status: 'self_eval', managerScoreTotal: null, employeeSubmittedAt: null, managerSubmittedAt: null, lockedAt: null },
      ],
    });

    await expect(service.refreshTask('task-1', tx as any, 'manager-1'))
      .resolves.toEqual({ complete: false, score: null, targetStatus: null });
    expect(tx.gradeResult.upsert).not.toHaveBeenCalled();
    expect(flow.transitionTx).not.toHaveBeenCalled();
  });

  it('still refreshes the score for a workflow v2 task already advanced, without touching rawGrade', async () => {
    tx.assessmentTask.findUnique.mockResolvedValue({
      id: 'task-1', cycleId: 'cycle-1', status: 'hr_calibration',
      managerId: 'manager-1', deptHeadId: 'manager-1',
      cycle: { workflowVersion: 2 },
      periods: [completedPeriod(90)],
    });

    await expect(service.refreshTask('task-1', tx as any, 'manager-1'))
      .resolves.toEqual({ complete: true, score: 90, targetStatus: null });
    expect(tx.gradeResult.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ calculatedScore: 90 }),
    }));
    expect(flow.transitionTx).not.toHaveBeenCalled();
  });

  function completedPeriod(score: number, managerGrade: 'A' | 'B' | 'C' | 'D' | null = 'B') {
    return {
      status: 'completed',
      managerScoreTotal: new Prisma.Decimal(score),
      managerGrade,
      employeeSubmittedAt: new Date('2026-07-30T08:00:00.000Z'),
      managerSubmittedAt: new Date('2026-07-31T08:00:00.000Z'),
      lockedAt: new Date('2026-07-31T08:00:00.000Z'),
    };
  }
});
