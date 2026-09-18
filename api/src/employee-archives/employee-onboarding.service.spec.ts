import { CompanyCode, EmploymentType, SysRole, UserStatus } from '@prisma/client';
import { EmployeeOnboardingService } from './employee-onboarding.service';

describe('EmployeeOnboardingService', () => {
  it('submits reentry for the same user and reserves a new number', async () => {
    const user = {
      id: 'u1', name: '历史员工', employeeNo: '126', status: UserStatus.resigned,
      archivedAt: new Date(), employmentHistory: [],
    };
    const created = {
      id: 'r1', userId: user.id, employeeName: user.name, employeeNo: null,
      intakeType: 'reentry', onboardingStatus: 'submitted', requestVersion: 1,
      recordStatus: 'submitted', proposedValue: {}, validationWarnings: [],
      createdAt: new Date(), updatedAt: new Date(),
    };
    const updated = { ...created, employeeNo: '358', proposedValue: { employee: { employeeNo: '358' } } };
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      employmentRecord: { findFirst: jest.fn().mockResolvedValue(null) },
      employeeDataChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
        update: jest.fn().mockResolvedValue(updated),
      },
      department: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', isActive: true }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as any;
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) } as any;
    const numberService = { reserveNext: jest.fn().mockResolvedValue('358') } as any;
    const identity = {} as any;
    const effective = {} as any;
    const service = new EmployeeOnboardingService(prisma, numberService, identity, effective);

    const result = await service.createReentry(user.id, {
      company: CompanyCode.fuede, deptId: 'd1', effectiveDate: new Date('2099-10-01'),
      employeeStatus: UserStatus.active, employmentType: EmploymentType.full_time,
      rosterManagerId: 'roster-manager', performanceManagerId: 'performance-manager',
    }, 'hr1');

    expect(result.userId).toBe(user.id);
    expect(result.employeeNo).toBe('358');
    expect(numberService.reserveNext).toHaveBeenCalledWith(tx, 'r1', 'u1');
    expect(tx.employeeDataChangeRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        proposedValue: expect.objectContaining({
          employee: expect.objectContaining({ managerId: 'roster-manager' }),
          performance: { managerId: 'performance-manager' },
        }),
      }),
    }));
    expect(tx.user.create).toBeUndefined();
  });

  it('resets elevated permissions when a future reentry is approved', async () => {
    const request = {
      id: 'r1', userId: 'u1', employeeNo: '358', intakeType: 'reentry', onboardingStatus: 'submitted',
      proposedValue: { employee: { company: 'fuede', deptId: 'd1', effectiveDate: '2099-10-01', employeeStatus: 'active', employmentType: 'full_time' } },
    };
    const tx = {
      employeeDataChangeRequest: { findUnique: jest.fn().mockResolvedValue(request), update: jest.fn() },
      employmentRecord: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue({}) },
      employeeNumberAssignment: { findFirst: jest.fn().mockResolvedValue({ id: 'n1', status: 'reserved' }) },
      auditLog: { create: jest.fn() },
    } as any;
    const service = new EmployeeOnboardingService({} as any, {} as any, {} as any, {} as any);
    await service.applyApprovedReentry(tx, 'r1', 'hr1', new Date('2026-09-18'));
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sysRole: SysRole.employee, hrCapabilities: { set: [] }, status: UserStatus.pending_entry }),
    }));
  });
});
