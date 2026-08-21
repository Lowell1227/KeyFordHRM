export interface TemplateWeightDimension {
  name?: string;
  type: string;
  weight?: number;
  indicators: Array<{ weight?: number }>;
}

const TOLERANCE = 0.01;

export function sumWeights(items: Array<{ weight?: number }>): number {
  return Number(items.reduce((sum, item) => sum + (Number(item.weight) || 0), 0).toFixed(2));
}

export function isWeightComplete(value: number, target = 100): boolean {
  return Math.abs(value - target) <= TOLERANCE;
}

export function validateTemplateWeightsPercent(dimensions: TemplateWeightDimension[]): string | null {
  const coreDimensions = dimensions.filter((dimension) =>
    dimension.type === 'kpi' || dimension.type === 'attitude');
  if (coreDimensions.length === 0) return null;

  const coreWeightSum = sumWeights(coreDimensions);
  if (!isWeightComplete(coreWeightSum)) {
    return `维度权重合计应为 100%，当前 ${coreWeightSum.toFixed(2)}%`;
  }

  for (const dimension of coreDimensions) {
    const dimensionWeight = Number(dimension.weight) || 0;
    const indicatorWeightSum = sumWeights(dimension.indicators);
    if (!isWeightComplete(indicatorWeightSum, dimensionWeight)) {
      return `维度「${dimension.name || '未命名'}」的指标权重合计应等于维度权重 ${dimensionWeight.toFixed(2)}%，当前 ${indicatorWeightSum.toFixed(2)}%`;
    }
  }

  return null;
}
