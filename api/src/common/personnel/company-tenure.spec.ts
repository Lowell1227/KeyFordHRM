import { companyTenure } from './company-tenure';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const record = (changes: Record<string, unknown> = {}) => ({
  id: 'current', effectiveFrom: day('2025-09-01'), effectiveTo: null,
  entryDate: day('2020-01-15'), leaveDate: null, employeeStatus: 'active', ...changes,
});

describe('companyTenure', () => {
  it('uses the formal entry date through a transfer and the Shanghai calendar day', () => {
    const subject = { status: 'active', employmentHistory: [record()] };
    expect(companyTenure(subject, new Date('2026-11-14T15:59:59Z'))).toBe('6年9个月');
    expect(companyTenure(subject, new Date('2026-11-14T16:00:00Z'))).toBe('6年10个月');
  });

  it('restarts from the confirmed reentry without adding previous employment', () => {
    expect(companyTenure({ status: 'active', employmentHistory: [
      record({ id: 'old', effectiveFrom: day('2020-01-15'), effectiveTo: day('2025-01-01') }),
      record({ entryDate: day('2026-10-01'), effectiveFrom: day('2026-10-01') }),
    ] }, day('2026-11-12'))).toBe('1个月');
  });

  it('stops resigned tenure on the last working date instead of today or interval end', () => {
    expect(companyTenure({ status: 'resigned', employmentHistory: [record({
      employeeStatus: 'resigned', entryDate: day('2024-01-01'), leaveDate: day('2025-03-01'),
      effectiveFrom: day('2025-03-02'), effectiveTo: day('2025-03-02'),
    })] }, day('2026-11-12'))).toBe('1年2个月');
  });

  it('does not accumulate tenure before HR confirms arrival', () => {
    expect(companyTenure({ status: 'pending_entry', employmentHistory: [record()] }, day('2026-11-12'))).toBe('未到岗');
  });

  it('keeps tenure through regularization between two current-worker statuses', () => {
    expect(companyTenure({ status: 'active', employmentHistory: [record({ employeeStatus: 'probation' })] }, day('2026-11-15')))
      .toBe('6年10个月');
  });

  it.each([
    { status: 'active', employmentHistory: [] },
    { status: 'active', employmentHistory: [record({ entryDate: null })] },
    { status: 'active', employmentHistory: [record({ entryDate: day('2027-01-01') })] },
    { status: 'active', employmentHistory: [record(), record({ id: 'overlap' })] },
    { status: 'resigned', employmentHistory: [record({ employeeStatus: 'resigned', leaveDate: null })] },
    { status: 'resigned', employmentHistory: [record({ employeeStatus: 'resigned', leaveDate: day('2019-01-01') })] },
    { status: 'resigned', employmentHistory: [record({ employeeStatus: 'resigned', leaveDate: day('2027-01-01') })] },
  ])('marks missing or inconsistent dates for completion %#', subject => {
    expect(companyTenure(subject, day('2026-11-12'))).toBe('待完善');
  });

  it.each([
    ['2026-01-31', '2026-02-28', '1个月'],
    ['2024-02-29', '2025-02-28', '1年'],
    ['2026-11-01', '2026-11-12', '不满1个月'],
  ])('counts complete calendar months from %s to %s', (entry, today, expected) => {
    expect(companyTenure({ status: 'active', employmentHistory: [record({
      entryDate: day(entry), effectiveFrom: day(entry),
    })] }, day(today))).toBe(expected);
  });
});
