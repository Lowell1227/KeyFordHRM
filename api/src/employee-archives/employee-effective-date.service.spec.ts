import { EmployeeEffectiveDateService } from './employee-effective-date.service';

describe('EmployeeEffectiveDateService', () => {
  it.each(['batch', 'single'])('keeps the assignment snapshot after a catalog rename during %s refresh', async mode => {
    const employment = { id: 'employment', userId: 'u1', effectiveFrom: new Date('2026-01-01'), effectiveTo: null,
      deptId: 'd1', positionId: 'p1', position: 'Assigned position', entryDate: new Date('2026-01-01'),
      plannedRegularDate: null, actualRegularDate: null, leaveDate: null,
      employmentType: 'full_time', employeeStatus: 'active' };
    const user = { id: 'u1', accountType: 'employee', status: 'active', position: 'Stale projection' };
    const tx: any = {
      employeeDataChangeRequest: { findMany: async () => [], findFirst: async () => null },
      user: { findMany: async () => [user], findUnique: async () => user,
        update: jest.fn(async ({ data }) => Object.assign(user, data)) },
      employmentRecord: { findMany: async () => [employment] },
      position: { findMany: async () => [{ id: 'p1', name: 'Renamed catalog' }],
        findUnique: async () => ({ id: 'p1', name: 'Renamed catalog' }) },
    };
    const db = { ...tx, $transaction: async (run: any) => typeof run === 'function' ? run(tx) : Promise.all(run) };
    const service = new EmployeeEffectiveDateService(db as any);
    if (mode === 'batch') await service.refreshEffectiveProjections(new Date('2026-11-12'));
    else await service.refreshUserProjection('u1', new Date('2026-11-12'));
    expect(user).toMatchObject({ positionId: 'p1', position: 'Assigned position' });
    expect(employment.position).toBe('Assigned position');
  });

  it('projects the latest reviewed employment covering the effective date', async () => {
    const prisma = {
      employeeDataChangeRequest: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'u1' }]),
        findUnique: jest.fn().mockResolvedValue({ id: 'u1', status: 'active', accountType: 'employee' }),
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
            deptId: 'd2', positionId: 'p2', position: '历史店长名称', entryDate: new Date('2025-01-01'),
            plannedRegularDate: null, actualRegularDate: null, leaveDate: null,
            employmentType: 'full_time', employeeStatus: 'active',
          },
        ]),
      },
      $transaction: jest.fn(async (work: (tx: any) => Promise<unknown>) => work(prisma)),
    } as any;
    const service = new EmployeeEffectiveDateService(prisma);

    const result = await service.refreshEffectiveProjections(new Date('2026-09-01T00:00:00+08:00'));

    expect(result).toEqual({ checked: 1, updated: 1, overlaps: 1 });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1' },
      data: expect.objectContaining({ deptId: 'd2', positionId: 'p2', position: '历史店长名称' }),
    }));
  });

  it('does not change a user when no employment covers the date', async () => {
    const prisma = {
      employeeDataChangeRequest: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }]), update: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ id: 'u1', accountType: 'employee', status: 'active' }) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      employmentRecord: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (work: (tx: any) => Promise<unknown>) => work(prisma)),
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
      profileReviewStatus: 'approved', performanceReviewStatus: 'approved',
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

  it.each(['pending', 'rejected'])('activates approved employment without adopting %s performance relationship', async (status) => {
    const request = {
      id: 'r1', userId: 'u1', createdById: 'hr1', onboardingStatus: 'pending_entry',
      profileReviewStatus: 'approved', performanceReviewStatus: status,
      proposedValue: { performance: { managerId: 'unapproved-manager' } },
      validationWarnings: [], employeeNumbers: [],
      employmentRecords: [{ effectiveFrom: new Date('2026-09-26'), effectiveTo: null, employeeStatus: 'active', employeeNo: '358' }],
    };
    const state: Record<string, unknown> = {};
    const tx = {
      employeeDataChangeRequest: { findUnique: async () => request, update: async () => ({}) },
      employeeNumberAssignment: { updateMany: async () => ({ count: 0 }) },
      user: { update: async ({ data }: any) => Object.assign(state, data) },
      externalIdentityBinding: { findMany: async () => [] }, auditLog: { create: async () => ({}) },
    } as any;
    const result = await new EmployeeEffectiveDateService({} as any).activateApprovedOnboarding(tx, 'r1', new Date('2026-09-25T16:00:00Z'));
    expect(result.activated).toBe(true);
    expect(state.directManagerId).toBeNull();
  });

  it('does not activate an unapproved profile even with a leftover employment record', async () => {
    const tx = { employeeDataChangeRequest: { findUnique: async () => ({
      id: 'r1', userId: 'u1', onboardingStatus: 'submitted', profileReviewStatus: 'pending', performanceReviewStatus: 'approved',
      employmentRecords: [{ effectiveFrom: new Date('2026-09-01'), effectiveTo: null }], employeeNumbers: [],
    }) }, user: { update: jest.fn() } } as any;
    await expect(new EmployeeEffectiveDateService({} as any).activateApprovedOnboarding(tx, 'r1', new Date('2026-09-26')))
      .resolves.toEqual({ activated: false, historicalOnly: false });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('retries a serialization conflict with a fresh employment read instead of replaying a stale projection', async () => {
    const user: any = { id: 'u1', accountType: 'employee', status: 'probation' };
    const regularDate = new Date('2026-11-16T00:00:00.000Z');
    let regular = false;
    const tx: any = {
      employeeDataChangeRequest: { findFirst: jest.fn(async () => null) },
      user: { findUnique: jest.fn(async () => ({ ...user })), update: jest.fn(async ({ data }) => Object.assign(user, data)) },
      employmentRecord: { findMany: jest.fn(async () => [{ id: 'e1', effectiveFrom: new Date('2026-01-01'),
        effectiveTo: null, employeeStatus: regular ? 'active' : 'probation', actualRegularDate: regular ? regularDate : null }]) },
    };
    let attempts = 0;
    const prisma: any = { ...tx, $transaction: jest.fn(async (work) => {
      attempts += 1;
      const before = { ...user };
      const result = await work(tx);
      if (attempts === 1) {
        Object.assign(user, before); regular = true;
        throw Object.assign(new Error('serialization failure'), { code: 'P2034' });
      }
      return result;
    }) };
    await new EmployeeEffectiveDateService(prisma).refreshUserProjection('u1', regularDate);
    expect(user).toMatchObject({ status: 'active', actualRegularDate: regularDate });
    expect(attempts).toBe(2);
    expect(tx.employeeDataChangeRequest.findFirst).toHaveBeenCalledTimes(2);
  });

  it.each([
    { code: 'P2034' },
    { code: 'P2010', meta: { code: '40001' } },
    { code: 'P2010', meta: { code: '40P01' } },
  ])('bounds retries for transaction conflict %j without retrying unrelated failures', async details => {
    const conflict = Object.assign(new Error('serialization failure'), details);
    const prisma: any = { $transaction: jest.fn().mockRejectedValue(conflict) };
    await expect(new EmployeeEffectiveDateService(prisma).refreshUserProjection('u1')).rejects.toMatchObject({ status: 409 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    const other = new Error('database unavailable');
    prisma.$transaction.mockClear().mockRejectedValue(other);
    await expect(new EmployeeEffectiveDateService(prisma).refreshUserProjection('u1')).rejects.toBe(other);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['2026-10-08T15:59:59Z', 'active', false],
    ['2026-10-08T16:00:00Z', 'resigned', true],
  ])('refreshes ordinary resignation at the Shanghai boundary %s', async (now, expectedStatus, disabled) => {
    const state: any = { user: { id: 'u1', accountType: 'employee', status: 'active', position: '专员' }, disabled: false };
    const tx: any = {
      employeeDataChangeRequest: { findFirst: async () => null },
      user: { findUnique: async () => state.user, update: async ({ data }: any) => Object.assign(state.user, data) },
      employmentRecord: { findMany: async () => [
        { id: 'active', effectiveFrom: new Date('2020-01-01'), effectiveTo: new Date('2026-10-08'), employeeStatus: 'active' },
        { id: 'resigned', effectiveFrom: new Date('2026-10-09'), effectiveTo: null, employeeStatus: 'resigned', leaveDate: new Date('2026-10-08') },
      ] },
      externalIdentityBinding: { updateMany: async () => { state.disabled = true; return { count: 1 }; } },
    };
    const prisma: any = { ...tx, $transaction: async (callback: any) => callback(tx) };
    await new EmployeeEffectiveDateService(prisma).refreshUserProjection('u1', new Date(now));
    expect(state.user.status).toBe(expectedStatus);
    expect(state.disabled).toBe(disabled);
  });
});
