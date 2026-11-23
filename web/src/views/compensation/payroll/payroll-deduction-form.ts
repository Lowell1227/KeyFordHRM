import type { PayrollDeductionSettings, PayrollTaxAmount } from '@/types/payroll.types';

export const taxAmountFields: Array<{key: PayrollTaxAmount; label: string}> = [
  {key: 'exemptIncome', label: '免税收入'}, {key: 'standardDeduction', label: '减除费用'},
  {key: 'specialDeduction', label: '专项扣除'}, {key: 'additionalDeduction', label: '专项附加扣除'},
  {key: 'otherDeduction', label: '其他依法扣除'}, {key: 'taxRelief', label: '减免税额'},
];
export function emptyDeductionSettings(): PayrollDeductionSettings {
  const amounts = () => Object.fromEntries(taxAmountFields.map(field => [field.key, ''])) as Record<PayrollTaxAmount, string>;
  const contribution = () => ({status: '', ruleVersion: '', evidenceRef: '', contributionDate: '', effectiveFrom: '', effectiveTo: null, items: []});
  return {rounding: '', socialInsurance: contribution(), housingFund: contribution(), tax: {method: '', ruleVersion: '', evidenceRef: '', effectiveFrom: '', effectiveTo: null,
    brackets: [], opening: {...amounts(), income: '', taxPaid: '', confirmed: false, sourceVersion: '', evidenceRef: ''}, current: amounts()}};
}
export function deductionFormErrors(settings: PayrollDeductionSettings): Record<string, string> {
  const errors: Record<string, string> = {};
  const needed = (path: string, value: unknown) => { if (typeof value !== 'string' || !value.trim()) errors[path] = '请填写此项；无金额也须明确填写0'; };
  const money = (path: string, value: string | null) => { needed(path, value); if (value && !/^\d{1,12}(\.\d{1,4})?$/.test(value)) errors[path] = '请填写非负十进制金额，最多4位小数'; };
  needed('rounding', settings.rounding);
  for (const field of ['socialInsurance', 'housingFund'] as const) {
    const row = settings[field];
    for (const key of ['status', 'ruleVersion', 'evidenceRef', 'contributionDate', 'effectiveFrom'] as const) needed(`${field}.${key}`, row[key]);
    if (row.status === 'applicable' && !row.items.length) errors[`${field}.items`] = '请添加个人缴费项目';
    row.items.forEach((item, i) => { needed(`${field}.items.${i}.code`, item.code); money(`${field}.items.${i}.base`, item.base); money(`${field}.items.${i}.rate`, item.rate); });
  }
  for (const key of ['method', 'ruleVersion', 'evidenceRef', 'effectiveFrom'] as const) needed(`tax.${key}`, settings.tax[key]);
  if (!settings.tax.brackets.length) errors['tax.brackets'] = '请添加完整的个税分档';
  settings.tax.brackets.forEach((row, i) => { if (row.upTo !== null) money(`tax.brackets.${i}.upTo`, row.upTo); money(`tax.brackets.${i}.rate`, row.rate); money(`tax.brackets.${i}.quickDeduction`, row.quickDeduction); });
  for (const key of ['sourceVersion', 'evidenceRef'] as const) needed(`tax.opening.${key}`, settings.tax.opening[key]);
  for (const field of [...taxAmountFields.map(row => row.key), 'income', 'taxPaid'] as const) money(`tax.opening.${field}`, settings.tax.opening[field]);
  for (const {key} of taxAmountFields) money(`tax.current.${key}`, settings.tax.current[key]);
  if (!settings.tax.opening.confirmed) errors['tax.opening.confirmed'] = '请先核对累计期初及其依据';
  return errors;
}
