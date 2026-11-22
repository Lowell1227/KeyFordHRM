import { normalizePayrollWorkCalendar, payrollCalendarDays } from './payroll-work-calendar';

const month = '2026-11';
function calendar() {
  return { sourceVersion: 'fictional-calendar-v1', evidenceRef: 'Fictional approved schedule',
    days: payrollCalendarDays(month).map((workDate, index) => ({ workDate, units: index < 20 ? '1' : '0' })) };
}

describe('payroll full-month work calendar', () => {
  it('requires every calendar date, not just the employed or scheduled dates', () => {
    const value = calendar();
    expect(normalizePayrollWorkCalendar(month, value)).toEqual(value);
    expect(() => normalizePayrollWorkCalendar(month, { ...value, days: value.days.slice(0, 10) })).toThrow('完整自然月');
  });
  it.each(['sourceVersion', 'evidenceRef'])('requires traceable %s', field => {
    expect(() => normalizePayrollWorkCalendar(month, { ...calendar(), [field]: ' ' })).toThrow();
  });
  it('rejects duplicates, wrong-month dates, invalid dates and invalid workday units', () => {
    for (const patch of [{ workDate: '2026-11-31' }, { workDate: '2026-12-01' },
      { workDate: '2026-11-02' }, { units: '-1' }, { units: '1.1' }, { units: 1 }]) {
      const value = calendar(); Object.assign(value.days[0], patch);
      expect(() => normalizePayrollWorkCalendar(month, value)).toThrow();
    }
  });
  it('does not infer holidays or fill missing schedules, and requires a positive denominator', () => {
    const value = calendar(); value.days.forEach(day => { day.units = '0'; });
    expect(() => normalizePayrollWorkCalendar(month, value)).toThrow('大于零');
    expect(payrollCalendarDays('2028-02')).toHaveLength(29);
    expect(() => payrollCalendarDays('2026-13')).toThrow();
  });
  it('canonicalizes without mutating the input', () => {
    const value = calendar(); value.days.reverse(); value.days[0].units = '0.0000';
    const before = JSON.stringify(value), normalized = normalizePayrollWorkCalendar(month, value);
    expect(JSON.stringify(value)).toBe(before);
    expect(normalized.days[0].workDate).toBe('2026-11-01');
    expect(normalized.days[29].units).toBe('0');
  });
});
