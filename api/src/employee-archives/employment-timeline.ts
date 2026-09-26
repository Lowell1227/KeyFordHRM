import { Prisma } from '@prisma/client';

export const approvedEmploymentSourceWhere: Prisma.EmploymentRecordWhereInput = {
  OR: [
    { sourceRequestId: null },
    { sourceRequest: { profileReviewStatus: 'approved', onboardingStatus: { not: 'cancelled' } } },
    { sourceRequest: { profileReviewStatus: 'approved', onboardingStatus: null } },
  ],
};

export interface EmploymentInterval {
  id: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdAt?: Date;
}

// Database dates are calendar-day labels (UTC midnight), not UTC instants.
export function shanghaiBusinessDate(at = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`);
}

export function nextBusinessDate(date: Date): Date {
  return new Date(date.getTime() + 86_400_000);
}

export interface EmploymentSelection<T extends EmploymentInterval> {
  current: T | null;
  matches: T[];
  warnings: string[];
}

export function intervalsOverlap(left: EmploymentInterval, right: EmploymentInterval): boolean {
  const leftEnd = left.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightEnd = right.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY;
  return left.effectiveFrom.getTime() <= rightEnd && right.effectiveFrom.getTime() <= leftEnd;
}

export function selectEmploymentAt<T extends EmploymentInterval>(
  records: T[],
  at: Date,
): EmploymentSelection<T> {
  const timestamp = at.getTime();
  const matches = records
    .filter((record) => (
      record.effectiveFrom.getTime() <= timestamp
      && (record.effectiveTo === null || record.effectiveTo.getTime() >= timestamp)
    ))
    .sort((left, right) => right.effectiveFrom.getTime() - left.effectiveFrom.getTime()
      || (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0)
      || right.id.localeCompare(left.id));
  return {
    current: matches[0] ?? null,
    matches,
    warnings: matches.length > 1 ? ['任职时间重叠'] : [],
  };
}

export function employmentWarnings<T extends EmploymentInterval>(
  records: T[],
  proposed: EmploymentInterval,
): string[] {
  const overlapCount = records.filter((record) => (
    record.id !== proposed.id && intervalsOverlap(record, proposed)
  )).length;
  return overlapCount > 0
    ? [`与 ${overlapCount} 条已有任职记录时间重叠，仅作提醒，不影响提交和审核`]
    : [];
}
