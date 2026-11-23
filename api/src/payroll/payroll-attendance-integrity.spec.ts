import { payrollAttendanceHash } from './payroll-attendance-integrity';
import { payrollHash } from './payroll-transaction';

describe('attendance JSONB digest', () => {
  it('keeps object reordering harmless and preserves ordered records', () => {
    const a = { month: '2037-01', days: [{ employeeId: 'fictional', records: [{ hours: '1', type: 'absence' }] }] };
    const b = { days: [{ records: [{ type: 'absence', hours: '1' }], employeeId: 'fictional' }], month: '2037-01' };
    expect(payrollAttendanceHash(a)).toBe(payrollAttendanceHash(b));
    expect(payrollAttendanceHash({ rows: [1, 2] })).not.toBe(payrollAttendanceHash({ rows: [2, 1] }));
  });
  it('detects changed values and cannot be confused with the legacy shared digest', () => {
    const value = { hours: '1', date: '2037-01-01' };
    expect(payrollAttendanceHash(value)).not.toBe(payrollAttendanceHash({ ...value, hours: '2' }));
    expect(payrollAttendanceHash(value)).not.toBe(payrollHash(value));
    expect(payrollHash({ a: 1, b: 2 })).not.toBe(payrollHash({ b: 2, a: 1 }));
  });
});
