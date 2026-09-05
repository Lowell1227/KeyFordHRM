import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PerfGrade, Prisma, TaskStatus } from '@prisma/client';
import { CalibrationService, buildGradeDistribution, buildProgress } from './calibration.service';
import { PrismaService } from '@/prisma/prisma.service';
import { FlowService } from '@/tasks/flow.service';
import { NotificationsService } from '@/notifications/notifications.service';

function makeCycle(overrides?: Partial<{ gradeAMaxRatio: number; gradeBMaxRatio: number; gradeCMaxRatio: number; gradeDMaxRatio: number }>) {
  return {
    gradeAMaxRatio: new Prisma.Decimal(overrides?.gradeAMaxRatio ?? 0.2),
    gradeBMaxRatio: new Prisma.Decimal(overrides?.gradeBMaxRatio ?? 0.4),
    gradeCMaxRatio: new Prisma.Decimal(overrides?.gradeCMaxRatio ?? 0.3),
    gradeDMaxRatio: new Prisma.Decimal(overrides?.gradeDMaxRatio ?? 0.1),
  };
}

const inChain = (status: TaskStatus) => ({ status, gradeResult: null as null | { calibratedGrade: PerfGrade | null; rawGrade: PerfGrade | null } });

describe('buildGradeDistribution（审核制）', () => {
  it('以已进入评定链路的任务为分母，effectiveGrade=calibratedGrade 回退 rawGrade', () => {
    const tasks = [
      { ...inChain('hr_calibration'), gradeResult: { calibratedGrade: 'A' as PerfGrade, rawGrade: 'B' as PerfGrade } },
      { ...inChain('dept_review'), gradeResult: { calibratedGrade: null, rawGrade: 'B' as PerfGrade } },
      { ...inChain('approval'), gradeResult: { calibratedGrade: 'B' as PerfGrade, rawGrade: 'C' as PerfGrade } },
      { ...inChain('hr_calibration'), gradeResult: { calibratedGrade: 'D' as PerfGrade, rawGrade: 'C' as PerfGrade } },
      // 评定中（manager_scoring）不计入分母
      { ...inChain('manager_scoring'), gradeResult: { calibratedGrade: null, rawGrade: 'A' as PerfGrade } },
    ];

    const dist = buildGradeDistribution(tasks, makeCycle());

    expect(dist.A.count).toBe(1);
    expect(dist.B.count).toBe(2);
    expect(dist.C.count).toBe(0);
    expect(dist.D.count).toBe(1);
    // 分母为 4（剔除评定中）
    expect(dist.A.ratio).toBe(0.25);
  });

  it('空任务列表时全部返回 0', () => {
    const dist = buildGradeDistribution([], makeCycle());
    for (const grade of ['A', 'B', 'C', 'D'] as PerfGrade[]) {
      expect(dist[grade]).toEqual({ count: 0, ratio: 0, maxRatio: expect.any(Number), isOverLimit: false });
    }
  });

  it('恰好等于上限时不触发超限', () => {
    const tasks = [
      { ...inChain('hr_calibration'), gradeResult: { calibratedGrade: 'A' as PerfGrade, rawGrade: 'A' as PerfGrade } },
      { ...inChain('hr_calibration'), gradeResult: { calibratedGrade: 'A' as PerfGrade, rawGrade: 'A' as PerfGrade } },
      { ...inChain('hr_calibration'), gradeResult: { calibratedGrade: 'B' as PerfGrade, rawGrade: 'B' as PerfGrade } },
      { ...inChain('hr_calibration'), gradeResult: { calibratedGrade: 'B' as PerfGrade, rawGrade: 'B' as PerfGrade } },
      { ...inChain('hr_calibration'), gradeResult: { calibratedGrade: 'C' as PerfGrade, rawGrade: 'C' as PerfGrade } },
      { ...inChain('hr_calibration'), gradeResult: { calibratedGrade: 'D' as PerfGrade, rawGrade: 'D' as PerfGrade } },
      { ...inChain('hr_calibration'), gradeResult: { calibratedGrade: 'D' as PerfGrade, rawGrade: 'D' as PerfGrade } },
      { ...inChain('hr_calibration'), gradeResult: { calibratedGrade: 'D' as PerfGrade, rawGrade: 'D' as PerfGrade } },
      { ...inChain('hr_calibration'), gradeResult: { calibratedGrade: 'D' as PerfGrade, rawGrade: 'D' as PerfGrade } },
      { ...inChain('hr_calibration'), gradeResult: { calibratedGrade: 'D' as PerfGrade, rawGrade: 'D' as PerfGrade } },
    ];

    const dist = buildGradeDistribution(tasks, makeCycle({ gradeAMaxRatio: 0.2, gradeBMaxRatio: 0.2, gradeCMaxRatio: 0.5, gradeDMaxRatio: 0.5 }));
    expect(dist.A.isOverLimit).toBe(false);
    expect(dist.B.isOverLimit).toBe(false);
    expect(dist.C.isOverLimit).toBe(false);
    expect(dist.D.isOverLimit).toBe(false);
  });
});

