import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { payrollMonth } from './payroll-transaction';

export interface PayrollWorkCalendar {
  sourceVersion: string;
  evidenceRef: string;
  days: Array<{ workDate: string; units: string }>;
}

export function payrollCalendarDays(month: string): string[] {
  const { end } = payrollMonth(month);
  return Array.from({ length: end.getUTCDate() }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}

export function normalizePayrollWorkCalendar(month: string, input: unknown): PayrollWorkCalendar {
  const expected = payrollCalendarDays(month), raw = input as Partial<PayrollWorkCalendar> | null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || Object.keys(raw).some(key => !['sourceVersion', 'evidenceRef', 'days'].includes(key))) {
    throw new BadRequestException('请提供完整自然月工作日日历');
  }
  for (const key of ['sourceVersion', 'evidenceRef'] as const) {
    if (typeof raw[key] !== 'string' || !raw[key].trim() || raw[key].length > 200) {
      throw new BadRequestException('工作日日历须有版本和确认依据');
    }
  }
  if (!Array.isArray(raw.days) || raw.days.length !== expected.length) throw new BadRequestException('工作日日历必须覆盖完整自然月');
  const dates = new Set<string>();
  const days = raw.days.map(day => {
    if (!day || typeof day !== 'object' || Array.isArray(day)
      || Object.keys(day).some(key => !['workDate', 'units'].includes(key))
      || !expected.includes(day.workDate) || dates.has(day.workDate)
      || typeof day.units !== 'string' || !/^(?:0|1)(?:\.\d{1,4})?$/.test(day.units)) {
      throw new BadRequestException('工作日日历含重复、错月、无效日期或计薪单位');
    }
    const units = new Prisma.Decimal(day.units);
    if (units.gt(1)) throw new BadRequestException('每日应出勤工作日单位不能超过1');
    dates.add(day.workDate);
    return { workDate: day.workDate, units: units.toString() };
  }).sort((a, b) => a.workDate.localeCompare(b.workDate));
  if (days.every(day => day.units === '0')) throw new BadRequestException('完整月应出勤工作日必须大于零');
  return { sourceVersion: raw.sourceVersion!.trim(), evidenceRef: raw.evidenceRef!.trim(), days };
}
