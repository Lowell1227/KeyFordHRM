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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalibrationService,
        { provide: PrismaService, useValue: { $transaction: jest.fn() } },
        { provide: FlowService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
      ],
    }).compile();

    service = module.get<CalibrationService>(CalibrationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
