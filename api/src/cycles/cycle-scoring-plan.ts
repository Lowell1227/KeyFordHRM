import { BadRequestException } from '@nestjs/common';
import { AssessmentPeriodType, CycleType, ScoringFrequency } from '@prisma/client';

export interface BuildPeriodDefinitionsInput {
  type: CycleType;
  scoringFrequency: ScoringFrequency;
  startDate: Date;
  endDate: Date;
}

export interface PeriodDefinition {
  periodKey: string;
  periodType: AssessmentPeriodType;
  sequence: number;
  periodStart: Date;
  periodEnd: Date;
}

/** Canonicalize all date-only values as UTC midnight; timestamps use separate fields. */
export function canonicalDateOnly(date: Date): Date {
  if (Number.isNaN(date.getTime())) throw new BadRequestException('日期必须是有效值');
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function businessDateKey(date: Date): string {
  return canonicalDateOnly(date).toISOString().slice(0, 10);
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** Apply the supported frequency defaults and cycle-type constraints. */
export function normalizeScoringFrequency(type: CycleType, requested?: ScoringFrequency): ScoringFrequency {
  if (type === CycleType.custom) return ScoringFrequency.cycle;
  if (type === CycleType.monthly) return ScoringFrequency.monthly;
  if (requested) return requested;
  return type === CycleType.quarterly || type === CycleType.semiannual || type === CycleType.annual
    ? ScoringFrequency.monthly
    : ScoringFrequency.cycle;
}

/** Build immutable period boundaries from canonical UTC date-only values. */
export function buildPeriodDefinitions(input: BuildPeriodDefinitionsInput): PeriodDefinition[] {
  const canonicalStart = canonicalDateOnly(input.startDate);
  const canonicalEnd = canonicalDateOnly(input.endDate);
  const start = getCalendarDate(canonicalStart);
  const end = getCalendarDate(canonicalEnd);

  if (compareCalendarDates(end, start) < 0) {
    throw new BadRequestException('结束日期不能早于开始日期');
  }

  const scoringFrequency = normalizeScoringFrequency(input.type, input.scoringFrequency);
  if (scoringFrequency === ScoringFrequency.cycle) {
    return [
      {
        periodKey: 'cycle',
        periodType: AssessmentPeriodType.cycle,
        sequence: 1,
        periodStart: canonicalStart,
        periodEnd: canonicalEnd,
      },
    ];
  }

  const periods: PeriodDefinition[] = [];
  let year = start.year;
  let month = start.month;
  let sequence = 1;

  while (year < end.year || (year === end.year && month <= end.month)) {
    const isFirstMonth = sequence === 1;
    const isLastMonth = year === end.year && month === end.month;
    const lastDay = daysInMonth(year, month);
    const periodStart = isFirstMonth ? canonicalStart : dateAtUtcMidnight(year, month, 1);
    const periodEnd = isLastMonth ? canonicalEnd : dateAtUtcMidnight(year, month, lastDay);

    periods.push({
      periodKey: `${year}-${String(month).padStart(2, '0')}`,
      periodType: AssessmentPeriodType.month,
      sequence,
      periodStart,
      periodEnd,
    });

    if (month === 12) {
      year += 1;
      month = 1;
    } else {
      month += 1;
    }
    sequence += 1;
  }

  return periods;
}

function getCalendarDate(date: Date): CalendarDate {
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('开始日期和结束日期必须是有效日期');
  }

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  return Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateAtUtcMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}
