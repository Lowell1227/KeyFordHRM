import { BadRequestException, Injectable } from '@nestjs/common';
import { DimensionType, IndicatorInstance, IndicatorType, PerfGrade, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';

/** 参与总分计算的指标项（Decimal 已转 number）。 */
export interface ScorableIndicator {
  id: string;
  name: string;
  indicatorType: IndicatorType;
  dimensionName: string;
  dimensionType: DimensionType;
  dimensionWeight: number;
  weight: number;
  managerScore: number;
  finalScore: number;
}

/** 单个维度汇总结果。 */
export interface DimensionScore {
  dimensionName: string;
  dimensionType: DimensionType;
  dimensionWeight: number;
  score: number;
  indicators: Array<{
    id: string;
    name: string;
    weight: number;
    managerScore: number;
    finalScore: number;
  }>;
}

/** 任务算分结果。 */
export interface TaskScoreResult {
  totalScore: number;
  rawGrade: PerfGrade;
  dimensionScores: DimensionScore[];
}

/** 默认等级映射（后备值）。 */
const DEFAULT_GRADE_MAPPING = { A: 90, B: 75, C: 60 };

/**
 * 算分服务。
 *
 * 核心规则（决策 #4）：
 * - final_score = manager_score（单主管）
 * - kpi/attitude 维度：Σ(指标 final_score × 指标 weight) × 维度 weight
 * - bonus 维度：+ Σ(final_score)（直加，不乘维度权重，也不乘指标权重）
 * - penalty 维度：- Σ(final_score)（直扣，不乘维度权重，也不乘指标权重）
 * - veto 类型实例：不参与数值总分（一票否决由 HR 校准阶段处理）
 */
@Injectable()
export class ScoringService {
  constructor(private readonly prisma: PrismaService) {}

  /** 校验分数在合法范围 [0, maxScore]。 */
  validateScore(score: number, maxScore: number): void {
    if (Number.isNaN(score) || score < 0 || score > maxScore) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: `评分必须在 0 ~ ${maxScore} 之间`,
      });
    }
  }

  /** 单主管：final_score 等于 manager_score。 */
  calcFinalScore(managerScore: number): number {
    return managerScore;
  }

  /** 按 system_configs.grade_score_mapping 由总分映射 raw_grade。 */
  calcRawGrade(totalScore: number, mapping: Record<string, number>): PerfGrade {
    const { A = 90, B = 75, C = 60 } = mapping;
    if (totalScore >= A) return 'A';
    if (totalScore >= B) return 'B';
    if (totalScore >= C) return 'C';
    return 'D';
  }

  /** 计算单个维度得分。 */
  calcDimensionScore(
    dimensionType: DimensionType,
    dimensionWeight: number,
    indicators: Array<{ weight: number; finalScore: number }>,
  ): number {
    if (dimensionType === 'bonus') {
      // 直加：Σ(final_score)，不乘维度权重，也不乘指标权重
      return indicators.reduce((sum, ind) => sum + ind.finalScore, 0);
    }
    if (dimensionType === 'penalty') {
      // 直扣：-Σ(final_score)，不乘维度权重，也不乘指标权重
      return -indicators.reduce((sum, ind) => sum + ind.finalScore, 0);
    }

    // kpi / attitude：Σ(指标 final_score × 指标 weight) × 维度 weight
    const weightedSum = indicators.reduce((sum, ind) => sum + ind.finalScore * ind.weight, 0);
    return weightedSum * dimensionWeight;
  }

  /**
   * 计算任务数值总分及维度明细。
   *
   * 按 dimensionName 分组；veto 类型指标实例不参与数值总分，但仍保留在维度明细中供展示。
   */
  calcTaskTotal(indicators: ScorableIndicator[]): TaskScoreResult {
    const groups = this.groupByDimension(indicators);

    const dimensionScores: DimensionScore[] = [];
    let totalScore = 0;

    for (const group of groups) {
      // veto 实例不参与数值总分，但明细仍列出全部指标
      const nonVetoIndicators = group.filter((ind) => ind.indicatorType !== 'veto');
      const score = nonVetoIndicators.some((ind) => ind.indicatorType === 'bonus' || ind.indicatorType === 'penalty')
        ? nonVetoIndicators.reduce((sum, ind) => {
            if (ind.indicatorType === 'penalty') return sum - ind.finalScore;
            if (ind.indicatorType === 'bonus') return sum + ind.finalScore;
            return sum + ind.finalScore * ind.weight * ind.dimensionWeight;
          }, 0)
        : this.calcDimensionScore(
            group[0].dimensionType,
            group[0].dimensionWeight,
            nonVetoIndicators.map((ind) => ({ weight: ind.weight, finalScore: ind.finalScore })),
          );
      totalScore += score;

      dimensionScores.push({
        dimensionName: group[0].dimensionName,
        dimensionType: group[0].dimensionType,
        dimensionWeight: group[0].dimensionWeight,
        score,
        indicators: group.map((ind) => ({
          id: ind.id,
          name: ind.name,
          weight: ind.weight,
          managerScore: ind.managerScore,
          finalScore: ind.finalScore,
        })),
      });
    }

    return { totalScore, rawGrade: this.calcRawGrade(totalScore, DEFAULT_GRADE_MAPPING), dimensionScores };
  }

  /** 根据任务 ID 拉取指标实例，计算总分、raw_grade。 */
  async calculateTaskScore(taskId: string): Promise<TaskScoreResult> {
    const [indicators, gradeConfig] = await Promise.all([
      this.prisma.indicatorInstance.findMany({ where: { taskId } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'grade_score_mapping' } }),
    ]);

    const scorable = indicators.map((ind) => this.toScorableIndicator(ind));
    const result = this.calcTaskTotal(scorable);

    const mappingValue = gradeConfig?.value as Record<string, number> | undefined;
    const mapping = mappingValue ?? DEFAULT_GRADE_MAPPING;
    result.rawGrade = this.calcRawGrade(result.totalScore, mapping);

    return result;
  }

  /** 将 Prisma IndicatorInstance 转为可计算对象。 */
  toScorableIndicator(ind: IndicatorInstance): ScorableIndicator {
    const dimensionTypes: DimensionType[] = ['kpi', 'attitude', 'bonus', 'penalty'];
    const indicatorType = this.resolveIndicatorType(ind.name, ind.indicatorType);
    return {
      id: ind.id,
      name: ind.name,
      indicatorType,
      dimensionName: ind.dimensionName ?? '',
      dimensionType: (dimensionTypes.includes(indicatorType as DimensionType)
        ? indicatorType
        : 'kpi') as DimensionType,
      dimensionWeight: ind.dimensionWeight.toNumber(),
      weight: ind.weight.toNumber(),
      managerScore: ind.managerScore?.toNumber() ?? 0,
      finalScore: ind.finalScore?.toNumber() ?? 0,
    };
  }

  private resolveIndicatorType(name: string, type: IndicatorType): IndicatorType {
    if (name.includes('否决') || name.includes('鍚﹀喅') || name.toLowerCase().includes('veto')) return 'veto';
    if (name.includes('减') || name.includes('鍑') || name.toLowerCase().includes('penalty')) return 'penalty';
    if (name.includes('加') || name.includes('鍔犲') || name.toLowerCase().includes('bonus')) return 'bonus';
    return type;
  }

  private groupByDimension(indicators: ScorableIndicator[]): ScorableIndicator[][] {
    const map = new Map<string, ScorableIndicator[]>();
    for (const ind of indicators) {
      const key = ind.dimensionName || '__default__';
      const list = map.get(key) ?? [];
      list.push(ind);
      map.set(key, list);
    }
    return Array.from(map.values());
  }
}
