import { BadRequestException, ConflictException } from '@nestjs/common';
import { assertPayrollVersion, lockPayrollAuthorization, lockPayrollSubject, payrollDate, payrollHash, payrollMonth } from './payroll-transaction';

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

describe('payroll authorization row fence after subject locking', () => {
  const subjectId = '20000000-0000-4000-8000-000000000001';
  const fence = (tx: any) => lockPayrollAuthorization(tx, subjectId);
  it('locks bound subject users and their managers before all grants, in deterministic row order', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };
    await fence(tx);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    const [users, grants] = tx.$queryRaw.mock.calls;
    const userSql = users[0].join('?').replace(/\s+/g, ' '), grantSql = grants[0].join('?').replace(/\s+/g, ' ');
    expect(userSql).toMatch(/FROM "users"/); expect(userSql).toContain('"direct_manager_id"');
    expect(userSql).toMatch(/ORDER BY "u"\."id" FOR SHARE OF "u"/);
    expect(grantSql).toMatch(/FROM "payroll_grants"/); expect(grantSql).toMatch(/ORDER BY "id" FOR SHARE/);
    for (const call of [users, grants]) {
      expect(call.slice(1).length).toBeGreaterThan(0); expect(call.slice(1).every(value => value === subjectId)).toBe(true);
      expect(call[0].join('')).not.toMatch(/revoked_at|status|archived_at|deleted_at|pg_advisory/);
    }
  });
  it.each([
    { code: 'P2010', meta: { code: '40001' } }, { code: 'P2010', meta: { code: 40001 } },
    { code: 'P2034' }, { code: '40001' },
  ])('turns stale authorization snapshots into a business conflict (%j)', async error => {
    for (const query of [1, 2]) {
      const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };
      if (query === 2) tx.$queryRaw.mockResolvedValueOnce([]);
      tx.$queryRaw.mockRejectedValueOnce(error);
      await expect(fence(tx)).rejects.toThrow(ConflictException);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(query);
    }
  });
  it('does not swallow unrelated database failures', async () => {
    const error = { code: 'P2010', meta: { code: '42501' } }, tx = { $queryRaw: jest.fn().mockRejectedValue(error) };
    await expect(fence(tx)).rejects.toBe(error);
  });
});
