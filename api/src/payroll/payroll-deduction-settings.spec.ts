import { BadRequestException } from '@nestjs/common';
import { fictionalDeductionsInput } from './payroll-deductions-preview.fixture';
import { deductionSettingsInput, normalizeDeductionSettings } from './payroll-deduction-settings';

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
});
