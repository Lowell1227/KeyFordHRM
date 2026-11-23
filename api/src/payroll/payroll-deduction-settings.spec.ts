import { BadRequestException } from '@nestjs/common';
import { fictionalDeductionsInput } from './payroll-deductions-preview.fixture';
import { deductionSettingsInput, normalizeDeductionSettings, PayrollDeductionSettings } from './payroll-deduction-settings';

const identity = { subjectId: 'subject', employeeId: 'employee', payDate: '2035-12-10' };
function fixture() {
  const { subjectId, employeeId, payDate, gross, ...settings } = fictionalDeductionsInput({ ...identity, month: '2035-11', gross: '10000' });
  const { subjectId: a, employeeId: b, year, ...opening } = settings.tax.opening;
  return { ...settings, tax: { ...settings.tax, opening } };
}
describe('reviewed deduction settings', () => {
  it('binds identity, tax year and gross from trusted context without mutating settings', () => {
    const value = fixture(), before = JSON.stringify(value);
    const normalized = normalizeDeductionSettings(identity, value);
    const input = deductionSettingsInput(identity, normalized, '10000');
    expect(input.tax.opening).toMatchObject({ subjectId: identity.subjectId, employeeId: identity.employeeId, year: 2035 });
    expect(input.tax.opening).not.toHaveProperty('payDate');
    expect(input.gross).toBe('10000'); expect(JSON.stringify(value)).toBe(before);
  });
  it.each(['gross', 'employeeId', 'subjectId', 'payDate'])('rejects an injected %s rather than silently discarding it', field => {
    expect(() => normalizeDeductionSettings(identity, { ...fixture(), [field]: 'forged' })).toThrow(BadRequestException);
  });
  it('rejects injected identity or hidden deduction facts nested in the payload', () => {
    for (const change of [
      (s: any) => { s.tax.opening.employeeId = 'another'; },
      (s: any) => { s.tax.current.taxPaid = '1000'; },
      (s: any) => { s.socialInsurance.items[0].amount = '0'; },
    ]) { const value = fixture(); change(value); expect(() => normalizeDeductionSettings(identity, value)).toThrow(BadRequestException); }
  });
  it('requires explicit facts, real dates and confirmation, not defaults', () => {
    for (const change of [
      (s: any) => { delete s.tax.current.specialDeduction; },
      (s: any) => { s.tax.opening.confirmed = false; },
      (s: any) => { s.socialInsurance.contributionDate = '2035-02-31'; },
      (s: any) => { s.housingFund.items[0].rate = '1.1'; },
    ]) { const value = fixture(); change(value); expect(() => normalizeDeductionSettings(identity, value)).toThrow(BadRequestException); }
    expect(() => normalizeDeductionSettings({ ...identity, payDate: '2035-02-31' }, fixture())).toThrow(BadRequestException);
  });
  const zero = () => ({ exemptIncome: '0', standardDeduction: '0', specialDeduction: '0', additionalDeduction: '0', otherDeduction: '0', taxRelief: '0' });
  function ledgerFixture(): PayrollDeductionSettings {
    return { ...fixture(), ledger: { startDate: '2035-11-15', priorInPayMonth: zero(), priorSocialInsurance: '25', priorHousingFund: '10' } };
  }
  it('accepts explicit ledger context without leaking it into standalone engine input', () => {
    const value = ledgerFixture();
    const normalized = normalizeDeductionSettings(identity, value);
    expect(normalized).toEqual(value);
    expect(normalized).not.toBe(value);
    expect(deductionSettingsInput(identity, normalized, '10000')).not.toHaveProperty('ledger');
  });
  it.each([
    (s: any) => { s.ledger = null; },
    (s: any) => { delete s.ledger.startDate; },
    (s: any) => { s.ledger.startDate = '2035-02-31'; },
    (s: any) => { s.ledger.startDate = '2034-11-15'; },
    (s: any) => { s.ledger.startDate = '2035-12-11'; },
    (s: any) => { delete s.ledger.priorInPayMonth.standardDeduction; },
    (s: any) => { s.ledger.priorInPayMonth.taxPaid = '1'; },
    (s: any) => { s.ledger.priorInPayMonth.standardDeduction = '1'; },
    (s: any) => { s.ledger.priorSocialInsurance = '-1'; },
    (s: any) => { s.ledger.priorHousingFund = 0; },
    (s: any) => { s.ledger.hidden = 'forged'; },
    (s: any) => { s.socialInsurance.contributionDate = '2035-02-31'; },
    (s: any) => { s.housingFund.contributionDate = '2035-12-01'; },
  ])('rejects malformed, ambiguous or out-of-period ledger context %#', change => {
    const value = ledgerFixture(); change(value);
    expect(() => normalizeDeductionSettings(identity, value)).toThrow(BadRequestException);
  });
  it('accepts cutoff-month prior deductions, requiring explicit zero in later pay/contribution months', () => {
    const value = ledgerFixture();
    value.ledger!.priorInPayMonth.standardDeduction = '500';
    value.tax.opening.standardDeduction = '500';
    expect(normalizeDeductionSettings({ ...identity, payDate: '2035-11-20' }, value)).toEqual(value);
    value.ledger!.priorInPayMonth = zero();
    value.ledger!.priorSocialInsurance = '0'; value.ledger!.priorHousingFund = '0';
    value.socialInsurance.contributionDate = '2035-12-01'; value.housingFund.contributionDate = '2035-12-01';
    value.socialInsurance.effectiveTo = null; value.housingFund.effectiveTo = null;
    expect(normalizeDeductionSettings(identity, value)).toEqual(value);
  });
  it.each(Object.keys(zero()))('rejects prior cutoff-month %s exceeding its cumulative opening', field => {
    const value: any = ledgerFixture(); value.ledger.priorInPayMonth[field] = '1';
    expect(() => normalizeDeductionSettings({ ...identity, payDate: '2035-11-20' }, value)).toThrow(BadRequestException);
    value.tax.opening[field] = '1';
    expect(normalizeDeductionSettings({ ...identity, payDate: '2035-11-20' }, value)).toEqual(value);
  });
  it.each(['2035-12-31', '2036-01-01'])('accepts external contribution totals for %s independently of the tax cutoff', contributionDate => {
    const value = ledgerFixture(); value.ledger!.startDate = '2036-01-01';
    value.ledger!.priorSocialInsurance = '100'; value.ledger!.priorHousingFund = '100';
    for (const field of ['socialInsurance', 'housingFund'] as const) {
      value[field].contributionDate = contributionDate; value[field].effectiveFrom = '2035-12-01'; value[field].effectiveTo = '2036-12-31';
    }
    value.tax.effectiveFrom = '2036-01-01'; value.tax.effectiveTo = '2036-12-31';
    expect(normalizeDeductionSettings({ ...identity, payDate: '2036-01-10' }, value)).toEqual(value);
  });
  it.each(['socialInsurance', 'housingFund'] as const)('still requires explicit zero external totals after the cutoff month for %s', field => {
    const value = ledgerFixture(); value[field].contributionDate = '2035-12-01'; value[field].effectiveTo = null;
    expect(() => normalizeDeductionSettings(identity, value)).toThrow(BadRequestException);
    value.ledger![field === 'socialInsurance' ? 'priorSocialInsurance' : 'priorHousingFund'] = '0';
    expect(normalizeDeductionSettings(identity, value)).toEqual(value);
  });
});
