import type { PayrollRuleConfig } from '@/types/payroll.types';
export interface AttendanceMappingDraft { key: string; type: string; overtimeKind: string }
export const attendanceTypeLabels: Record<string, string> = { paid_leave: '带薪假', unpaid_leave: '事假', sick_leave: '病假', business_trip: '出差', outing: '外出', makeup: '补卡', overtime: '加班' };
export function attendanceMappingPayload(rows: AttendanceMappingDraft[]) {
  const errors: Record<string, string> = {}, value: NonNullable<PayrollRuleConfig['attendanceMappings']> = {}, seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (row.key.length > 200 || !/^\d{1,3}:[^:\r\n]{1,190}:[^:\r\n]{0,190}$/.test(row.key) || row.key !== row.key.trim() || seen.has(row.key)) errors[`${index}.key`] = '请填写不重复的原类型标识（最多200字）';
    seen.add(row.key);
    if (!Object.prototype.hasOwnProperty.call(attendanceTypeLabels, row.type)) errors[`${index}.type`] = '请选择计薪类型';
    if (row.type === 'overtime' && !['weekday', 'restday', 'holiday'].includes(row.overtimeKind)) errors[`${index}.overtimeKind`] = '请选择加班日类型';
    value[row.key] = { type: row.type as NonNullable<PayrollRuleConfig['attendanceMappings']>[string]['type'], ...(row.type === 'overtime' ? { overtimeKind: row.overtimeKind as 'weekday' | 'restday' | 'holiday' } : {}) };
  }
  if (rows.length > 100) errors.rows = '假勤类别映射最多100项';
  return { value, errors };
}
