import { BadRequestException } from '@nestjs/common';
import { normalizePayrollPolicy } from './payroll-policy';

describe('payroll policy config', () => {
  it('keeps unconfirmed fields blank rather than inventing official values', () => {
    const config = normalizePayrollPolicy({});
    expect(config.rounding).toBeNull(); expect(config.normalHourly).toBeNull(); expect(config.monthlyUnits).toEqual({});
    expect(config.reviewers).toEqual([]); expect(config.approvers).toEqual([]); expect(config.cutoverMonth).toBeNull();
  });
  it('rejects unknown/free-form fields and nondecimal defaults', () => {
    for (const config of [{ formula: 'eval(value)' }, { normalHourly: 100 }, { monthlyUnits: { '2026-13': '20' } },
      { paidHourly: { unknown_leave: '0' } }, { reviewers: ['HR管理员'] }, { overtime: { weekday: 'Infinity' } },
      { performance: { '2026-11': { coefficients: { A: '-1' } } } }]) expect(() => normalizePayrollPolicy(config)).toThrow(BadRequestException);
  });
  it('preserves explicit zero and test-source registration without fallback1', () => {
    const config = normalizePayrollPolicy({ normalHourly: '0', monthlyUnits: { '2026-11': '20' }, performance: {
      '2026-11': { sourceKind: 'fictional', cycleIds: ['00000000-0000-4000-8000-000000000001'], coefficients: { A: '0' } },
    } });
    expect(config.normalHourly).toBe('0'); expect(config.performance['2026-11'].coefficients).toEqual({ A: '0' });
  });
});
