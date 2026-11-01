import { SysRole } from '@prisma/client';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';

const operator = { id: 'synthetic-hr', sysRole: SysRole.hr } as any;
const contract = (id = 'synthetic-contract', extra: Record<string, unknown> = {}) => ({
  id, userId: 'synthetic-employee', contractType: 'contract', sequence: 0, name: '合成合同', signingCompany: null,
  signedAt: new Date('2024-01-01'), effectiveFrom: new Date('2024-02-01'), expiresAt: null, termType: null,
  originalCompany: null, newCompany: null, confidentialityAgreement: null, nonCompeteAgreement: null, portraitAgreement: null,
  images: [], attachments: [], isActive: true, endedAt: null, sourceBatchId: 'original-source', createdById: 'original-creator', ...extra,
});

function fixture(originals = [contract()]) {
  const stored: Record<string, any>[] = originals.map(item => ({ ...item }));
  function assertActiveKey(candidate: Record<string, any>) {
    if (candidate.isActive && stored.some(item => item.id !== candidate.id && item.isActive && item.userId === candidate.userId
      && item.contractType === candidate.contractType && item.sequence === candidate.sequence)) throw new Error('employee_contracts_active_business_key_key');
  }
  const tx = { employeeContract: {
    findMany: jest.fn(async () => stored.filter(item => item.isActive).map(item => ({ ...item }))),
    update: jest.fn(async ({ where, data }: any) => {
      const item = stored.find(item => item.id === where.id)!;
      assertActiveKey({ ...item, ...data });
      Object.assign(item, data);
      return { ...item };
    }),
    create: jest.fn(async ({ data }: any) => { const item = { id: 'synthetic-new-contract', ...data }; assertActiveKey(item); stored.push(item); return item; }),
  } };
  const service = new EmployeeDataReviewsService({} as any);
  return { tx, stored, apply: (proposed: Record<string, unknown>[]) => (service as any).reconcileRosterContracts(tx, 'synthetic-employee', {}, proposed, null, operator, 'manual_archive_change') };
}

describe('contract review applies the exact approved proposal under the active business key constraint', () => {
  it('preserves an explicitly cleared effective date on the existing contract', async () => {
    const { apply, stored, tx } = fixture();
    await apply([{ ...contract(), effectiveFrom: null }]);
    expect(stored[0].effectiveFrom).toBeNull();
    expect(stored[0].signedAt).toEqual(new Date('2024-01-01'));
    expect(tx.employeeContract.update).toHaveBeenCalledWith({ where: { id: 'synthetic-contract' }, data: { effectiveFrom: null } });
  });

  it('changes contract type in place while retaining identity and creation history', async () => {
    const { apply, stored, tx } = fixture();
    await apply([{ ...contract(), contractType: 'attachment' }]);
    expect(stored[0]).toMatchObject({ id: 'synthetic-contract', contractType: 'attachment', isActive: true, endedAt: null, sourceBatchId: 'original-source', createdById: 'original-creator' });
    expect(tx.employeeContract.create).not.toHaveBeenCalled();
  });

  it('can exchange occupied type/sequence keys without creating or ending retained IDs', async () => {
    const first = contract('first'); const second = contract('second', { contractType: 'attachment' });
    const { apply, stored, tx } = fixture([first, second]);
    await apply([{ ...first, contractType: 'attachment' }, { ...second, contractType: 'contract' }]);
    expect(stored).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'first', contractType: 'attachment', isActive: true, endedAt: null }),
      expect.objectContaining({ id: 'second', contractType: 'contract', isActive: true, endedAt: null }),
    ]));
    expect(tx.employeeContract.create).not.toHaveBeenCalled();
  });

  it('releases the removed contract key before moving the retained contract into its sequence', async () => {
    const first = contract('removed'); const second = contract('retained', { sequence: 1 });
    const { apply, stored, tx } = fixture([first, second]);
    await apply([{ ...second, sequence: 0 }]);
    expect(stored.find(item => item.id === 'removed')).toMatchObject({ isActive: false, endedAt: expect.any(Date) });
    expect(stored.find(item => item.id === 'retained')).toMatchObject({ isActive: true, endedAt: null, sequence: 0 });
    expect(tx.employeeContract.create).not.toHaveBeenCalled();
  });

  it('rejects two different IDs targeting the same active key before changing a contract', async () => {
    const first = contract('first'); const second = contract('second', { sequence: 1 });
    const { apply, tx } = fixture([first, second]);
    await expect(apply([{ ...first }, { ...second, sequence: 0 }])).rejects.toThrow('合同类型和顺序重复');
    expect(tx.employeeContract.update).not.toHaveBeenCalled();
    expect(tx.employeeContract.create).not.toHaveBeenCalled();
  });

  it('keeps the existing signing-date default for a newly created contract', async () => {
    const { apply, stored } = fixture([]);
    await apply([{ signedAt: '2026-11-01', effectiveFrom: null, contractType: 'contract', sequence: 0 }]);
    expect(stored[0].effectiveFrom).toEqual(new Date('2026-11-01'));
  });
});
