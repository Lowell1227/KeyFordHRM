import { Prisma } from '@prisma/client';
import { PeriodAggregationService } from './period-aggregation.service';

describe('PeriodAggregationService', () => {
  const tx = {
    $queryRaw: jest.fn(),
    assessmentTask: { findUnique: jest.fn() },
    systemConfig: { findUnique: jest.fn() },
    gradeResult: { upsert: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const scoring = { calcRawGrade: jest.fn().mockReturnValue('B') };
  const flow = { transitionTx: jest.fn() };
  const service = new PeriodAggregationService(scoring as any, flow as any);

  beforeEach(() => {
    jest.clearAllMocks();
    tx.systemConfig.findUnique.mockResolvedValue({ value: { A: 90, B: 75, C: 60 } });
    flow.transitionTx.mockResolvedValue({ newStatus: 'dept_review' });
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

  it('equally averages every completed monthly total after all submissions lock', async () => {
    tx.assessmentTask.findUnique.mockResolvedValue({
      id: 'task-1', cycleId: 'cycle-1', status: 'manager_scoring',
      managerId: 'manager-1', deptHeadId: 'head-1', cycle: { workflowVersion: 2 },
      periods: [completedPeriod(80), completedPeriod(90), completedPeriod(85.555)],
    });

    const result = await service.refreshTask('task-1', tx as any, 'manager-1');

    expect(result).toEqual({ complete: true, score: 85.19, targetStatus: 'dept_review' });
    expect(tx.gradeResult.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ calculatedScore: 85.19, rawGrade: 'B' }),
      update: expect.objectContaining({ calculatedScore: 85.19, rawGrade: 'B' }),
    }));
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

  it('moves directly to HR calibration when the manager is also the department head', async () => {
    tx.assessmentTask.findUnique.mockResolvedValue({
      id: 'task-1', cycleId: 'cycle-1', status: 'manager_scoring',
      managerId: 'manager-1', deptHeadId: 'manager-1',
      periods: [completedPeriod(92)],
    });

    await expect(service.refreshTask('task-1', tx as any, 'manager-1'))
      .resolves.toEqual({ complete: true, score: 92, targetStatus: 'hr_calibration' });
    expect(flow.transitionTx).toHaveBeenCalledWith(tx, expect.objectContaining({
      targetStatus: 'hr_calibration',
    }));
  });

  it('repairs a workflow v2 score already advanced by the legacy route without transitioning twice', async () => {
    tx.assessmentTask.findUnique.mockResolvedValue({
      id: 'task-1', cycleId: 'cycle-1', status: 'hr_calibration',
      managerId: 'manager-1', deptHeadId: 'manager-1',
      cycle: { workflowVersion: 2 },
      periods: [completedPeriod(90)],
    });

    await expect(service.refreshTask('task-1', tx as any, 'manager-1'))
      .resolves.toEqual({ complete: true, score: 90, targetStatus: 'hr_calibration' });
    expect(tx.gradeResult.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ calculatedScore: 90 }),
    }));
    expect(flow.transitionTx).not.toHaveBeenCalled();
  });

  function completedPeriod(score: number) {
    return {
      status: 'completed',
      managerScoreTotal: new Prisma.Decimal(score),
      employeeSubmittedAt: new Date('2026-07-30T08:00:00.000Z'),
      managerSubmittedAt: new Date('2026-07-31T08:00:00.000Z'),
      lockedAt: new Date('2026-07-31T08:00:00.000Z'),
    };
  }
});
