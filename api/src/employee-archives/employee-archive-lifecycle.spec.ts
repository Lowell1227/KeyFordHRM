import { EmployeeArchivesService } from './employee-archives.service';
import { SysRole } from '@prisma/client';

const operator = { id: 'hr', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true };

describe('employee draft and archive lifecycle', () => {
  it('keeps a previously saved sensitive replacement when a resumed draft sends a blank input', async () => {
    const user = { id: 'u', name: '员工', employeeNo: '1', status: 'active', directManagerId: null,
      employeeProfile: { idNumberEncrypted: 'old-cipher', idNumberFingerprint: 'old-hash' },
      employmentHistory: [], employeeContracts: [] };
    const existing = { id: 'd', userId: 'u', requestVersion: 1, recordStatus: 'draft', profileReviewStatus: 'pending',
      proposedValue: { profile: { idNumberEncrypted: 'new-cipher', idNumberFingerprint: 'new-hash' } } };
    const update = jest.fn(async ({ data }) => ({ ...existing, ...data }));
    const db = { user: { findUnique: jest.fn().mockResolvedValue(user) },
      employeeDataChangeRequest: { findFirst: jest.fn().mockResolvedValue(existing), update },
      auditLog: { create: jest.fn() } };
    const result = await new EmployeeArchivesService(db as any).saveArchiveDraft('u', {
      draftId: 'd', employee: { name: '员工更名' }, profile: { idNumber: '' },
    }, operator);
    expect(update.mock.calls[0][0].data.proposedValue.profile.idNumberFingerprint).toBe('new-hash');
    expect(result.proposedValue).not.toHaveProperty('profile.idNumberFingerprint');
  });

  it('restores only archive markers, never employment status, number or binding permissions', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = { user: { updateMany }, auditLog: { create: jest.fn() } };
    const db = { $transaction: (run: any) => run(tx) };
    const result = await new EmployeeArchivesService(db as any).restoreRecords(['u'], operator, 'employee');
    expect(result).toMatchObject({ restored: 1, failed: [] });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'u', deletedAt: null, archivedAt: { not: null } }, data: { archivedAt: null } });
  });

  it('reports mixed batch restoration separately without losing successful items', async () => {
    const updateMany = jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const tx = { employeeDataChangeRequest: { updateMany }, auditLog: { create: jest.fn() } };
    const db = { $transaction: (run: any) => run(tx) };
    const result = await new EmployeeArchivesService(db as any).restoreRecords(['d1', 'd2'], operator, 'draft');
    expect(result).toMatchObject({ restored: 1, succeeded: [{ id: 'd1' }], failed: [{ id: 'd2' }] });
    expect(updateMany.mock.calls[0][0].data).toEqual({ archivedAt: null, recordStatus: 'draft' });
  });
});
