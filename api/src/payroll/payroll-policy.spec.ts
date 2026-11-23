import { BadRequestException } from '@nestjs/common';
import { normalizePayrollPolicy } from './payroll-policy';
import { payrollCalendarDays } from './payroll-work-calendar';

describe('payroll policy config', () => {
  const person = '00000000-0000-4000-8000-000000000001';
  it('normalizes explicit payer assignments without inferring a contract subject', () => {
    expect((normalizePayrollPolicy({ employeeScope: { employeeIds: [person], evidenceRef: '  Fictional payer approval  ' } }) as any).employeeScope)
      .toEqual({ employeeIds: [person], evidenceRef: 'Fictional payer approval' });
  });
  it.each([[], [person, person], ['employee'], Array(1001).fill(person)].map(employeeIds => ({ employeeIds })))('rejects invalid formal employee scope identities: %j', ({ employeeIds }) => {
    expect(() => normalizePayrollPolicy({ employeeScope: { employeeIds, evidenceRef: 'Fictional approval' } })).toThrow(BadRequestException);
  });
  it.each(['', ' ', 'x'.repeat(201)])('rejects missing or oversized payer scope evidence', evidenceRef => {
    expect(() => normalizePayrollPolicy({ employeeScope: { employeeIds: [person], evidenceRef } })).toThrow(BadRequestException);
  });
  it('accepts explicit reviewed manual monthly money without cycles or coefficients', () => {
    const result = normalizePayrollPolicy({ performance: { '2026-11': {
      sourceKind: 'manual', manualAmounts: { [person]: '1200.50' }, evidenceRef: 'HR confirmation',
    } } });
    expect(result.performance['2026-11']).toMatchObject({ sourceKind: 'manual', manualAmounts: { [person]: '1200.50' }, cycleIds: [], coefficients: {} });
    const zero = normalizePayrollPolicy({ performance: { '2026-11': { sourceKind: 'manual', manualAmounts: { [person]: '0' } } } });
    expect((zero.performance['2026-11'] as any).manualAmounts[person]).toBe('0.00');
  });
  it.each(['', '-1', '1.001', 'Infinity', '1000000000000'])('rejects invalid manual monthly money %s', amount => {
    expect(() => normalizePayrollPolicy({ performance: { '2026-11': { sourceKind: 'manual', manualAmounts: { [person]: amount } } } })).toThrow(BadRequestException);
  });
  it('rejects foreign-shaped identities and mixed manual/automatic inputs', () => {
    for (const mapping of [
      { sourceKind: 'manual', manualAmounts: { arbitrary: '12' } },
      { sourceKind: 'manual', cycleIds: [person], manualAmounts: { [person]: '12' } },
      { sourceKind: 'manual', coefficients: { A: '1' }, manualAmounts: { [person]: '12' } },
      { sourceKind: 'official', manualAmounts: { [person]: '12' } },
    ]) expect(() => normalizePayrollPolicy({ performance: { '2026-11': mapping } })).toThrow(BadRequestException);
  });
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
  it('retains the calendar and coefficient approval version without supplying missing values', () => {
    const calendar = { sourceVersion: 'fictional-v1', evidenceRef: 'Fictional approval', days: payrollCalendarDays('2026-11').map((workDate, i) => ({ workDate, units: i < 20 ? '1' : '0' })) };
    const value = normalizePayrollPolicy({ fixedSalaryBasis: 'monthly_workdays', workCalendars: { '2026-11': calendar },
      performance: { '2026-11': { coefficientVersion: 'table-v1', evidenceRef: 'Fictional table approval' } } });
    expect(value.workCalendars?.['2026-11']).toEqual(calendar);
    expect(value.performance['2026-11'].coefficientVersion).toBe('table-v1');
    expect(value.performance['2026-11'].coefficients).toEqual({});
    expect(() => normalizePayrollPolicy({ fixedSalaryBasis: 'actual_punches' })).toThrow();
    expect(() => normalizePayrollPolicy({ workCalendars: { '2026-11': { ...calendar, days: calendar.days.slice(10) } } })).toThrow();
  });
});
