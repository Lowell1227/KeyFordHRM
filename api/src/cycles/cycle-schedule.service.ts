import { Injectable } from '@nestjs/common';
import { ScoringFrequency } from '@prisma/client';
import { buildPeriodDefinitions, normalizeScoringFrequency, PeriodDefinition } from './cycle-scoring-plan';
import { atShanghaiTime, shiftStatutoryWorkdays, workdayStatus } from './cycle-workday-calendar';
import { CyclePeriodScheduleDto } from './dto/cycle-period-schedule.dto';
import { PreviewCycleScheduleDto } from './dto/preview-cycle-schedule.dto';

type ScheduleIssue = { code: string; periodKey: string; message: string };

type ScheduleValues = PeriodDefinition & {
  selfEvalOpenAt: Date;
  selfEvalDueAt: Date;
  managerDueAt: Date;
  isException: boolean;
};

const SHANGHAI_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  calendar: 'iso8601',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export interface CycleSchedulePreview {
  scoringFrequency: ScoringFrequency;
  reviewFrequency: 'cycle';
  schedules: Array<PeriodDefinition & {
    selfEvalOpenAt: string;
    selfEvalDueAt: string;
    managerDueAt: string;
    isException: boolean;
  }>;
  blockers: ScheduleIssue[];
  warnings: ScheduleIssue[];
}

export interface NormalizedCycleSchedulePlan {
  scoringFrequency: ScoringFrequency;
  reviewFrequency: 'cycle';
  schedules: ScheduleValues[];
  blockers: ScheduleIssue[];
  warnings: ScheduleIssue[];
}

@Injectable()
export class CycleScheduleService {
  preview(dto: PreviewCycleScheduleDto): CycleSchedulePreview {
    const plan = this.normalizeAndValidate(dto);
    return {
      ...plan,
      schedules: plan.schedules.map((schedule) => ({
        ...schedule,
        selfEvalOpenAt: formatShanghaiTimestamp(schedule.selfEvalOpenAt),
        selfEvalDueAt: formatShanghaiTimestamp(schedule.selfEvalDueAt),
        managerDueAt: formatShanghaiTimestamp(schedule.managerDueAt),
      })),
    };
  }

  normalizeAndValidate(input: PreviewCycleScheduleDto): NormalizedCycleSchedulePlan {
    const scoringFrequency = normalizeScoringFrequency(input.type, input.scoringFrequency);
    const periods = buildPeriodDefinitions({ ...input, scoringFrequency });
    const expectedKeys = new Set(periods.map((period) => period.periodKey));
    const submittedSchedules = input.schedules ?? [];
    const keyCounts = new Map<string, number>();
    for (const schedule of submittedSchedules) {
      keyCounts.set(schedule.periodKey, (keyCounts.get(schedule.periodKey) ?? 0) + 1);
    }
    const blockers: ScheduleIssue[] = [];
    for (const [periodKey, count] of keyCounts) {
      if (count > 1) {
        blockers.push({ code: 'DUPLICATE_PERIOD_KEY', periodKey, message: `评分排期中存在重复期次 ${periodKey}` });
      }
      if (!expectedKeys.has(periodKey)) {
        blockers.push({ code: 'UNEXPECTED_PERIOD_KEY', periodKey, message: `评分排期包含非本周期期次 ${periodKey}` });
      }
    }
    const overrides = new Map(submittedSchedules.map((schedule) => [schedule.periodKey, schedule]));
    const schedules = periods.map((period) =>
      this.buildSchedule(period, overrides.get(period.periodKey)),
    );
    const warnings: ScheduleIssue[] = [];

    for (const schedule of schedules) this.validateSchedule(schedule, blockers, warnings);
    for (let index = 1; index < schedules.length; index += 1) {
      const previous = schedules[index - 1];
      const current = schedules[index];
      if (current.selfEvalOpenAt < previous.managerDueAt) {
        warnings.push({ code: 'SCHEDULE_OVERLAP', periodKey: current.periodKey, message: '本期自评与上一期主管评分时间重叠' });
      }
    }

    return { scoringFrequency, reviewFrequency: 'cycle', schedules, blockers, warnings };
  }

