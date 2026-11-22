import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PayrollAttendanceSyncDto, PayrollDecisionDto, PayrollFixtureDto } from './payroll.dto';

describe('payroll HTTP validation', () => {
  const subjectId = '00000000-0000-4000-8000-000000000001';
  it.each([false, 'false'])('preserves the explicit false fixture query %s', async corrected => {
    const value = plainToInstance(PayrollFixtureDto, { subjectId, month: '2026-11', corrected });
    expect(await validate(value)).toEqual([]);
    expect(value.corrected).toBe(false);
  });
  it('allows an approval without optional commentary', async () => {
    const value = plainToInstance(PayrollDecisionDto, { expectedVersion: 2, decision: 'approve', note: '' });
    expect(await validate(value)).toEqual([]);
  });
  it.each([null, {}, { month: '2026-11', expected: [null], records: [] }])('rejects malformed source shapes', async input => {
    expect((await validate(plainToInstance(PayrollAttendanceSyncDto, { subjectId, month: '2026-11', sourceKey: 'fixture', input }))).length).toBeGreaterThan(0);
  });
});
