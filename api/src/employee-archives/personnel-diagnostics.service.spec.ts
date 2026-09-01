import { PersonnelDiagnosticsService } from './personnel-diagnostics.service';

describe('PersonnelDiagnosticsService', () => {
  it('reports non-blocking identity, organization, employment and login risks', async () => {
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([
        {
          id: 'u1', name: '甲', employeeNo: '001', phone: '13800000000', deptId: null,
          positionId: null, position: null, directManagerId: null, status: 'resigned',
          employeeProfile: { idNumberFingerprint: 'same-id' },
          employmentHistory: [
            { id: 'e1', effectiveFrom: new Date('2026-01-01'), effectiveTo: null },
            { id: 'e2', effectiveFrom: new Date('2026-06-01'), effectiveTo: null },
          ],
          employeeContracts: [
            { id: 'c1', isActive: true, effectiveFrom: new Date('2026-01-01'), expiresAt: null },
            { id: 'c2', isActive: true, effectiveFrom: new Date('2026-06-01'), expiresAt: null },
          ],
          externalIdentityBindings: [{ id: 'b1', status: 'enabled' }],
        },
        {
          id: 'u2', name: '乙', employeeNo: '001', phone: '13800000000', deptId: 'd1',
          positionId: 'p1', position: '未知岗位', directManagerId: null, status: 'active',
          employeeProfile: { idNumberFingerprint: 'same-id' }, employmentHistory: [],
          employeeContracts: [], externalIdentityBindings: [],
        },
      ]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const service = new PersonnelDiagnosticsService(prisma);

    const result = await service.inspect();

    expect(result.items.map((item) => item.code)).toEqual(expect.arrayContaining([
      'duplicate_employee_no', 'duplicate_phone', 'duplicate_identity', 'missing_department',
      'missing_position', 'missing_roster_manager', 'employment_overlap', 'contract_overlap',
      'resigned_login_enabled',
    ]));
    expect(result.blocking).toBe(false);
  });
});