describe('buildProgress', () => {
  it('按任务状态统计各阶段数量', () => {
    const progress = buildProgress([
      { status: 'manager_scoring' as TaskStatus },
      { status: 'self_eval' as TaskStatus },
      { status: 'dept_review' as TaskStatus },
      { status: 'hr_calibration' as TaskStatus },
      { status: 'hr_calibration' as TaskStatus },
      { status: 'approval' as TaskStatus },
      { status: 'published' as TaskStatus },
    ]);

    expect(progress).toEqual({
      finalGrading: 2,
      deptReview: 1,
      pending: 2,
      inApproval: 1,
      done: 1,
    });
  });
});

describe('CalibrationService（确认/驳回）', () => {
  let service: CalibrationService;
  let prisma: any;
  let transactionClient: any;
  let flowService: { transitionTx: jest.Mock };

  const hrViewer = { id: 'hr-1', sysRole: 'hr' } as any;

  function makeTask(overrides?: Record<string, unknown>) {
    const updatedAt = new Date('2026-08-08T08:00:00.000Z');
    return {
      id: '11111111-1111-4111-8111-111111111111',
      cycleId: 'cycle-1',
      status: 'hr_calibration',
      updatedAt,
      isExempt: false,
      employeeId: 'emp-1',
      managerId: 'mgr-1',
      deptHeadId: 'head-1',
      approverId: 'vp-1',
      employee: { name: 'Employee', position: null },
      gradeResult: { calculatedScore: new Prisma.Decimal(88), rawGrade: 'B' },
      ...overrides,
    };
  }

  beforeEach(async () => {
    transactionClient = {
      assessmentTask: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      gradeResult: { updateMany: jest.fn() },
    };
    prisma = {
      assessmentCycle: { findUnique: jest.fn() },
      assessmentTask: { findMany: jest.fn() },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback(transactionClient)),
    };
    flowService = { transitionTx: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalibrationService,
        { provide: PrismaService, useValue: prisma },
        { provide: FlowService, useValue: flowService },
        { provide: NotificationsService, useValue: { create: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get<CalibrationService>(CalibrationService);
  });

  it('确认：认领版本后流转到审批并通知审批人', async () => {
    const task = makeTask();
    prisma.assessmentCycle.findUnique.mockResolvedValue({ id: 'cycle-1', name: 'Cycle', ...makeCycle() });
    prisma.assessmentTask.findMany
      .mockResolvedValueOnce([task])
      .mockResolvedValueOnce([{ ...task, dept: { name: 'Department' }, manager: { name: 'Manager' } }]);

    const result = await service.confirm('cycle-1', { taskIds: [task.id] }, hrViewer);

    expect(transactionClient.assessmentTask.updateMany).toHaveBeenCalledWith({
      where: { id: task.id, updatedAt: task.updatedAt, status: 'hr_calibration' },
      data: { updatedAt: expect.any(Date) },
    });
    expect(transactionClient.gradeResult.updateMany).toHaveBeenCalledWith({
      where: { taskId: task.id },
      data: { hrCalibratorId: 'hr-1', hrCalibratedAt: expect.any(Date) },
    });
    expect(flowService.transitionTx).toHaveBeenCalledWith(
      transactionClient,
      expect.objectContaining({ task, action: 'submit', targetStatus: 'approval' }),
    );
    expect(result.updated).toBe(1);
  });

  it('确认：任务不在待校准状态时抛 4001', async () => {
    const task = makeTask({ status: 'approval' });
    prisma.assessmentCycle.findUnique.mockResolvedValue({ id: 'cycle-1', name: 'Cycle', ...makeCycle() });
    prisma.assessmentTask.findMany.mockResolvedValue([task]);

    await expect(service.confirm('cycle-1', { taskIds: [task.id] }, hrViewer))
      .rejects.toThrow(BadRequestException);
  });

  it('驳回：原因必填，流转回 manager_scoring', async () => {
    const task = makeTask();
    prisma.assessmentCycle.findUnique.mockResolvedValue({ id: 'cycle-1', name: 'Cycle', ...makeCycle() });
    prisma.assessmentTask.findMany
      .mockResolvedValueOnce([task])
      .mockResolvedValueOnce([{ ...task, dept: { name: 'Department' }, manager: { name: 'Manager' } }]);

    const result = await service.reject('cycle-1', { taskIds: [task.id], reason: '分布超限，请重评' }, hrViewer);

    expect(flowService.transitionTx).toHaveBeenCalledWith(
      transactionClient,
      expect.objectContaining({
        task,
        action: 'reject',
        targetStatus: 'manager_scoring',
        comment: '分布超限，请重评',
      }),
    );
    expect(result.updated).toBe(1);
  });

  it('驳回：原因为空时抛 4001', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({ id: 'cycle-1', name: 'Cycle', ...makeCycle() });

    await expect(
      service.reject('cycle-1', { taskIds: [makeTask().id], reason: '   ' }, hrViewer),
    ).rejects.toThrow(BadRequestException);
  });

  it('loadGradeCoefficients 在配置缺失时返回默认系数 1', async () => {
    const coefficients = await service.loadGradeCoefficients();
    expect(coefficients).toEqual({ A: 1, B: 1, C: 1, D: 1 });
  });
});