  private buildSchedule(period: PeriodDefinition, override?: CyclePeriodScheduleDto): ScheduleValues {
    const defaultSelfEvalOpenAt = atShanghaiTime(firstStatutoryWorkdayOfFollowingMonth(period.periodEnd), 9);
    const defaultSelfEvalDueAt = atShanghaiTime(shiftStatutoryWorkdays(defaultSelfEvalOpenAt, 2), 18);
    const defaultManagerDueAt = atShanghaiTime(shiftStatutoryWorkdays(defaultSelfEvalDueAt, 3), 18);
    const selfEvalOpenAt = override?.selfEvalOpenAt ? toDate(override.selfEvalOpenAt) : defaultSelfEvalOpenAt;
    const selfEvalDueAt = override?.selfEvalDueAt ? toDate(override.selfEvalDueAt) : defaultSelfEvalDueAt;
    const managerDueAt = override?.managerDueAt ? toDate(override.managerDueAt) : defaultManagerDueAt;
    const timingChanged = selfEvalOpenAt.getTime() !== defaultSelfEvalOpenAt.getTime()
      || selfEvalDueAt.getTime() !== defaultSelfEvalDueAt.getTime()
      || managerDueAt.getTime() !== defaultManagerDueAt.getTime();
    return {
      ...period,
      selfEvalOpenAt,
      selfEvalDueAt,
      managerDueAt,
      isException: Boolean(override?.isException) || timingChanged,
    };
  }

  private validateSchedule(schedule: ScheduleValues, blockers: ScheduleIssue[], warnings: ScheduleIssue[]): void {
    if (schedule.selfEvalOpenAt >= schedule.selfEvalDueAt) {
      blockers.push({ code: 'SELF_EVAL_OPEN_NOT_BEFORE_DUE', periodKey: schedule.periodKey, message: '自评开放时间必须早于自评截止时间' });
    }
    if (schedule.selfEvalDueAt >= schedule.managerDueAt) {
      blockers.push({ code: 'SELF_EVAL_DUE_NOT_BEFORE_MANAGER_DUE', periodKey: schedule.periodKey, message: '自评截止时间必须早于主管评分截止时间' });
    }

    const timestamps = [schedule.selfEvalOpenAt, schedule.selfEvalDueAt, schedule.managerDueAt];
    if (timestamps.some((date) => !workdayStatus(date).isWorkday)) {
      warnings.push({ code: 'SCHEDULE_NON_WORKDAY', periodKey: schedule.periodKey, message: '排期包含非工作日' });
    }
    if (timestamps.some((date) => !workdayStatus(date).official)) {
      warnings.push({ code: 'WORKDAY_CALENDAR_FALLBACK', periodKey: schedule.periodKey, message: '部分日期使用了工作日回退规则' });
    }
    if (new Set(timestamps.map(monthKey)).size > 1) {
      warnings.push({ code: 'SCHEDULE_CROSS_MONTH', periodKey: schedule.periodKey, message: '排期跨越考核月份' });
    }
    if (statutoryWorkdaysBetween(schedule.selfEvalOpenAt, schedule.managerDueAt) > 10) {
      warnings.push({ code: 'SCHEDULE_INTERVAL_OVER_10_WORKDAYS', periodKey: schedule.periodKey, message: '自评开放至主管评分截止超过十个法定工作日' });
    }
  }
}

function firstStatutoryWorkdayOfFollowingMonth(date: Date): Date {
  const timestamp = formatShanghaiTimestamp(date);
  const year = Number(timestamp.slice(0, 4));
  const month = Number(timestamp.slice(5, 7));
  const firstDay = new Date(Date.UTC(year, month, 1) - 8 * 60 * 60 * 1000);
  return workdayStatus(firstDay).isWorkday ? firstDay : shiftStatutoryWorkdays(firstDay, 1);
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function statutoryWorkdaysBetween(start: Date, end: Date): number {
  let current = atShanghaiTime(start, 0);
  const finish = atShanghaiTime(end, 0);
  let total = 0;
  while (current < finish) {
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
    if (workdayStatus(current).isWorkday) total += 1;
  }
  return total;
}

function monthKey(date: Date): string {
  const timestamp = formatShanghaiTimestamp(date);
  return timestamp.slice(0, 7);
}

function formatShanghaiTimestamp(date: Date): string {
  const parts = new Map(SHANGHAI_TIMESTAMP_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]));
  const year = parts.get('year');
  const month = parts.get('month');
  const day = parts.get('day');
  const hour = parts.get('hour');
  const minutes = parts.get('minute');
  const seconds = parts.get('second');
  return `${year}-${month}-${day}T${hour}:${minutes}:${seconds}+08:00`;
}
