import { BadRequestException } from '@nestjs/common';
import { ERROR_CODE } from '@/common/constants/error-codes';

export interface DimensionInput {
  name: string;
  weight: number;
  type: string;
  indicators?: IndicatorInput[];
}

export interface IndicatorInput {
  name: string;
  weight: number;
}

export interface WeightValidationResult {
  valid: boolean;
  message?: string;
}

const TOLERANCE = 0.001;

export function validateTemplateWeights(dimensions: DimensionInput[]): WeightValidationResult {
  const coreDimensions = dimensions.filter((d) => d.type === 'kpi' || d.type === 'attitude');
  const coreWeightSum = coreDimensions.reduce((sum, d) => sum + d.weight, 0);
  if (Math.abs(coreWeightSum - 1) > TOLERANCE) {
    return { valid: false, message: 'kpi/attitude 维度权重之和必须等于 1' };
  }

  for (const dim of coreDimensions) {
    const indicators = dim.indicators ?? [];
    const indicatorWeightSum = indicators.reduce((sum, i) => sum + i.weight, 0);
    if (Math.abs(indicatorWeightSum - dim.weight) > TOLERANCE) {
      return {
        valid: false,
        message: `维度“${dim.name}”内指标权重之和必须等于该维度权重 ${dim.weight}`,
      };
    }
  }

  return { valid: true };
}

export function assertTemplateWeights(dimensions: DimensionInput[]): void {
  const result = validateTemplateWeights(dimensions);
  if (!result.valid) {
    throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: result.message });
  }
}
