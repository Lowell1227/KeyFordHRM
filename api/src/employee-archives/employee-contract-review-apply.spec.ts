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
  it.each(['signedAt', 'effectiveFrom', 'expiresAt'])('rejects impossible %s before writing any contracts', async field => {
    const { apply, stored, tx } = fixture();
    await expect(apply([{ ...contract(), [field]: '2026-02-31' }])).rejects.toMatchObject({
      response: { code: 4001, data: { fieldErrors: { [`contracts.0.${field}`]: expect.any(String) } } },
    });
    expect(stored[0]).toEqual(contract());
    expect(tx.employeeContract.update).not.toHaveBeenCalled();
  });

  it('rejects an expiry before effective date but accepts signing after effective date', async () => {
    const { apply, stored } = fixture();
    await expect(apply([{ ...contract(), expiresAt: '2024-01-31' }])).rejects.toMatchObject({
      response: { data: { fieldErrors: { 'contracts.0.expiresAt': expect.any(String) } } },
    });
    await apply([{ ...contract(), signedAt: '2024-03-01', expiresAt: '2024-02-01' }]);
    expect(stored[0]).toMatchObject({ signedAt: new Date('2024-03-01'), expiresAt: new Date('2024-02-01') });
  });

  it('rejects a new duplicate despite a different sequence and date representation', async () => {
    const { apply, stored, tx } = fixture();
    await expect(apply([contract(), { ...contract(), id: undefined, sequence: 1,
      signedAt: '2024-01-01', effectiveFrom: '2024-02-01' }])).rejects.toMatchObject({
      response: { code: 4001, data: { fieldErrors: { 'contracts.1.name': expect.any(String) } } },
    });
    expect(stored).toEqual([contract()]);
    expect(tx.employeeContract.create).not.toHaveBeenCalled();
    expect(tx.employeeContract.update).not.toHaveBeenCalled();
  });

  it('rejects two new identical rows and an edit creating a duplicate', async () => {
    const newRows = fixture([]);
    await expect(newRows.apply([{ ...contract(), id: undefined }, { ...contract(), id: undefined, sequence: 4 }]))
      .rejects.toMatchObject({ response: { data: { fieldErrors: { 'contracts.1.name': expect.any(String) } } } });
    const second = contract('second', { name: 'Different contract', sequence: 1 });
    const f = fixture([contract(), second]);
    await expect(f.apply([contract(), { ...second, name: contract().name }]))
      .rejects.toMatchObject({ response: { data: { fieldErrors: { 'contracts.1.name': expect.any(String) } } } });
    expect(f.stored[1].name).toBe('Different contract');
  });

  it('points to the new row even when it appears before the retained contract', async () => {
    const { apply } = fixture();
    await expect(apply([{ ...contract(), id: undefined, sequence: 9 }, contract()])).rejects.toMatchObject({
      response: { data: { fieldErrors: { 'contracts.0.name': expect.any(String) } } },
    });
  });

  it('compares business aliases and materials independent of object key order', async () => {
    const file = { name: 'Synthetic.pdf', url: '/synthetic.pdf', size: 1, mimeType: 'application/pdf' };
    const old = contract('old', { termType: '3 years', attachments: [file] });
    const { apply } = fixture([old]);
    const { contractType, termType, ...copy } = old;
    await expect(apply([old, { ...copy, id: undefined, sequence: 2, kind: contractType, termText: termType,
      attachments: [{ mimeType: file.mimeType, size: file.size, url: file.url, name: file.name }] }]))
      .rejects.toMatchObject({ response: { data: { fieldErrors: { 'contracts.1.name': expect.any(String) } } } });
  });

  it('retains existing duplicate IDs without merging or ending them, including reorder', async () => {
    const second = contract('second', { sequence: 1 });
    const { apply, stored, tx } = fixture([contract(), second]);
    await apply([{ ...second, sequence: 0 }, { ...contract(), sequence: 1 }]);
    expect(stored.map(item => ({ id: item.id, isActive: item.isActive, endedAt: item.endedAt }))).toEqual([
      { id: 'synthetic-contract', isActive: true, endedAt: null }, { id: 'second', isActive: true, endedAt: null },
    ]);
    expect(tx.employeeContract.create).not.toHaveBeenCalled();
  });

  it('allows identical dates for different business content', async () => {
    const { apply, stored } = fixture();
    await apply([contract(), { ...contract(), id: undefined, sequence: 1, name: 'Different agreement' }]);
    expect(stored).toHaveLength(2);
    expect(stored[1].signedAt).toEqual(stored[0].signedAt);
  });

  it('keeps a valid leap day', async () => {
    const { apply, stored } = fixture();
    await apply([{ ...contract(), signedAt: '2024-02-29' }]);
    expect(stored[0].signedAt).toEqual(new Date('2024-02-29'));
  });

  it('does not normalize an impossible new date into an unchanged existing day', async () => {
    const old = contract('old', { signedAt: new Date('2026-03-03') });
    const { apply } = fixture([old]);
    await expect(apply([{ ...old, signedAt: '2026-02-31' }])).rejects.toMatchObject({
      response: { data: { fieldErrors: { 'contracts.0.signedAt': expect.any(String) } } },
    });
  });

  it('rejects copying an incomplete existing contract without filling its missing date', async () => {
    const old = contract('old', { effectiveFrom: null });
    const { apply, stored } = fixture([old]);
    await expect(apply([old, { ...old, id: undefined, sequence: 1 }])).rejects.toMatchObject({
      response: { data: { fieldErrors: { 'contracts.1.name': expect.any(String) } } },
    });
    expect(stored[0].effectiveFrom).toBeNull();
  });

  it('rejects unknown new types but preserves an existing legacy type when correcting its name', async () => {
    const old = contract('old', { contractType: 'legacy-custom', signedAt: null, effectiveFrom: null });
    const { apply, stored } = fixture([old]);
    await expect(apply([old, { contractType: 'legacy-custom', sequence: 1 }])).rejects.toMatchObject({
      response: { data: { fieldErrors: { 'contracts.1.contractType': expect.any(String) } } },
    });
    await apply([{ ...old, name: 'Corrected legacy name' }]);
    expect(stored[0]).toMatchObject({ id: 'old', contractType: 'legacy-custom', signedAt: null, effectiveFrom: null });
  });

  it('rejects changing an existing contract into a different unknown type', async () => {
    const { apply } = fixture();
    await expect(apply([{ ...contract(), contractType: 'unknown-new-type' }])).rejects.toMatchObject({
      response: { data: { fieldErrors: { 'contracts.0.contractType': expect.any(String) } } },
    });
  });

  it('keeps the unknown-ID concurrency guard', async () => {
    const { apply, tx } = fixture();
    await expect(apply([{ ...contract(), id: 'stale-id' }])).rejects.toMatchObject({ response: { code: 4009 } });
    expect(tx.employeeContract.update).not.toHaveBeenCalled();
  });

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
