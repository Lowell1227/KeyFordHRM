import { BadRequestException } from '@nestjs/common';
import { AssessmentPeriodType, CycleType, ScoringFrequency } from '@prisma/client';

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const shanghaiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHANGHAI_TIME_ZONE,
  calendar: 'iso8601',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

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

/** Build immutable period boundaries from cycle calendar dates in Asia/Shanghai. */
export function buildPeriodDefinitions(input: BuildPeriodDefinitionsInput): PeriodDefinition[] {
  const start = getCalendarDate(input.startDate);
  const end = getCalendarDate(input.endDate);

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
        periodStart: cloneDate(input.startDate),
        periodEnd: cloneDate(input.endDate),
      },
    ];
  }

  const periods: PeriodDefinition[] = [];
  let year = start.year;
  let month = start.month;
  let sequence = 1;

  while (year < end.year || (year === end.year && month <= end.month)) {
    const isFirstMonth = year === start.year && month === start.month;
    const isLastMonth = year === end.year && month === end.month;
    const lastDay = daysInMonth(year, month);

    periods.push({
      periodKey: `${year}-${String(month).padStart(2, '0')}`,
      periodType: AssessmentPeriodType.month,
      sequence,
      periodStart: isFirstMonth ? cloneDate(input.startDate) : dateAtShanghaiMidnight(year, month, 1),
      periodEnd: isLastMonth ? cloneDate(input.endDate) : dateAtShanghaiMidnight(year, month, lastDay),
    });

    sequence += 1;
    if (month === 12) {
      year += 1;
      month = 1;
    } else {
      month += 1;
    }
  }

  return periods;
}

function getCalendarDate(date: Date): CalendarDate {
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('开始日期和结束日期必须是有效日期');
  }

  const parts = shanghaiDateFormatter.formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
  };
}

function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  return Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateAtShanghaiMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_MS);
}

function cloneDate(date: Date): Date {
  return new Date(date.getTime());
}
