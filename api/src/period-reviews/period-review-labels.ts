import type { AssessmentPeriodType } from '@prisma/client';

export function periodReviewTitle(periodType: AssessmentPeriodType, periodKey: string): string {
  if (periodType === 'cycle') return '整周期自评';
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
  return match ? `${match[1]}年${Number(match[2])}月月度自评` : `${periodKey}月度自评`;
}

export function periodReviewNoun(periodType: AssessmentPeriodType): string {
  return periodType === 'cycle' ? '整周期自评' : '月度自评';
}

export function managerPeriodReviewTitle(periodType: AssessmentPeriodType, periodKey: string): string {
  if (periodType === 'cycle') return '整周期主管评分';
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
  return match ? `${match[1]}年${Number(match[2])}月主管月度评分` : `${periodKey}主管月度评分`;
}
