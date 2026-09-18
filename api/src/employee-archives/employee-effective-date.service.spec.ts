import { EmployeeEffectiveDateService } from './employee-effective-date.service';

describe('EmployeeEffectiveDateService', () => {
  it('projects the latest reviewed employment covering the effective date', async () => {
    const prisma = {
      employeeDataChangeRequest: { findMany: jest.fn().mockResolvedValue([]) },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'u1' }]),
        update: jest.fn().mockResolvedValue({ id: 'u1' }),
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ id: 'p2', name: '店长' }]),
      },
      employmentRecord: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'old', userId: 'u1', effectiveFrom: new Date('2026-01-01'), effectiveTo: null,
            deptId: 'd1', positionId: 'p1', position: '店员', entryDate: new Date('2025-01-01'),
            plannedRegularDate: null, actualRegularDate: null, leaveDate: null,
            employmentType: 'full_time', employeeStatus: 'active',
          },
          {
            id: 'new', userId: 'u1', effectiveFrom: new Date('2026-09-01'), effectiveTo: null,
            deptId: 'd2', positionId: 'p2', position: null, entryDate: new Date('2025-01-01'),
            plannedRegularDate: null, actualRegularDate: null, leaveDate: null,
            employmentType: 'full_time', employeeStatus: 'active',
          },
        ]),
      },
      $transaction: jest.fn(async (actions: unknown[]) => Promise.all(actions)),
    } as any;
    const service = new EmployeeEffectiveDateService(prisma);

    const result = await service.refreshEffectiveProjections(new Date('2026-09-01T00:00:00+08:00'));

    expect(result).toEqual({ checked: 1, updated: 1, overlaps: 1 });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1' },
      data: expect.objectContaining({ deptId: 'd2', positionId: 'p2', position: '店长' }),
    }));
  });

  it('does not change a user when no employment covers the date', async () => {
    const prisma = {
      employeeDataChangeRequest: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }]), update: jest.fn() },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      employmentRecord: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    } as any;
    const service = new EmployeeEffectiveDateService(prisma);

    const result = await service.refreshEffectiveProjections(new Date('2026-09-01'));

    expect(result).toEqual({ checked: 1, updated: 0, overlaps: 0 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('keeps the roster manager on employment and applies the separate performance manager to the user', async () => {
    const employment = {
      id: 'employment-1', userId: 'u1', employeeNo: '358',
      effectiveFrom: new Date('2026-09-18'), effectiveTo: null,
      deptId: 'd1', positionId: null, position: '店员',
      entryDate: new Date('2026-09-18'), plannedRegularDate: null, actualRegularDate: null,
      leaveDate: null, employmentType: 'full_time', employeeStatus: 'active',
      directManagerId: 'roster-manager',
    };
    const request = {
      id: 'request-1', userId: 'u1', createdById: 'hr1', onboardingStatus: 'pending_entry',
      proposedValue: { performance: { managerId: 'performance-manager' } },
      validationWarnings: [], employmentRecords: [employment],
      employeeNumbers: [{ id: 'number-1', employeeNo: '358', status: 'reserved' }],
    };
    const tx = {
      employeeDataChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        update: jest.fn().mockResolvedValue({}),
      },
      employeeNumberAssignment: { updateMany: jest.fn(), update: jest.fn() },
      user: { update: jest.fn().mockResolvedValue({}) },
      externalIdentityBinding: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), update: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as any;
    const service = new EmployeeEffectiveDateService({} as any);

    const result = await service.activateApprovedOnboarding(tx, request.id, new Date('2026-09-18T09:00:00+08:00'));

    expect(result).toEqual({ activated: true, historicalOnly: false });
    expect(employment.directManagerId).toBe('roster-manager');
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1' },
      data: expect.objectContaining({ directManagerId: 'performance-manager', employeeNo: '358' }),
    }));
  });
});
