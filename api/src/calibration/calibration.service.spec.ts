import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PerfGrade, Prisma } from '@prisma/client';
import { CalibrationService, buildGradeDistribution, normalizeVeto } from './calibration.service';
import { PrismaService } from '@/prisma/prisma.service';
import { FlowService } from '@/tasks/flow.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { CalibrationItemDto } from './dto/calibrate-grades.dto';

function makeCycle(overrides?: Partial<{ gradeAMaxRatio: number; gradeBMaxRatio: number; gradeCMaxRatio: number; gradeDMaxRatio: number }>) {
  return {
    gradeAMaxRatio: new Prisma.Decimal(overrides?.gradeAMaxRatio ?? 0.2),
    gradeBMaxRatio: new Prisma.Decimal(overrides?.gradeBMaxRatio ?? 0.4),
    gradeCMaxRatio: new Prisma.Decimal(overrides?.gradeCMaxRatio ?? 0.3),
    gradeDMaxRatio: new Prisma.Decimal(overrides?.gradeDMaxRatio ?? 0.1),
  };
}

describe('CalibrationService core', () => {
  describe('buildGradeDistribution', () => {
    it('基于 calibratedGrade 计数，未校准时回退 rawGrade', () => {
      const tasks = [
        { gradeResult: { calibratedGrade: 'A' as PerfGrade, rawGrade: 'B' as PerfGrade } },
        { gradeResult: { calibratedGrade: null, rawGrade: 'B' as PerfGrade } },
        { gradeResult: { calibratedGrade: 'B' as PerfGrade, rawGrade: 'C' as PerfGrade } },
        { gradeResult: { calibratedGrade: 'D' as PerfGrade, rawGrade: 'C' as PerfGrade } },
      ];

      const dist = buildGradeDistribution(tasks, makeCycle());

      expect(dist.A).toEqual({ count: 1, ratio: 0.25, maxRatio: 0.2, isOverLimit: true });
      expect(dist.B).toEqual({ count: 2, ratio: 0.5, maxRatio: 0.4, isOverLimit: true });
      expect(dist.C).toEqual({ count: 0, ratio: 0, maxRatio: 0.3, isOverLimit: false });
      expect(dist.D).toEqual({ count: 1, ratio: 0.25, maxRatio: 0.1, isOverLimit: true });
    });

    it('空任务列表时全部返回 0', () => {
      const dist = buildGradeDistribution([], makeCycle());
      for (const grade of ['A', 'B', 'C', 'D'] as PerfGrade[]) {
        expect(dist[grade]).toEqual({ count: 0, ratio: 0, maxRatio: expect.any(Number), isOverLimit: false });
      }
    });

    it('恰好等于上限时不触发超限', () => {
      const tasks = [
        { gradeResult: { calibratedGrade: 'A' as PerfGrade, rawGrade: 'A' as PerfGrade } },
        { gradeResult: { calibratedGrade: 'A' as PerfGrade, rawGrade: 'A' as PerfGrade } },
        { gradeResult: { calibratedGrade: 'B' as PerfGrade, rawGrade: 'B' as PerfGrade } },
        { gradeResult: { calibratedGrade: 'B' as PerfGrade, rawGrade: 'B' as PerfGrade } },
        { gradeResult: { calibratedGrade: 'C' as PerfGrade, rawGrade: 'C' as PerfGrade } },
        { gradeResult: { calibratedGrade: 'D' as PerfGrade, rawGrade: 'D' as PerfGrade } },
        { gradeResult: { calibratedGrade: 'D' as PerfGrade, rawGrade: 'D' as PerfGrade } },
        { gradeResult: { calibratedGrade: 'D' as PerfGrade, rawGrade: 'D' as PerfGrade } },
        { gradeResult: { calibratedGrade: 'D' as PerfGrade, rawGrade: 'D' as PerfGrade } },
        { gradeResult: { calibratedGrade: 'D' as PerfGrade, rawGrade: 'D' as PerfGrade } },
      ];

      const dist = buildGradeDistribution(tasks, makeCycle({ gradeAMaxRatio: 0.2, gradeBMaxRatio: 0.2, gradeCMaxRatio: 0.5, gradeDMaxRatio: 0.5 }));
      expect(dist.A.isOverLimit).toBe(false);
      expect(dist.B.isOverLimit).toBe(false);
      expect(dist.C.isOverLimit).toBe(false);
      expect(dist.D.isOverLimit).toBe(false);
    });
  });

  describe('normalizeVeto', () => {
    it('isVeto=true 时强制返回 grade=D', () => {
      const item: CalibrationItemDto = {
        taskId: 'task-1',
        calibratedGrade: 'D',
        isVeto: true,
        vetoReason: '重大失误',
      };

      const result = normalizeVeto(item);
      expect(result).toEqual({ isVeto: true, grade: 'D', vetoReason: '重大失误' });
    });

    it('isVeto=true 且 calibratedGrade 不是 D 时抛 4001', () => {
      const item: CalibrationItemDto = {
        taskId: 'task-1',
        calibratedGrade: 'B',
        isVeto: true,
        vetoReason: '重大失误',
      };

      expect(() => normalizeVeto(item)).toThrow(BadRequestException);
      try {
        normalizeVeto(item);
      } catch (err) {
        expect((err as BadRequestException).getResponse()).toMatchObject({ code: ERROR_CODE.PARAM_INVALID });
      }
    });

    it('isVeto=true 但缺少 vetoReason 时抛 4001', () => {
      const item: CalibrationItemDto = {
        taskId: 'task-1',
        calibratedGrade: 'D',
        isVeto: true,
      };

      expect(() => normalizeVeto(item)).toThrow(BadRequestException);
    });

    it('isVeto=true 但 vetoReason 为空字符串时抛 4001', () => {
      const item: CalibrationItemDto = {
        taskId: 'task-1',
        calibratedGrade: 'D',
        isVeto: true,
        vetoReason: '   ',
      };

      expect(() => normalizeVeto(item)).toThrow(BadRequestException);
    });

    it('非否决时保持原 grade', () => {
      const item: CalibrationItemDto = {
        taskId: 'task-1',
        calibratedGrade: 'B',
      };

      const result = normalizeVeto(item);
      expect(result).toEqual({ isVeto: false, grade: 'B', vetoReason: undefined });
    });
  });
});

