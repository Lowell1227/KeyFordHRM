import { ForbiddenException } from '@nestjs/common';
import { PayrollDataService } from './payroll-data.service';
import { fictionalDeductionsInput } from './payroll-deductions-preview.fixture';

function setup() {
  const rows: any[] = [], actor = { id: 'hr' } as any;
  const input = { subjectId: 'subject', employeeId: 'employee', payDate: '2035-12-10', settings: null as any };
  const facts = fictionalDeductionsInput({ ...input, month: '2035-11', gross: '10000' });
  const { subjectId, employeeId, payDate, gross, ...settings } = facts;
  const { subjectId: s, employeeId: e, year, ...opening } = settings.tax.opening;
  input.settings = { ...settings, tax: { ...settings.tax, opening } };
  const tx: any = { $queryRaw: jest.fn(), employmentRecord: { findFirst: jest.fn(async () => ({ userId: 'employee' })) },
    payrollDeductionProfile: { findFirst: jest.fn(async () => rows.at(-1) ?? null), findMany: jest.fn(async () => rows),
      create: jest.fn(async ({ data }) => { const row = { id: `profile-${rows.length}`, status: 'draft', ...data }; rows.push(row); return row; }) },
    payrollEvent: { create: jest.fn() } };
  const access = { assert: jest.fn(async (_tx, user) => { if (user.id !== actor.id) throw new ForbiddenException(); }), assertDomain: jest.fn(async () => 'validation') };
  const service = new PayrollDataService({ ...tx, $transaction: async work => work(tx) } as any, access as any);
  return { service, tx, rows, input, actor };
}
describe('deduction input versions', () => {
  it('creates a new draft for the exact payment identity without rewriting prior records', async () => {
    const s = setup(), first = await s.service.saveDeductions(s.input, s.actor), before = JSON.stringify(first);
    const second = await s.service.saveDeductions(s.input, s.actor);
    expect(first.version).toBe(1); expect(second.version).toBe(2); expect(second.status).toBe('draft');
    expect(JSON.stringify(first)).toBe(before); expect(second.effectiveFrom).toEqual(new Date(s.input.payDate));
    expect(s.tx.payrollEvent.create).toHaveBeenCalledTimes(2);
  });
  it('checks subject authority before reading private settings and rejects foreign employment', async () => {
    const s = setup(); await expect(s.service.deductions('subject', { id: 'administrator' } as any)).rejects.toThrow(ForbiddenException);
    expect(s.tx.payrollDeductionProfile.findMany).not.toHaveBeenCalled();
    s.tx.employmentRecord.findFirst.mockResolvedValue(null);
    await expect(s.service.saveDeductions(s.input, s.actor)).rejects.toThrow('不属于'); expect(s.rows).toEqual([]);
  });
});
