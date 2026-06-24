import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DimensionType, IndicatorType, PerfGrade } from '@prisma/client';
import { ScoringService, ScorableIndicator } from './scoring.service';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';

describe('ScoringService', () => {
  let service: ScoringService;
  let prisma: { systemConfig: { findUnique: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      systemConfig: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScoringService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ScoringService>(ScoringService);
  });

  describe('validateScore', () => {
    it('合法分数不抛异常', () => {
      expect(() => service.validateScore(0, 100)).not.toThrow();
      expect(() => service.validateScore(100, 100)).not.toThrow();
      expect(() => service.validateScore(50.5, 100)).not.toThrow();
    });

    it('越界分数抛 4001', () => {
      expect(() => service.validateScore(-1, 100)).toThrow(BadRequestException);
      expect(() => service.validateScore(101, 100)).toThrow(BadRequestException);
      try {
        service.validateScore(101, 100);
      } catch (err) {
        expect((err as BadRequestException).getResponse()).toMatchObject({ code: ERROR_CODE.PARAM_INVALID });
      }
    });
  });

  describe('calcFinalScore', () => {
    it('final_score 等于 manager_score', () => {
      expect(service.calcFinalScore(88)).toBe(88);
      expect(service.calcFinalScore(0)).toBe(0);
    });
  });

  describe('calcRawGrade', () => {
    it.each([
      [95, 'A'],
      [90, 'A'],
      [89, 'B'],
      [75, 'B'],
      [60, 'C'],
      [59, 'D'],
      [0, 'D'],
    ] as [number, PerfGrade][])('总分 %i 映射为 %s', (score, expected) => {
      expect(service.calcRawGrade(score, { A: 90, B: 75, C: 60 })).toBe(expected);
    });
  });

  describe('calcDimensionScore', () => {
    it('kpi 维度：Σ(final_score × weight) × dimensionWeight', () => {
      const indicators = [
        { weight: 0.6, finalScore: 80 },
        { weight: 0.4, finalScore: 90 },
      ];
      // (80*0.6 + 90*0.4) * 0.8 = (48+36)*0.8 = 67.2
      expect(service.calcDimensionScore('kpi' as DimensionType, 0.8, indicators)).toBeCloseTo(67.2, 5);
    });

    it('attitude 维度加权正确', () => {
      const indicators = [
        { weight: 0.5, finalScore: 70 },
        { weight: 0.5, finalScore: 80 },
      ];
      // (70*0.5 + 80*0.5) * 0.2 = 75*0.2 = 15
      expect(service.calcDimensionScore('attitude' as DimensionType, 0.2, indicators)).toBeCloseTo(15, 5);
    });

    it('bonus 维度直加，不乘任何权重', () => {
      const indicators = [
        { weight: 0.5, finalScore: 10 },
        { weight: 0.5, finalScore: 20 },
      ];
      expect(service.calcDimensionScore('bonus' as DimensionType, 0.8, indicators)).toBeCloseTo(30, 5);
    });

    it('penalty 维度直扣，不乘任何权重', () => {
      const indicators = [
        { weight: 0.5, finalScore: 5 },
        { weight: 0.5, finalScore: 3 },
      ];
      expect(service.calcDimensionScore('penalty' as DimensionType, 0.8, indicators)).toBeCloseTo(-8, 5);
    });
  });

  describe('calcTaskTotal', () => {
    it('kpi 80% + attitude 20% 加权正确', () => {
      const indicators: ScorableIndicator[] = [
        makeIndicator({ dimensionType: 'kpi', dimensionWeight: 0.8, weight: 0.6, finalScore: 80 }),
        makeIndicator({ dimensionType: 'kpi', dimensionWeight: 0.8, weight: 0.4, finalScore: 90 }),
        makeIndicator({ dimensionType: 'attitude', dimensionWeight: 0.2, weight: 1, finalScore: 75 }),
      ];
      const result = service.calcTaskTotal(indicators);
      // kpi: (80*0.6 + 90*0.4)*0.8 = 67.2
      // attitude: 75*1*0.2 = 15
      expect(result.totalScore).toBeCloseTo(82.2, 5);
      expect(result.rawGrade).toBe('B');
    });

    it('bonus 直加、penalty 直扣、均不乘维度权重', () => {
      const indicators: ScorableIndicator[] = [
        makeIndicator({ dimensionType: 'kpi', dimensionWeight: 1, weight: 1, finalScore: 80 }),
        makeIndicator({ dimensionType: 'bonus', dimensionWeight: 1, weight: 0.5, finalScore: 10 }),
        makeIndicator({ dimensionType: 'bonus', dimensionWeight: 1, weight: 0.5, finalScore: 5 }),
        makeIndicator({ dimensionType: 'penalty', dimensionWeight: 1, weight: 1, finalScore: 3 }),
      ];
      const result = service.calcTaskTotal(indicators);
      // 80 + 15 - 3 = 92
      expect(result.totalScore).toBeCloseTo(92, 5);
      expect(result.rawGrade).toBe('A');
    });

    it('veto 类型不参与数值总分', () => {
      const indicators: ScorableIndicator[] = [
        makeIndicator({ dimensionType: 'kpi', dimensionWeight: 1, weight: 1, finalScore: 80 }),
        makeIndicator({ dimensionType: 'kpi', dimensionWeight: 1, weight: 1, finalScore: 90, indicatorType: 'veto' }),
      ];
      const result = service.calcTaskTotal(indicators);
      expect(result.totalScore).toBeCloseTo(80, 5);
      expect(result.dimensionScores).toHaveLength(1);
      expect(result.dimensionScores[0].indicators).toHaveLength(2);
    });

    it('满分与 0 分边界', () => {
      const full = service.calcTaskTotal([
        makeIndicator({ dimensionType: 'kpi', dimensionWeight: 1, weight: 1, finalScore: 100 }),
      ]);
      expect(full.totalScore).toBeCloseTo(100, 5);
      expect(full.rawGrade).toBe('A');

      const zero = service.calcTaskTotal([
        makeIndicator({ dimensionType: 'kpi', dimensionWeight: 1, weight: 1, finalScore: 0 }),
      ]);
      expect(zero.totalScore).toBeCloseTo(0, 5);
      expect(zero.rawGrade).toBe('D');
    });
  });

  function makeIndicator(overrides: Partial<ScorableIndicator>): ScorableIndicator {
    const dimensionType = (overrides.dimensionType ?? 'kpi') as DimensionType;
    return {
      id: 'ind-' + Math.random().toString(36).slice(2),
      name: '指标',
      indicatorType: 'kpi' as IndicatorType,
      dimensionName: `${dimensionType}维度`,
      dimensionType,
      dimensionWeight: 1,
      weight: 1,
      managerScore: 0,
      finalScore: 0,
      ...overrides,
    };
  }
});
