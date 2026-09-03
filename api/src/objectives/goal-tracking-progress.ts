export interface GoalProgressRecord {
  id: string;
  createdAt: Date;
  period?: { periodKey: string } | null;
  periodReviewRevisionId?: string | null;
}

export type GoalProgressSource =
  | 'active_progress'
  | 'monthly_self_evaluation';

const SHANGHAI_MONTH_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
});

export function shanghaiMonthKey(date: Date): string {
  const parts = SHANGHAI_MONTH_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) {
    throw new RangeError('无法计算目标进展所属月份');
  }
  return `${year}-${month}`;
}

export function progressBusinessPeriodKey(record: GoalProgressRecord): string {
  if (record.periodReviewRevisionId && record.period?.periodKey) {
    return record.period.periodKey;
  }
  return shanghaiMonthKey(record.createdAt);
}

export function progressSource(
  record: GoalProgressRecord,
): GoalProgressSource {
  return record.periodReviewRevisionId
    ? 'monthly_self_evaluation'
    : 'active_progress';
}

export function sortGoalProgress<T extends GoalProgressRecord>(records: T[]): T[] {
  return [...records].sort((left, right) => {
    const monthOrder = progressBusinessPeriodKey(right).localeCompare(
      progressBusinessPeriodKey(left),
    );
    if (monthOrder !== 0) return monthOrder;
    const createdOrder = right.createdAt.getTime() - left.createdAt.getTime();
    if (createdOrder !== 0) return createdOrder;
    return right.id.localeCompare(left.id);
  });
}

export function currentGoalProgress<T extends GoalProgressRecord>(
  records: T[],
): T | null {
  return sortGoalProgress(records)[0] ?? null;
}
