export interface EmploymentInterval {
  id: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
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
    .sort((left, right) => right.effectiveFrom.getTime() - left.effectiveFrom.getTime());
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
  return overlapCount > 0 ? [`任职时间与 ${overlapCount} 条已有记录重叠`] : [];
}
