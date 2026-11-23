import { BadRequestException } from '@nestjs/common';
import { calculatePayrollDeductions, PayrollDeductionsInput, PayrollTaxOpening } from './payroll-deductions-calculator';
import { payrollDate } from './payroll-transaction';

export type DeductionIdentity = { subjectId: string; employeeId: string; payDate: string };
export type PayrollDeductionSettings = Omit<PayrollDeductionsInput, 'subjectId' | 'employeeId' | 'payDate' | 'gross' | 'tax'> & {
  tax: Omit<PayrollDeductionsInput['tax'], 'opening'> & { opening: Omit<PayrollTaxOpening, 'subjectId' | 'employeeId' | 'year'> };
};
const amounts = ['exemptIncome', 'standardDeduction', 'specialDeduction', 'additionalDeduction', 'otherDeduction', 'taxRelief'];
function keys(value: unknown, allowed: string[], path: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new BadRequestException(`${path}包含不支持的字段或不是有效资料`);
  }
  return value as Record<string, any>;
}
export function deductionSettingsInput(identity: DeductionIdentity, settings: PayrollDeductionSettings, gross: string): PayrollDeductionsInput {
  return { subjectId: identity.subjectId, employeeId: identity.employeeId, payDate: identity.payDate, ...settings, gross, tax: { ...settings.tax, opening: { ...settings.tax.opening,
    subjectId: identity.subjectId, employeeId: identity.employeeId, year: payrollDate(identity.payDate).getUTCFullYear() } } };
}
export function normalizeDeductionSettings(identity: DeductionIdentity, raw: unknown): PayrollDeductionSettings {
  payrollDate(identity.payDate);
  if (JSON.stringify(raw)?.length > 30000) throw new BadRequestException('扣缴资料过长');
  const value = keys(raw, ['rounding', 'socialInsurance', 'housingFund', 'tax'], '扣缴资料');
  for (const field of ['socialInsurance', 'housingFund']) {
    const contribution = keys(value[field], ['status', 'ruleVersion', 'evidenceRef', 'contributionDate', 'effectiveFrom', 'effectiveTo', 'items'], field);
    if (!Array.isArray(contribution.items) || contribution.items.length > 20) throw new BadRequestException('个人缴费项目数量不正确');
    contribution.items.forEach((row: unknown) => keys(row, ['code', 'base', 'rate'], '个人缴费项目'));
  }
  const tax = keys(value.tax, ['method', 'ruleVersion', 'evidenceRef', 'effectiveFrom', 'effectiveTo', 'brackets', 'opening', 'current'], '个税资料');
  keys(tax.opening, [...amounts, 'income', 'taxPaid', 'confirmed', 'sourceVersion', 'evidenceRef'], '累计期初');
  keys(tax.current, amounts, '本次扣除');
  if (!Array.isArray(tax.brackets) || tax.brackets.length > 20) throw new BadRequestException('个税分档数量不正确');
  tax.brackets.forEach((row: unknown) => keys(row, ['upTo', 'rate', 'quickDeduction'], '个税分档'));
  const settings = JSON.parse(JSON.stringify(value)) as PayrollDeductionSettings;
  const checked = calculatePayrollDeductions(deductionSettingsInput(identity, settings, '0'));
  if (checked.status === 'needs_configuration') throw new BadRequestException({ message: '扣缴资料不完整或格式有误', data: { issues: checked.issues } });
  return settings;
}
