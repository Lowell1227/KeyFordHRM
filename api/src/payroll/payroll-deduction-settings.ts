import { BadRequestException } from '@nestjs/common';
import { calculatePayrollDeductions, PayrollDeductionsInput, PayrollTaxDeductions, PayrollTaxOpening } from './payroll-deductions-calculator';
import { payrollDate, payrollDecimal } from './payroll-transaction';

export type DeductionIdentity = { subjectId: string; employeeId: string; payDate: string };
export type PayrollDeductionSettings = Omit<PayrollDeductionsInput, 'subjectId' | 'employeeId' | 'payDate' | 'gross' | 'tax'> & {
  tax: Omit<PayrollDeductionsInput['tax'], 'opening'> & { opening: Omit<PayrollTaxOpening, 'subjectId' | 'employeeId' | 'year'> };
  // Contribution priors are confirmed external amounts for each rule month, excluding HRM actual facts.
  ledger?: { startDate: string; priorInPayMonth: PayrollTaxDeductions; priorSocialInsurance: string; priorHousingFund: string };
};
const amounts = ['exemptIncome', 'standardDeduction', 'specialDeduction', 'additionalDeduction', 'otherDeduction', 'taxRelief'];
function keys(value: unknown, allowed: string[], path: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    if (path.startsWith('ledger')) throw new BadRequestException(`台账资料缺失或含有不支持的字段[${path}]`);
    throw new BadRequestException(`${path}包含不支持的字段或不是有效资料`);
  }
  return value as Record<string, any>;
}
export function deductionSettingsInput(identity: DeductionIdentity, settings: PayrollDeductionSettings, gross: string): PayrollDeductionsInput {
  const { ledger, ...parameters } = settings;
  return { ...parameters, subjectId: identity.subjectId, employeeId: identity.employeeId, payDate: identity.payDate, gross, tax: { ...settings.tax, opening: { ...settings.tax.opening,
    subjectId: identity.subjectId, employeeId: identity.employeeId, year: payrollDate(identity.payDate).getUTCFullYear() } } };
}
export function normalizeDeductionSettings(identity: DeductionIdentity, raw: unknown): PayrollDeductionSettings {
  payrollDate(identity.payDate);
  if (JSON.stringify(raw)?.length > 30000) throw new BadRequestException('扣缴资料过长');
  const value = keys(raw, ['rounding', 'socialInsurance', 'housingFund', 'tax', 'ledger'], '扣缴资料');
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
  if (Object.prototype.hasOwnProperty.call(value, 'ledger')) {
    const ledger = keys(value.ledger, ['startDate', 'priorInPayMonth', 'priorSocialInsurance', 'priorHousingFund'], 'ledger');
    try { payrollDate(ledger.startDate); } catch { throw new BadRequestException('请填写有效的台账起始日[ledger.startDate]'); }
    if (ledger.startDate.slice(0, 4) !== identity.payDate.slice(0, 4) || ledger.startDate > identity.payDate) {
      throw new BadRequestException('台账起始日须与发薪日同年，且不能晚于发薪日[ledger.startDate]');
    }
    const cutoffMonth = ledger.startDate.slice(0, 7);
    const prior = keys(ledger.priorInPayMonth, amounts, 'ledger.priorInPayMonth');
    const checkPrior = (amount: unknown, path: string, zeroRequired: boolean) => {
      if (typeof amount !== 'string' || !/^\d{1,12}(?:\.\d{1,4})?$/.test(amount)) {
        throw new BadRequestException(`请填写有效的既往扣除金额，不能为负数[${path}]`);
      }
      if (zeroRequired && !/^0+(?:\.0+)?$/.test(amount)) {
        throw new BadRequestException(`该月份的既往扣除须明确填0[${path}]`);
      }
    };
    amounts.forEach(field => checkPrior(prior[field], `ledger.priorInPayMonth.${field}`, identity.payDate.slice(0, 7) !== cutoffMonth));
    for (const [field, priorField] of [['socialInsurance', 'priorSocialInsurance'], ['housingFund', 'priorHousingFund']]) {
      const month = payrollDate(value[field].contributionDate).toISOString().slice(0, 7);
      // Contribution periods are independent of the tax year; only later periods require zero external priors.
      checkPrior(ledger[priorField], `ledger.${priorField}`, month > cutoffMonth);
    }
  }
  const settings = JSON.parse(JSON.stringify(value)) as PayrollDeductionSettings;
  const checked = calculatePayrollDeductions(deductionSettingsInput(identity, settings, '0'));
  if (checked.status === 'needs_configuration') throw new BadRequestException({ message: '扣缴资料不完整或格式有误', data: { issues: checked.issues } });
  if (settings.ledger) {
    for (const field of amounts as Array<keyof PayrollTaxDeductions>) {
      // Cutoff-month prior use is a subset of the confirmed cumulative opening, not an extra allowance.
      if (payrollDecimal(settings.ledger.priorInPayMonth[field])!.gt(settings.tax.opening[field])) {
        throw new BadRequestException(`起始月既往扣除不能超过对应累计期初，请核对[ledger.priorInPayMonth.${field}]`);
      }
    }
  }
  return settings;
}
