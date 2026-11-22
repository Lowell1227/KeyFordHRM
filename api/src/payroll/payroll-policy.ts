import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PayrollPolicyConfig } from './payroll-contracts';
import { payrollDecimal, payrollMonth } from './payroll-transaction';
import { normalizePayrollWorkCalendar } from './payroll-work-calendar';

function object(value: unknown, keys?: string[]): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('规则参数须为结构化数据');
  const result = value as Record<string, unknown>;
  if (keys && Object.keys(result).some(key => !keys.includes(key))) throw new BadRequestException('规则包含不支持的字段');
  return result;
}
function decimal(value: unknown): string | null {
  return value == null ? null : payrollDecimal(value)!.toString();
}
function identities(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 10 || value.some(id => typeof id !== 'string' || !isUUID(id)) || new Set(value).size !== value.length) throw new BadRequestException('请选择有效且不重复的人员或周期');
  return [...value];
}
function reference(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new BadRequestException('版本与确认依据须为有效文本');
  return value.trim();
}
export function normalizePayrollPolicy(input: unknown): PayrollPolicyConfig {
  const raw = object(input, ['fixedSalaryBasis', 'workCalendars', 'rounding', 'monthlyUnits', 'normalHourly', 'paidHourly', 'overtime', 'reviewers', 'approvers', 'cutoverMonth', 'performance']);
  if (raw.fixedSalaryBasis != null && raw.fixedSalaryBasis !== 'monthly_workdays') throw new BadRequestException('固定工资折算依据不正确');
  const calendarEntries = Object.entries(object(raw.workCalendars));
  if (calendarEntries.length > 24) throw new BadRequestException('请按有效期拆分工作日日历');
  const workCalendars = Object.fromEntries(calendarEntries.map(([month, value]) => [month, normalizePayrollWorkCalendar(month, value)]));
  if (raw.rounding != null && raw.rounding !== 'item_half_up') throw new BadRequestException('暂不支持该舍入规则');
  const monthlyUnits: Record<string, string> = {};
  for (const [month, value] of Object.entries(object(raw.monthlyUnits))) {
    payrollMonth(month); const units = payrollDecimal(value)!;
    if (!units.gt(0)) throw new BadRequestException('当月计薪单位须大于零'); monthlyUnits[month] = units.toString();
  }
  const paid = object(raw.paidHourly, ['unpaid_leave', 'sick_leave', 'absence']);
  const paidHourly: PayrollPolicyConfig['paidHourly'] = {};
  for (const key of ['unpaid_leave', 'sick_leave', 'absence'] as const) if (paid[key] != null) paidHourly[key] = decimal(paid[key])!;
  const ot = object(raw.overtime, ['hourlyBase', 'weekday', 'restday', 'holiday']);
  const performance: PayrollPolicyConfig['performance'] = {};
  for (const [month, value] of Object.entries(object(raw.performance))) {
    payrollMonth(month); const source = object(value, ['cycleIds', 'sourceKind', 'coefficients', 'coefficientVersion', 'evidenceRef']);
    if (source.sourceKind != null && !['official', 'fictional'].includes(source.sourceKind as string)) throw new BadRequestException('绩效来源登记类型不正确');
    const coefficients: PayrollPolicyConfig['performance'][string]['coefficients'] = {}, mapping = object(source.coefficients, ['A', 'B', 'C', 'D']);
    for (const grade of ['A', 'B', 'C', 'D'] as const) if (mapping[grade] != null) coefficients[grade] = decimal(mapping[grade])!;
    performance[month] = { cycleIds: identities(source.cycleIds), sourceKind: (source.sourceKind ?? null) as 'official' | 'fictional' | null, coefficients,
      ...(source.coefficientVersion != null ? { coefficientVersion: reference(source.coefficientVersion) } : {}),
      ...(source.evidenceRef != null ? { evidenceRef: reference(source.evidenceRef) } : {}) };
  }
  if (Object.keys(monthlyUnits).length > 24 || Object.keys(performance).length > 24) throw new BadRequestException('请按有效期拆分规则版本');
  if (raw.cutoverMonth != null) { if (typeof raw.cutoverMonth !== 'string') throw new BadRequestException('启用切点不正确'); payrollMonth(raw.cutoverMonth); }
  return { ...(raw.fixedSalaryBasis != null ? { fixedSalaryBasis: 'monthly_workdays' as const } : {}),
    ...(calendarEntries.length ? { workCalendars } : {}), rounding: raw.rounding == null ? null : 'item_half_up', monthlyUnits,
    normalHourly: decimal(raw.normalHourly), paidHourly,
    overtime: { hourlyBase: decimal(ot.hourlyBase), weekday: decimal(ot.weekday), restday: decimal(ot.restday), holiday: decimal(ot.holiday) },
    reviewers: identities(raw.reviewers), approvers: identities(raw.approvers), cutoverMonth: raw.cutoverMonth as string ?? null, performance };
}
