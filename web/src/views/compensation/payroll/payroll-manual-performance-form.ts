import type { PayrollPerformanceMapping } from '@/types/payroll.types';

export type PerformanceMappingDraft = PayrollPerformanceMapping & { month: string };

export function newPerformanceMapping(month: string): PerformanceMappingDraft {
  return { month, sourceKind: 'manual', manualAmounts: {}, evidenceRef: '', cycleIds: [], coefficients: {} };
}

export function manualPerformanceErrors(mapping: Pick<PayrollPerformanceMapping, 'manualAmounts' | 'evidenceRef'>, employeeIds: string[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!mapping.evidenceRef?.trim()) errors.evidenceRef = '请填写绩效工资确认依据';
  for (const [id, value] of Object.entries(mapping.manualAmounts ?? {})) {
    const amount = value.trim();
    if (!amount) continue;
    if (!employeeIds.includes(id)) errors[`manualAmounts.${id}`] = '不在该主体本月有效人员范围，请核对归属月或清除此金额';
    else if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount)) errors[`manualAmounts.${id}`] = '请填写非负金额，最多12位整数、2位小数';
  }
  return errors;
}

export function performanceMappingsPayload(mappings: PerformanceMappingDraft[]): Record<string, PayrollPerformanceMapping> {
  return Object.fromEntries(mappings.map(({ month, manualAmounts, ...mapping }) => {
    if (mapping.sourceKind !== 'manual') {
      return [month, { ...mapping, coefficients: Object.fromEntries(Object.entries(mapping.coefficients).filter(([, value]) => value !== '')) }];
    }
    const amounts = Object.fromEntries(Object.entries(manualAmounts ?? {}).filter(([, value]) => value.trim() !== '').map(([id, value]) => {
      const [integer, fraction = ''] = value.trim().split('.');
      return [id, `${integer}.${fraction.padEnd(2, '0')}`];
    }));
    return [month, { sourceKind: 'manual', cycleIds: [], coefficients: {}, manualAmounts: amounts, evidenceRef: mapping.evidenceRef?.trim() }];
  }));
}
