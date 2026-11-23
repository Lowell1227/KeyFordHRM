import { PayrollDataService } from './payroll-data.service';

describe('manual wage rule scope', () => {
  const person = '00000000-0000-4000-8000-000000000001';
  const other = '00000000-0000-4000-8000-000000000002';
  function fixture() {
    const tx = {
      $queryRaw: jest.fn(async () => []),
      employmentRecord: { findMany: jest.fn(async () => [{ userId: person, contractSubjectId: 'subject',
        employeeStatus: 'active', effectiveFrom: new Date('2026-01-01'), effectiveTo: null, entryDate: null, leaveDate: null }]) },
      payrollPolicy: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }) => ({ id: 'rule', ...data })) },
      payrollEvent: { create: jest.fn(async () => ({})) },
    };
    const prisma = { ...tx, $transaction: async callback => callback(tx) };
    const access = { assert: jest.fn(), maintenancePurpose: () => 'validation', assertDomain: async () => 'validation' };
    const service = new PayrollDataService(prisma as any, access as any);
    const save = (id = person) => service.saveRule({ subjectId: 'subject', effectiveFrom: '2026-11-01', config: {
      performance: { '2026-11': { sourceKind: 'manual', manualAmounts: { [id]: '1234.56' }, evidenceRef: 'Fictional confirmed amount' } },
    } }, { id: 'hr' } as any);
    return { tx, access, save };
  }
  it('rejects foreign employee amounts before storing a reviewable snapshot', async () => {
    const { save, tx } = fixture();
    await expect(save(other)).rejects.toThrow('人员');
    expect(tx.payrollPolicy.create).not.toHaveBeenCalled();
  });
  it('accepts authorized employee and keeps a draft for manager review', async () => {
    const { save, tx, access } = fixture(); const row = await save();
    expect(access.assert).toHaveBeenCalledWith(tx, { id: 'hr' }, 'subject', 'payroll_edit');
    expect((row.config as any).performance['2026-11'].manualAmounts[person]).toBe('1234.56');
    expect(tx.payrollPolicy.create.mock.calls[0][0].data.status).not.toBe('active');
  });
});
