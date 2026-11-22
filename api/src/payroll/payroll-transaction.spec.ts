import { BadRequestException, ConflictException } from '@nestjs/common';
import { assertPayrollVersion, lockPayrollSubject, payrollDate, payrollHash, payrollMonth } from './payroll-transaction';

describe('payroll boundaries', () => {
  it('validates real calendar dates and month bounds without local timezone', () => {
    expect(payrollMonth('2028-02').end.toISOString().slice(0, 10)).toBe('2028-02-29');
    expect(payrollDate('2028-02-29').toISOString().slice(0, 10)).toBe('2028-02-29');
    for (const value of ['2026-02-29', '2026-02-31', '2026-13-01', '2026-2-01', 'bad']) {
      expect(() => payrollDate(value)).toThrow(BadRequestException);
    }
    for (const value of ['2026-00', '2026-13', '2026-1', 'bad']) expect(() => payrollMonth(value)).toThrow(BadRequestException);
  });
  it('requires the exact expected version and fingerprints the fixed evidence', () => {
    expect(() => assertPayrollVersion(3, 3)).not.toThrow();
    for (const value of [2, 3.1, NaN]) expect(() => assertPayrollVersion(3, value)).toThrow(ConflictException);
    expect(payrollHash({ version: 3 })).toBe(payrollHash({ version: 3 }));
    expect(payrollHash({ version: 3 })).not.toBe(payrollHash({ version: 4 }));
  });
  it('passes subject identity as a bound lock parameter', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };
    await lockPayrollSubject(tx as any, "untrusted'key", 'validation');
    expect(tx.$queryRaw.mock.calls[0][1]).toBe("payroll:validation:untrusted'key");
  });
});
