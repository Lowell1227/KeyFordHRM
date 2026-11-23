import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { DeductionIdentity, deductionSettingsInput, normalizeDeductionSettings, PayrollDeductionSettings } from './payroll-deduction-settings';
import { calculatePayrollDeductions, PayrollDeductionsResult, PayrollTaxDeductions } from './payroll-deductions-calculator';
import { payrollDate } from './payroll-transaction';

export type NetLedgerFact = {
  id: string; payDate: string; gross: string; socialInsurance: string; housingFund: string; incomeTax: string;
  taxDeductions: PayrollTaxDeductions; socialMonth: string; housingMonth: string; openingDate: string; openingHash: string;
};
type NetLedgerResult = PayrollDeductionsResult & {
  ledger?: { openingDate: string; openingHash: string; factIds: string[]; taxDeductions: PayrollTaxDeductions; socialMonth: string; housingMonth: string; sourceHash: string };
};
const deductionFields: Array<keyof PayrollTaxDeductions> = ['exemptIncome', 'standardDeduction', 'specialDeduction', 'additionalDeduction', 'otherDeduction', 'taxRelief'];

function canonical(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (!value || typeof value !== 'object' || ancestors.has(value) || Object.getOwnPropertySymbols(value).length ||
    (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error('台账资料格式无效，请重新读取[ledger.JSON]');
  }
  ancestors.add(value);
  const keys = Object.keys(value);
  if (Array.isArray(value) && (keys.length !== value.length || keys.some((key, index) => key !== String(index)))) throw new Error('已入薪记录不完整，请重新读取[facts]');
  const result = Array.isArray(value) ? `[${value.map(entry => canonical(entry, ancestors)).join(',')}]` :
    `{${keys.sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], ancestors)}`).join(',')}}`;
  ancestors.delete(value);
  return result;
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const configurationIssues = (issues: string[]) => issues.map(issue => `扣缴资料缺失或无效，请核对[${issue.split(':')[0]}]`);

// Caller supplies all current-pay-year actuals plus older actuals matching either contribution period.
export function calculateNetWithLedger(
  identity: DeductionIdentity & { gross: string }, settings: PayrollDeductionSettings, facts: NetLedgerFact[],
): NetLedgerResult {
  const closed = (status: 'needs_configuration' | 'needs_review', issues: string[], evidence: PayrollDeductionsResult['evidence'] = { input: null, sourceHash: null }): NetLedgerResult =>
    ({ status, issues, gross: null, socialInsurance: null, housingFund: null, incomeTax: null, net: null, evidence });
  let reviewed: PayrollDeductionSettings;
  let target: PayrollDeductionsResult;
  let snapshot: { identity: DeductionIdentity & { gross: string }; settings: PayrollDeductionSettings; facts: NetLedgerFact[] };
  try {
    reviewed = normalizeDeductionSettings(identity, settings);
    if (!reviewed.ledger) return closed('needs_configuration', ['请先补齐并审核台账起始日及既往扣除资料[ledger]']);
    target = calculatePayrollDeductions(deductionSettingsInput(identity, reviewed, identity.gross));
    if (target.status === 'needs_configuration') return { ...target, issues: configurationIssues(target.issues) };
  } catch (error) {
    const response = error instanceof BadRequestException ? error.getResponse() as { data?: { issues?: string[] } } : null;
    return closed('needs_configuration', response?.data?.issues ? configurationIssues(response.data.issues) :
      [error instanceof BadRequestException ? error.message : '扣缴资料缺失或格式无效，请先补齐[ledger]']);
  }

  const { startDate, priorInPayMonth, priorSocialInsurance, priorHousingFund } = reviewed.ledger!;
  const payYear = identity.payDate.slice(0, 4), payMonth = identity.payDate.slice(0, 7);
  const socialMonth = reviewed.socialInsurance.contributionDate.slice(0, 7), housingMonth = reviewed.housingFund.contributionDate.slice(0, 7);
  try {
    if (!Array.isArray(facts)) throw new Error('请先读取完整的已入薪记录[facts]');
    const ids = new Set<string>();
    const text = (value: unknown, path: string) => {
      if (typeof value !== 'string' || !value || value.trim() !== value) throw new Error(`已入薪记录标识缺失或无效，请核对[${path}]`);
    };
    const amount = (value: unknown, path: string) => {
      if (typeof value !== 'string' || !/^\d{1,12}(?:\.\d{1,4})?$/.test(value)) throw new Error(`已入薪金额缺失或无效，不能为负数[${path}]`);
    };
    const month = (value: unknown, path: string) => {
      if (typeof value !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(`缴费归属月无效，请核对[${path}]`);
    };
    for (const [index, fact] of facts.entries()) {
      const path = `facts[${index}]`;
      if (!fact || typeof fact !== 'object' || Array.isArray(fact)) throw new Error(`已入薪记录不完整，请重新读取[${path}]`);
      text(fact.id, `${path}.id`);
      if (ids.has(fact.id)) throw new Error(`已入薪记录重复，请核对[${path}.id]`);
      ids.add(fact.id);
      try { payrollDate(fact.payDate); } catch { throw new Error(`已入薪记录的发薪日无效，请核对[${path}.payDate]`); }
      if (fact.payDate > identity.payDate) throw new Error(`已有更晚发薪记录，不能倒序核算[${path}.payDate]`);
      month(fact.socialMonth, `${path}.socialMonth`); month(fact.housingMonth, `${path}.housingMonth`);
      if (fact.payDate.slice(0, 4) === payYear) {
        // Only this tax year's cutoff is immutable; approved opening corrections may change its hash.
        if (fact.openingDate !== startDate) throw new Error(`已有入薪记录，不能更改台账起始日[${path}.openingDate]`);
        if (fact.payDate < startDate) throw new Error(`已入薪记录早于台账起始日，请核对期初[${path}.payDate]`);
      } else {
        if (fact.socialMonth !== socialMonth && fact.housingMonth !== housingMonth) throw new Error(`往年入薪记录与本次缴费归属月无关，请核对[${path}.payDate]`);
        try { payrollDate(fact.openingDate); } catch { throw new Error(`往年入薪记录的台账起始日无效，请核对[${path}.openingDate]`); }
        if (fact.openingDate > fact.payDate) throw new Error(`往年台账起始日不能晚于其发薪日[${path}.openingDate]`);
      }
      text(fact.openingHash, `${path}.openingHash`);
      for (const field of ['gross', 'socialInsurance', 'housingFund', 'incomeTax'] as const) amount(fact[field], `${path}.${field}`);
      if (!fact.taxDeductions || typeof fact.taxDeductions !== 'object' || Array.isArray(fact.taxDeductions) || Object.keys(fact.taxDeductions).some(key => !deductionFields.includes(key as keyof PayrollTaxDeductions))) {
        throw new Error(`已入薪记录的扣除明细缺失或无效，请核对[${path}.taxDeductions]`);
      }
      for (const field of deductionFields) amount(fact.taxDeductions[field], `${path}.taxDeductions.${field}`);
    }
    // Clone before calculating so evidence cannot be changed through caller-owned objects.
    snapshot = JSON.parse(canonical({ identity, settings: reviewed, facts: [...facts].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }));
  } catch (error) {
    return closed('needs_review', [error instanceof Error ? error.message : '已入薪记录无效，请重新读取[facts]']);
  }

  const D = Prisma.Decimal.clone({ precision: Math.max(40, canonical(snapshot).length * 2), rounding: Prisma.Decimal.ROUND_HALF_UP });
  const sum = (values: string[]) => values.reduce((total, value) => total.plus(value), new D(0));
  const actual = snapshot.facts;
  const taxActual = actual.filter(fact => fact.payDate.slice(0, 4) === payYear);
  const opening = { ...reviewed.tax.opening };
  // The tax opening is before startDate; older pay-year facts affect contributions only, never this tax year.
  opening.income = new D(opening.income).plus(sum(taxActual.map(fact => fact.gross))).toFixed();
  opening.taxPaid = new D(opening.taxPaid).plus(sum(taxActual.map(fact => fact.incomeTax))).toFixed();
  const residualDeductions = {} as PayrollTaxDeductions;
  for (const field of deductionFields) {
    opening[field] = new D(opening[field]).plus(sum(taxActual.map(fact => fact.taxDeductions[field]))).toFixed();
    const consumed = sum(taxActual.filter(fact => fact.payDate.slice(0, 7) === payMonth).map(fact => fact.taxDeductions[field])).plus(priorInPayMonth[field]);
    // current is a cumulative MONTHLY target, not a fresh allowance for each batch.
    const residual = new D(reviewed.tax.current[field]).minus(consumed);
    if (residual.lt(0)) return closed('needs_review', [`本月扣除目标低于已扣金额，请另行复核更正[tax.current.${field}]`], { input: snapshot, sourceHash: null });
    residualDeductions[field] = residual.toFixed();
  }
  const contributions = {} as Pick<PayrollDeductionSettings, 'socialInsurance' | 'housingFund'>;
  for (const [field, ruleMonth, prior] of [
    ['socialInsurance', socialMonth, priorSocialInsurance], ['housingFund', housingMonth, priorHousingFund],
  ] as const) {
    const consumed = sum(actual.filter(fact => (field === 'socialInsurance' ? fact.socialMonth : fact.housingMonth) === ruleMonth).map(fact => fact[field])).plus(prior);
    const residual = new D(target.evidence[field]!.amount).minus(consumed);
    if (residual.lt(0)) return closed('needs_review', [`本月缴费目标低于已扣金额，退款须另行复核[${field}]`], { input: snapshot, sourceHash: null });
    // Keep A1 rounding and net/tax guards; a rate-1 item represents only the unpaid remainder.
    contributions[field] = { ...reviewed[field], items: reviewed[field].status === 'not_applicable' ? [] : [{ code: 'ledger-residual', base: residual.toFixed(), rate: '1' }] };
  }
  const result = calculatePayrollDeductions(deductionSettingsInput(identity, {
    ...reviewed, ...contributions, tax: { ...reviewed.tax, opening, current: residualDeductions },
  }, identity.gross));
  if (result.status === 'needs_configuration') result.issues = configurationIssues(result.issues);
  if (result.status === 'needs_review') result.issues = ['实发金额为负，请复核扣缴或另行处理更正[net]'];
  result.evidence.input = { ...snapshot, calculationInput: result.evidence.input };
  result.evidence.sourceHash = hash({ ...result, evidence: { ...result.evidence, sourceHash: null } });
  if (result.status !== 'ready') return result;
  return { ...result, ledger: {
    openingDate: startDate, openingHash: hash({ startDate, opening: reviewed.tax.opening }), factIds: actual.map(fact => fact.id),
    taxDeductions: residualDeductions, socialMonth, housingMonth, sourceHash: result.evidence.sourceHash,
  } };
}
