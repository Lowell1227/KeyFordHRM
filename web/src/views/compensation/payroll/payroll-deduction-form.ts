import type { PayrollDeductionLedgerSettings, PayrollDeductionSettings, PayrollTaxAmount, PayrollDeductionProfile, PayrollDeductionProfileInput, PayrollEmployee } from '@/types/payroll.types';

export const taxAmountFields: Array<{key: PayrollTaxAmount; label: string}> = [
  {key: 'exemptIncome', label: '免税收入'}, {key: 'standardDeduction', label: '减除费用'},
  {key: 'specialDeduction', label: '专项扣除'}, {key: 'additionalDeduction', label: '专项附加扣除'},
  {key: 'otherDeduction', label: '其他依法扣除'}, {key: 'taxRelief', label: '减免税额'},
];
const emptyAmounts = () => Object.fromEntries(taxAmountFields.map(field => [field.key, ''])) as Record<PayrollTaxAmount, string>;
export function emptyDeductionLedger(): PayrollDeductionLedgerSettings {
  return {startDate: '', priorInPayMonth: emptyAmounts(), priorSocialInsurance: '', priorHousingFund: ''};
}
export function emptyDeductionSettings(): PayrollDeductionSettings {
  const contribution = () => ({status: '', ruleVersion: '', evidenceRef: '', contributionDate: '', effectiveFrom: '', effectiveTo: null, items: []});
  return {rounding: '', ledger: emptyDeductionLedger(), socialInsurance: contribution(), housingFund: contribution(), tax: {method: '', ruleVersion: '', evidenceRef: '', effectiveFrom: '', effectiveTo: null,
    brackets: [], opening: {...emptyAmounts(), income: '', taxPaid: '', confirmed: false, sourceVersion: '', evidenceRef: ''}, current: emptyAmounts()}};
}
export function deductionFormErrors(settings: PayrollDeductionSettings, payDate?: string): Record<string, string> {
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
  if (settings.ledger) {
    const ledger = settings.ledger, date = new Date(`${ledger.startDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ledger.startDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== ledger.startDate) errors['ledger.startDate'] = '请填写有效的台账基准日';
    else if (payDate && (ledger.startDate.slice(0, 4) !== payDate.slice(0, 4) || ledger.startDate > payDate)) errors['ledger.startDate'] = '基准日须在发薪年度内且不晚于发薪日';
    for (const {key} of taxAmountFields) {
      const path = `ledger.priorInPayMonth.${key}`, value = ledger.priorInPayMonth[key];
      money(path, value);
      if (payDate && ledger.startDate.slice(0, 7) !== payDate.slice(0, 7) && value && !/^0+(\.0+)?$/.test(value)) errors[path] = '非基准月的月内既有金额须明确填写0';
    }
    for (const [key, contribution] of [['priorSocialInsurance', 'socialInsurance'], ['priorHousingFund', 'housingFund']] as const) {
      money(`ledger.${key}`, ledger[key]);
      const month = settings[contribution].contributionDate.slice(0, 7);
      if (month && month > ledger.startDate.slice(0, 7) && ledger[key] && !/^0+(\.0+)?$/.test(ledger[key])) errors[`ledger.${key}`] = '晚于基准月的缴费月，接管前外部已扣金额须明确填写0';
    }
  }
  return errors;
}

export type DeductionStep = 'identity' | 'contributions' | 'tax';
export function deductionErrorStep(path: string): DeductionStep {
  if (['employeeId', 'payDate', 'payDateConfirmed', 'carryReference'].includes(path)) return 'identity';
  return /^(socialInsurance|housingFund)\./.test(path) ? 'contributions' : 'tax';
}
export function validDeductionDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function deductionDraftErrors(input: PayrollDeductionProfileInput): Record<string, string> {
  const errors = deductionFormErrors(input.settings, input.payDate);
  if (!input.employeeId) errors.employeeId = '请选择员工';
  if (!validDeductionDate(input.payDate)) errors.payDate = '请选择有效的发薪日';
  for (const key of ['socialInsurance', 'housingFund'] as const) {
    for (const field of ['contributionDate', 'effectiveFrom', 'effectiveTo'] as const) {
      const value = input.settings[key][field];
      if ((field !== 'effectiveTo' || value) && !validDeductionDate(value ?? '')) errors[`${key}.${field}`] = '请选择有效日期';
    }
  }
  for (const field of ['effectiveFrom', 'effectiveTo'] as const) {
    const value = input.settings.tax[field];
    if ((field !== 'effectiveTo' || value) && !validDeductionDate(value ?? '')) errors[`tax.${field}`] = '请选择有效日期';
  }
  return errors;
}
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

export function applyApprovedDeductionRules(target: PayrollDeductionSettings, source: PayrollDeductionProfile, subjectId: string): PayrollDeductionSettings {
  if (source.subjectId !== subjectId) throw new Error('公共规则必须来自同一发薪主体');
  if (source.status !== 'active') throw new Error('只能套用已批准发布资料中的公共规则');
  const result = copy(target);
  result.rounding = source.settings.rounding;
  for (const key of ['socialInsurance', 'housingFund'] as const) {
    const shared = source.settings[key], own = result[key];
    own.ruleVersion = shared.ruleVersion; own.effectiveFrom = shared.effectiveFrom; own.effectiveTo = shared.effectiveTo;
    own.evidenceRef = '';
    own.items = shared.items.map(item => ({ code: item.code, rate: item.rate, base: own.items.find(value => value.code === item.code)?.base ?? '' }));
  }
  for (const key of ['method', 'ruleVersion', 'effectiveFrom', 'effectiveTo'] as const) Object.assign(result.tax, { [key]: source.settings.tax[key] });
  result.tax.brackets = copy(source.settings.tax.brackets);
  result.tax.evidenceRef = ''; result.tax.opening.confirmed = false;
  return result;
}
export function canCarryDeductionOpening(source: PayrollDeductionProfile, payDate: string): boolean {
  const settings = source.settings;
  return source.status === 'active' && validDeductionDate(payDate) && source.payDate.slice(0, 4) === payDate.slice(0, 4)
    && !!settings.ledger && validDeductionDate(settings.ledger.startDate) && settings.ledger.startDate.slice(0, 4) === payDate.slice(0, 4)
    && settings.ledger.startDate <= payDate && settings.tax.opening.confirmed
    && !!settings.tax.opening.sourceVersion.trim() && !!settings.tax.opening.evidenceRef.trim();
}
export function copyDeductionForPayDate(source: PayrollDeductionProfile, payDate: string, carryReference = ''): PayrollDeductionProfileInput {
  const settings = copy(source.settings), blank = emptyDeductionSettings();
  settings.tax.current = blank.tax.current;
  settings.tax.opening = blank.tax.opening; settings.ledger = blank.ledger;
  for (const key of ['socialInsurance', 'housingFund'] as const) settings[key].contributionDate = '';
  if (carryReference.trim() && canCarryDeductionOpening(source, payDate)) {
    settings.tax.opening = { ...copy(source.settings.tax.opening), confirmed: false,
      evidenceRef: `沿用已审V${source.version}（${source.payDate.slice(0, 10)}）：${carryReference.trim()}` };
    settings.ledger = copy(source.settings.ledger);
  }
  return { subjectId: source.subjectId, employeeId: source.employeeId, payDate, settings };
}

export type DeductionAmountGroup = 'contributions' | 'opening' | 'ledger' | 'current';
export type DeductionAmountColumn = { key: string; label: string };
export function deductionAmountColumns(inputs: PayrollDeductionProfileInput[], group: DeductionAmountGroup): DeductionAmountColumn[] {
  if (group === 'contributions') return (['socialInsurance', 'housingFund'] as const).flatMap(kind => [...new Set(inputs.flatMap(input => input.settings[kind].items.map(item => item.code)))].map(code => ({
    key: `${kind}:${code}`, label: `${kind === 'socialInsurance' ? '社保' : '公积金'}:${code}基数`,
  })));
  if (group === 'opening') return [{ key: 'opening:income', label: '累计收入' }, { key: 'opening:taxPaid', label: '累计已扣个税' },
    ...taxAmountFields.map(field => ({ key: `opening:${field.key}`, label: `累计${field.label}` }))];
  if (group === 'ledger') return [{ key: 'ledger:priorSocialInsurance', label: '接管前已扣社保' }, { key: 'ledger:priorHousingFund', label: '接管前已扣公积金' },
    ...taxAmountFields.map(field => ({ key: `prior:${field.key}`, label: `基准月既有${field.label}` }))];
  return taxAmountFields.map(field => ({ key: `current:${field.key}`, label: `本月${field.label}` }));
}
export function deductionAmountValue(settings: PayrollDeductionSettings, key: string): string {
  const [kind, field = ''] = key.split(':');
  if (kind === 'socialInsurance' || kind === 'housingFund') return settings[kind].items.find(item => item.code === field)?.base ?? '';
  if (kind === 'opening') return settings.tax.opening[field as PayrollTaxAmount | 'income' | 'taxPaid'];
  if (kind === 'current') return settings.tax.current[field as PayrollTaxAmount];
  if (kind === 'prior') return settings.ledger?.priorInPayMonth[field as PayrollTaxAmount] ?? '';
  return settings.ledger?.[field as 'priorSocialInsurance' | 'priorHousingFund'] ?? '';
}
export function withDeductionAmount(settings: PayrollDeductionSettings, key: string, value: string): PayrollDeductionSettings {
  const result = copy(settings), [kind, field = ''] = key.split(':');
  if (kind === 'socialInsurance' || kind === 'housingFund') {
    const item = result[kind].items.find(item => item.code === field);
    if (!item) throw new Error('该员工尚未配置此缴费项目');
    item.base = value;
  } else if (kind === 'opening') result.tax.opening[field as PayrollTaxAmount | 'income' | 'taxPaid'] = value;
  else if (kind === 'current') result.tax.current[field as PayrollTaxAmount] = value;
  else if (kind === 'prior' && result.ledger) result.ledger.priorInPayMonth[field as PayrollTaxAmount] = value;
  else if (kind === 'ledger' && result.ledger) result.ledger[field as 'priorSocialInsurance' | 'priorHousingFund'] = value;
  else throw new Error('该员工尚未配置累计台账');
  result.tax.opening.confirmed = false;
  return result;
}
export function pasteDeductionAmounts(inputs: PayrollDeductionProfileInput[], employees: PayrollEmployee[], text: string): { drafts: PayrollDeductionProfileInput[]; errors: string[] } {
  const original = copy(inputs), drafts = copy(inputs), errors: string[] = [];
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').map(line => line.split('\t').map(value => value.trim()));
  const headers = lines[0] ?? [], groups: DeductionAmountGroup[] = ['contributions', 'opening', 'ledger', 'current'];
  const columns = groups.flatMap(group => deductionAmountColumns(inputs, group));
  if (headers[0] !== '工号' || headers.length < 2 || new Set(headers).size !== headers.length || headers.slice(1).some(label => !columns.some(column => column.label === label))) {
    return { drafts: original, errors: ['首列须为工号，其余列使用本页金额列名，不能重复或包含其他字段'] };
  }
  const seen = new Set<string>();
  for (const [index, cells] of lines.slice(1).entries()) {
    const number = cells[0] ?? '', people = employees.filter(person => person.employeeNo === number && drafts.some(input => input.employeeId === person.id));
    if (!number || people.length !== 1 || seen.has(number) || cells.length !== headers.length) { errors.push(`第${index + 2}行：工号须唯一且在已选人员中，列数须与表头一致`); continue; }
    seen.add(number);
    const input = drafts.find(row => row.employeeId === people[0]!.id)!;
    for (let i = 1; i < cells.length; i++) {
      const value = cells[i]!, column = columns.find(column => column.label === headers[i])!;
      if (value && !/^\d{1,12}(?:\.\d{1,4})?$/.test(value)) { errors.push(`第${index + 2}行 ${column.label}：请填写非负金额或留空待核`); continue; }
      try { input.settings = withDeductionAmount(input.settings, column.key, value); }
      catch (cause) { errors.push(`第${index + 2}行 ${column.label}：${(cause as Error).message}`); }
    }
  }
  if (lines.length < 2) errors.push('请粘贴至少一行人员金额');
  return { drafts: errors.length ? original : drafts, errors };
}

export type DeductionSaveResult = { employeeId: string; status: 'not_sent' | 'saving' | 'saved' | 'failed' | 'unknown'; message: string; profileId?: string };
export function deductionSaveUncertain(cause: unknown): boolean {
  const status = (cause as { response?: { status?: number } })?.response?.status;
  return !status || status >= 500 || status === 408;
}
export async function saveDeductionDrafts(inputs: PayrollDeductionProfileInput[], save: (input: PayrollDeductionProfileInput) => Promise<{ id: string }>, update?: (rows: DeductionSaveResult[]) => void): Promise<DeductionSaveResult[]> {
  const results: DeductionSaveResult[] = inputs.map(input => ({ employeeId: input.employeeId, status: 'not_sent', message: '尚未发送' }));
  const publish = () => update?.(copy(results));
  for (const [index, input] of inputs.entries()) {
    const row = results[index]!; row.status = 'saving'; row.message = '正在保存'; publish();
    try {
      const result = await save(copy(input));
      if (typeof result?.id !== 'string' || !result.id) throw new Error('保存回执不完整');
      row.status = 'saved'; row.profileId = result.id; row.message = '已保存草稿，尚未提交主管审核';
    } catch (cause) {
      const uncertain = deductionSaveUncertain(cause), message = (cause as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
      row.status = uncertain ? 'unknown' : 'failed';
      row.message = uncertain ? '保存结果待核实；请先返回列表核对，不要重复创建' : typeof message === 'string' ? message : '保存被拒绝，请核对资料或当前权限';
      if (uncertain) { publish(); break; }
    }
    publish();
  }
  return results;
}
