import { terminateEmploymentPerformance } from './lifecycle-employment';

describe('effective offboarding is limited to the matching employment', () => {
  it('never searches by reviewer or cleans unbound/historical records', async () => {
    const tx: any = {
      employmentRecord: { findUnique: jest.fn().mockResolvedValue({ id: 'departing', userId: 'employee', entryDate: new Date('2026-01-01'), employeeNo: 'fictional-1' }),
        findMany: jest.fn().mockResolvedValue([{ id: 'departing' }, { id: 'same-spell' }]) },
      assessmentTask: { findMany: jest.fn().mockResolvedValue([]) },
      improvementPlan: { findMany: jest.fn().mockResolvedValue([]) },
      confirmationApplication: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await terminateEmploymentPerformance(tx, 'employee', 'departing', new Date(), 'hr');
    for (const table of ['assessmentTask', 'improvementPlan', 'confirmationApplication']) {
      expect(tx[table].findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
        employeeId: 'employee', employmentRecordId: { in: ['departing', 'same-spell'] }, lifecycleStatus: 'active',
      } }));
    }
    expect(JSON.stringify(tx.assessmentTask.findMany.mock.calls)).not.toContain('managerId');
  });
  it('refuses an unrelated departing employment', async () => {
    const tx: any = { employmentRecord: { findUnique: jest.fn().mockResolvedValue({ id: 'other', userId: 'other' }) } };
    await expect(terminateEmploymentPerformance(tx, 'employee', 'other', new Date(), 'hr')).rejects.toThrow();
  });
});