describe('CalibrationService DI', () => {
  let service: CalibrationService;
  let prisma: any;
  let transactionClient: any;
  let flowService: { transitionTx: jest.Mock };

  beforeEach(async () => {
    transactionClient = {
      assessmentTask: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn(),
      },
      gradeResult: { upsert: jest.fn() },
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
        { provide: NotificationsService, useValue: { create: jest.fn() } },
      ],
    }).compile();

    service = module.get<CalibrationService>(CalibrationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('claims the current HR-calibration status and version before saving a draft', async () => {
    const updatedAt = new Date('2026-08-08T08:00:00.000Z');
    const task = {
      id: '11111111-1111-4111-8111-111111111111',
      cycleId: 'cycle-1',
      status: 'hr_calibration',
      updatedAt,
      isExempt: false,
      employeeId: 'emp-1',
      managerId: 'mgr-1',
      deptHeadId: 'head-1',
      approverId: 'vp-1',
      gradeResult: { calculatedScore: new Prisma.Decimal(88), rawGrade: 'B' },
    };
    prisma.assessmentCycle.findUnique.mockResolvedValue({ id: 'cycle-1', name: 'Cycle', ...makeCycle() });
    prisma.assessmentTask.findMany
      .mockResolvedValueOnce([task])
      .mockResolvedValueOnce([
        {
          ...task,
          employee: { name: 'Employee', position: null },
          dept: { name: 'Department' },
          manager: { name: 'Manager' },
          gradeResult: { ...task.gradeResult, calibratedGrade: 'B', isVeto: false },
        },
      ]);

    await service.calibrateGrades(
      'cycle-1',
      {
        submit: false,
        calibrations: [{ taskId: task.id, calibratedGrade: 'B', calibrationNote: 'Draft' }],
      },
      { id: 'hr-1' } as any,
    );

    expect(transactionClient.assessmentTask.updateMany).toHaveBeenCalledWith({
      where: { id: task.id, updatedAt, status: 'hr_calibration' },
      data: { updatedAt: expect.any(Date) },
    });
    expect(transactionClient.assessmentTask.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      transactionClient.gradeResult.upsert.mock.invocationCallOrder[0],
    );
  });

  it('uses the claimed HR-calibration version for the submit transition', async () => {
    const updatedAt = new Date('2026-08-08T08:00:00.000Z');
    const task = {
      id: '11111111-1111-4111-8111-111111111111',
      cycleId: 'cycle-1',
      status: 'hr_calibration',
      updatedAt,
      isExempt: false,
      employeeId: 'emp-1',
      managerId: 'mgr-1',
      deptHeadId: 'head-1',
      approverId: null,
      gradeResult: { calculatedScore: new Prisma.Decimal(88), rawGrade: 'B', calibratedGrade: 'B' },
    };
    prisma.assessmentCycle.findUnique.mockResolvedValue({ id: 'cycle-1', name: 'Cycle', ...makeCycle() });
    prisma.assessmentTask.findMany
      .mockResolvedValueOnce([task])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          ...task,
          employee: { name: 'Employee', position: null },
          dept: { name: 'Department' },
          manager: { name: 'Manager' },
          gradeResult: { ...task.gradeResult, isVeto: false },
        },
      ]);
    transactionClient.assessmentTask.findMany.mockResolvedValue([task]);

    await service.calibrateGrades(
      'cycle-1',
      { submit: true, calibrations: [{ taskId: task.id, calibratedGrade: 'B' }] },
      { id: 'hr-1' } as any,
    );

    expect(flowService.transitionTx).toHaveBeenCalledWith(
      transactionClient,
      expect.objectContaining({
        task,
        action: 'submit',
        targetStatus: 'approval',
        taskUpdate: expect.objectContaining({
          hrCalibratedAt: expect.any(Date),
          updatedAt: expect.any(Date),
        }),
      }),
    );
    expect(transactionClient.assessmentTask.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      flowService.transitionTx.mock.invocationCallOrder[0],
    );
  });
});
