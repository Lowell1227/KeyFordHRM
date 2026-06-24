/** 分数输入允许的最小/最大值。 */
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;
export const SCORE_STEP = 0.5;

/** 校验分数是否在合法范围。 */
export function isValidScore(value?: number | string | null): boolean {
  if (value == null || value === '') return false;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(num)) return false;
  return num >= SCORE_MIN && num <= SCORE_MAX;
}

/** 格式化分数显示，保留一位小数（去除多余 .0）。 */
export function formatScore(value?: number | string | null): string {
  if (value == null || value === '') return '-';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(num)) return '-';
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

/** 将输入值约束到合法范围并按步长取整。 */
export function normalizeScore(value?: number | string | null): number | undefined {
  if (value == null || value === '') return undefined;
  let num = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(num)) return undefined;
  num = Math.max(SCORE_MIN, Math.min(SCORE_MAX, num));
  // 按步长取整
  const steps = Math.round(num / SCORE_STEP);
  num = steps * SCORE_STEP;
  // 防止浮点误差
  return Math.round(num * 10) / 10;
}

/** 计算加权总分。 */
export function calcWeightedTotal(
  items: Array<{ score?: number | null; weight?: number | null }>,
): number {
  let total = 0;
  let totalWeight = 0;
  for (const item of items) {
    if (item.score == null || item.weight == null) continue;
    total += item.score * item.weight;
    totalWeight += item.weight;
  }
  if (totalWeight === 0) return 0;
  return Math.round((total / totalWeight) * 10) / 10;
}

/** 计算简单平均分。 */
export function calcAverageScore(scores: Array<number | null | undefined>): number {
  const valid = scores.filter((s): s is number => s != null && !Number.isNaN(s));
  if (valid.length === 0) return 0;
  const sum = valid.reduce((a, b) => a + b, 0);
  return Math.round((sum / valid.length) * 10) / 10;
}

/** 计算指标实例的最终得分：考虑加减分项与否决。 */
export function calcInstanceFinalScore(instance: {
  managerScore?: number | null;
  extraScores?: Array<{ value: number }>;
}): number | undefined {
  if (instance.managerScore == null) return undefined;
  let score = instance.managerScore;
  if (instance.extraScores?.length) {
    score += instance.extraScores.reduce((sum, item) => sum + (item.value ?? 0), 0);
  }
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, Math.round(score * 10) / 10));
}

/** 生成越界提示文案。 */
export function getScoreOutOfRangeMessage(value?: number | string | null): string | null {
  if (value == null || value === '') return null;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(num)) return '请输入有效数字';
  if (num < SCORE_MIN) return `分数不能低于 ${SCORE_MIN}`;
  if (num > SCORE_MAX) return `分数不能高于 ${SCORE_MAX}`;
  return null;
}
