import { Prisma } from '@prisma/client';
import { PeriodAggregationService } from './period-aggregation.service';

describe('PeriodAggregationService', () => {
  const tx = {
    assessmentTask: { findUnique: jest.fn() },
    systemConfig: { findUnique: jest.fn() },
    gradeResult: { upsert: jest.fn() },
  };
  const scoring = { calcRawGrade: jest.fn().mockReturnValue('B') };
  const flow = { transitionTx: jest.fn() };
  const service = new PeriodAggregationService(scoring as any, flow as any);

  beforeEach(() => {
    jest.clearAllMocks();
    tx.systemConfig.findUnique.mockResolvedValue({ value: { A: 90, B: 75, C: 60 } });
    flow.transitionTx.mockResolvedValue({ newStatus: 'dept_review' });
  });

  it('equally averages completed valid periods and excludes no-result periods', async () => {
    tx.assessmentTask.findUnique.mockResolvedValue({
      id: 'task-1', cycleId: 'cycle-1', status: 'manager_scoring',
      managerId: 'manager-1', deptHeadId: 'head-1',
      periods: [
        { status: 'completed', managerScoreTotal: new Prisma.Decimal(80) },
        { status: 'completed', managerScoreTotal: new Prisma.Decimal(90) },
        { status: 'no_result', managerScoreTotal: null },
      ],
    });

    const result = await service.refreshTask('task-1', tx as any, 'manager-1');

    expect(result).toEqual({ complete: true, score: 85, targetStatus: 'dept_review' });
    expect(tx.gradeResult.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ calculatedScore: 85, rawGrade: 'B' }),
      update: expect.objectContaining({ calculatedScore: 85, rawGrade: 'B' }),
    }));
    expect(flow.transitionTx).toHaveBeenCalledWith(tx, expect.objectContaining({
      targetStatus: 'dept_review', actorId: 'manager-1',
    }));
  });

  it('does not create an early score while any required period is unfinished', async () => {
    tx.assessmentTask.findUnique.mockResolvedValue({
      id: 'task-1', cycleId: 'cycle-1', status: 'manager_scoring',
      managerId: 'manager-1', deptHeadId: 'head-1',
      periods: [
        { status: 'completed', managerScoreTotal: new Prisma.Decimal(88) },
        { status: 'self_eval', managerScoreTotal: null },
      ],
    });

    await expect(service.refreshTask('task-1', tx as any, 'manager-1'))
      .resolves.toEqual({ complete: false, score: null, targetStatus: null });
    expect(tx.gradeResult.upsert).not.toHaveBeenCalled();
    expect(flow.transitionTx).not.toHaveBeenCalled();
  });

  it('moves directly to HR calibration when the manager is also the department head', async () => {
    tx.assessmentTask.findUnique.mockResolvedValue({
      id: 'task-1', cycleId: 'cycle-1', status: 'manager_scoring',
      managerId: 'manager-1', deptHeadId: 'manager-1',
      periods: [{ status: 'completed', managerScoreTotal: new Prisma.Decimal(92) }],
    });

    await expect(service.refreshTask('task-1', tx as any, 'manager-1'))
      .resolves.toEqual({ complete: true, score: 92, targetStatus: 'hr_calibration' });
    expect(flow.transitionTx).toHaveBeenCalledWith(tx, expect.objectContaining({
      targetStatus: 'hr_calibration',
    }));
  });
});
