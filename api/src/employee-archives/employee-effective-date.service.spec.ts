import { EmployeeEffectiveDateService } from './employee-effective-date.service';

describe('EmployeeEffectiveDateService', () => {
  it('projects the latest reviewed employment covering the effective date', async () => {
    const prisma = {
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
});
