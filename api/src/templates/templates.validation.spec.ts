import { validateTemplateWeights, assertTemplateWeights, DimensionInput } from './templates.validation';
import { BadRequestException } from '@nestjs/common';
import { ERROR_CODE } from '@/common/constants/error-codes';

/** 构造一个有效指标。 */
function ind(name: string, weight: number) {
  return { name, weight };
}

describe('validateTemplateWeights', () => {
  it('kpi+attitude 维度权重和 = 1 通过', () => {
    const dimensions: DimensionInput[] = [
      { name: 'KPI', weight: 0.7, type: 'kpi', indicators: [ind('指标1', 1)] },
      { name: '态度', weight: 0.3, type: 'attitude', indicators: [ind('指标2', 1)] },
    ];
    expect(validateTemplateWeights(dimensions)).toEqual({ valid: true });
  });

  it('kpi+attitude 维度权重和不等于 1 失败', () => {
    const dimensions: DimensionInput[] = [
      { name: 'KPI', weight: 0.6, type: 'kpi', indicators: [ind('指标1', 1)] },
      { name: '态度', weight: 0.3, type: 'attitude', indicators: [ind('指标2', 1)] },
    ];
    expect(validateTemplateWeights(dimensions)).toEqual({
      valid: false,
      message: 'kpi/attitude 维度权重之和必须等于 1',
    });
  });

  it('含 bonus/penalty 维度不影响 kpi/attitude 和校验', () => {
    const dimensions: DimensionInput[] = [
      { name: 'KPI', weight: 0.7, type: 'kpi', indicators: [ind('指标1', 1)] },
      { name: '态度', weight: 0.3, type: 'attitude', indicators: [ind('指标2', 1)] },
      { name: '奖金', weight: 0.5, type: 'bonus', indicators: [ind('加分项', 1)] },
      { name: '惩罚', weight: 0.2, type: 'penalty', indicators: [ind('扣分项', 1)] },
    ];
    expect(validateTemplateWeights(dimensions)).toEqual({ valid: true });
  });

  it('容差边界：0.9995 通过', () => {
    const dimensions: DimensionInput[] = [
      { name: 'KPI', weight: 0.6995, type: 'kpi', indicators: [ind('指标1', 1)] },
      { name: '态度', weight: 0.3, type: 'attitude', indicators: [ind('指标2', 1)] },
    ];
    expect(validateTemplateWeights(dimensions)).toEqual({ valid: true });
  });

  it('容差边界：1.001 通过', () => {
    const dimensions: DimensionInput[] = [
      { name: 'KPI', weight: 0.701, type: 'kpi', indicators: [ind('指标1', 1)] },
      { name: '态度', weight: 0.3, type: 'attitude', indicators: [ind('指标2', 1)] },
    ];
    expect(validateTemplateWeights(dimensions)).toEqual({ valid: true });
  });

  it('容差边界：1.002 失败', () => {
    const dimensions: DimensionInput[] = [
      { name: 'KPI', weight: 0.702, type: 'kpi', indicators: [ind('指标1', 1)] },
      { name: '态度', weight: 0.3, type: 'attitude', indicators: [ind('指标2', 1)] },
    ];
    expect(validateTemplateWeights(dimensions)).toEqual({
      valid: false,
      message: 'kpi/attitude 维度权重之和必须等于 1',
    });
  });

  it('kpi/attitude 维度内指标权重和 = 1 通过', () => {
    const dimensions: DimensionInput[] = [
      {
        name: 'KPI',
        weight: 0.7,
        type: 'kpi',
        indicators: [ind('指标1', 0.4), ind('指标2', 0.6)],
      },
      { name: '态度', weight: 0.3, type: 'attitude', indicators: [ind('指标3', 1)] },
    ];
    expect(validateTemplateWeights(dimensions)).toEqual({ valid: true });
  });

  it('kpi/attitude 维度内指标权重和不等于 1 失败', () => {
    const dimensions: DimensionInput[] = [
      {
        name: 'KPI',
        weight: 0.7,
        type: 'kpi',
        indicators: [ind('指标1', 0.3), ind('指标2', 0.6)],
      },
      { name: '态度', weight: 0.3, type: 'attitude', indicators: [ind('指标3', 1)] },
    ];
    expect(validateTemplateWeights(dimensions)).toEqual({
      valid: false,
      message: '维度“KPI”内指标权重之和必须等于 1',
    });
  });

  it('bonus/penalty 维度内指标权重和不做校验', () => {
    const dimensions: DimensionInput[] = [
      { name: 'KPI', weight: 0.7, type: 'kpi', indicators: [ind('指标1', 1)] },
      { name: '态度', weight: 0.3, type: 'attitude', indicators: [ind('指标2', 1)] },
      {
        name: '奖金',
        weight: 0.5,
        type: 'bonus',
        indicators: [ind('指标3', 0.3), ind('指标4', 0.4)],
      },
    ];
    expect(validateTemplateWeights(dimensions)).toEqual({ valid: true });
  });

  it('指标权重容差边界：0.9995 通过、1.002 失败', () => {
    const pass: DimensionInput[] = [
      { name: 'KPI', weight: 1, type: 'kpi', indicators: [ind('指标1', 0.6995), ind('指标2', 0.3)] },
    ];
    expect(validateTemplateWeights(pass)).toEqual({ valid: true });

    const fail: DimensionInput[] = [
      { name: 'KPI', weight: 1, type: 'kpi', indicators: [ind('指标1', 0.702), ind('指标2', 0.3)] },
    ];
    expect(validateTemplateWeights(fail)).toEqual({
      valid: false,
      message: '维度“KPI”内指标权重之和必须等于 1',
    });
  });
});

describe('assertTemplateWeights', () => {
  it('校验通过时不抛异常', () => {
    const dimensions: DimensionInput[] = [
      { name: 'KPI', weight: 0.7, type: 'kpi', indicators: [ind('指标1', 1)] },
      { name: '态度', weight: 0.3, type: 'attitude', indicators: [ind('指标2', 1)] },
    ];
    expect(() => assertTemplateWeights(dimensions)).not.toThrow();
  });

  it('校验失败时抛出 BadRequestException', () => {
    const dimensions: DimensionInput[] = [
      { name: 'KPI', weight: 0.6, type: 'kpi', indicators: [ind('指标1', 1)] },
      { name: '态度', weight: 0.3, type: 'attitude', indicators: [ind('指标2', 1)] },
    ];
    expect(() => assertTemplateWeights(dimensions)).toThrow(BadRequestException);
    expect(() => assertTemplateWeights(dimensions)).toThrow(
      expect.objectContaining({
        response: {
          code: ERROR_CODE.PARAM_INVALID,
          message: 'kpi/attitude 维度权重之和必须等于 1',
        },
      }),
    );
  });
});
