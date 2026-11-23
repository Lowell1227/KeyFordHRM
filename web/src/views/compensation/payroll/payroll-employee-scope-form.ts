import type { PayrollRuleConfig } from '@/types/payroll.types';

export function employeeScopeErrors(scope: PayrollRuleConfig['employeeScope'], available: string[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const ids = scope?.employeeIds;
  if (!ids?.length || ids.length > 1000 || new Set(ids).size !== ids.length || ids.some(id => !available.includes(id))) {
    errors.employeeIds = '请选择本期已核对的发薪人员，最多1000人且不能重复';
  }
  if (!scope?.evidenceRef.trim() || scope.evidenceRef.trim().length > 200) errors.evidenceRef = '请填写不超过200字的发薪归属确认依据';
  return errors;
}
