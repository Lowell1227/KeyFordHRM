import type { AssessmentPeriodType } from '@prisma/client';

export function periodReviewTitle(periodType: AssessmentPeriodType, periodKey: string): string {
  if (periodType === 'cycle') return '整周期复盘与评分';
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
  return match ? `${match[1]}年${Number(match[2])}月复盘与评分` : `${periodKey}复盘与评分`;
}

export function periodReviewNoun(periodType: AssessmentPeriodType): string {
  return periodType === 'cycle' ? '整周期复盘' : '月度复盘';
}
