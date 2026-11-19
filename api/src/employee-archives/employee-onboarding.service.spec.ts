import { CompanyCode, EmploymentType, SysRole, UserStatus } from '@prisma/client';
import { EmployeeOnboardingService } from './employee-onboarding.service';
import { ConflictException, ValidationPipe } from '@nestjs/common';
import { ReviseEmployeeReentryDto } from './dto/employee-onboarding.dto';

describe('EmployeeOnboardingService', () => {
  it('rejects adding a source to an existing source-free reentry before changing the request', async () => {
    const tx: any = {
      $queryRaw: jest.fn(),
      talentCandidate: { findUnique: jest.fn().mockResolvedValue({ id: 'candidate', deletedAt: null, convertedUserId: null }) },
      employeeDataChangeRequest: {
        findUnique: jest.fn().mockResolvedValue({ id: 'r1', userId: 'u1', intakeType: 'reentry', onboardingStatus: 'pending_entry',
          profileReviewStatus: 'approved', performanceReviewStatus: 'rejected', talentCandidateId: null }),
        findFirst: jest.fn().mockResolvedValue(null), update: jest.fn(async ({ data }) => ({ id: 'r1', ...data })),
      },
      auditLog: { create: jest.fn() },
    };
    const service = new EmployeeOnboardingService({ $transaction: async (run: any) => run(tx) } as any, {} as any, {} as any, {} as any);
    await expect(service.reviseReentry('r1', { performanceOnly: true, talentCandidateId: 'candidate' } as any, 'hr1'))
      .rejects.toThrow('申请来源人才不能更换');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  describe('cancelling archived intake', () => {
    function cancellationSetup(archive: { archivedAt: Date | null; recordStatus: string }) {
      const request: any = {
        id: 'old-request', intakeType: 'new_hire', onboardingStatus: 'draft', requestVersion: 1,
        talentCandidateId: 'candidate', talentApplicationId: 'application', userId: null, ...archive,
      };
      // The application has already been reused by a new intake after the old one was archived.
      const application = { id: 'application', stage: 'onboarding', revision: 3 };
      const tx: any = {
        $queryRaw: jest.fn(),
        employeeDataChangeRequest: {
          findUnique: jest.fn().mockResolvedValue(request),
          update: jest.fn(async ({ data }) => ({ ...request, ...data })),
        },
        talentApplication: {
          findUnique: jest.fn(async () => ({ ...application })),
          updateMany: jest.fn(async ({ data }) => { application.stage = data.stage; return { count: 1 }; }),
        },
        talentApplicationEvent: { create: jest.fn() }, auditLog: { create: jest.fn() },
      };
      const numbers = { releaseReservation: jest.fn() };
      const service = new EmployeeOnboardingService({ $transaction: async (run: any) => run(tx) } as any, numbers as any, {} as any, {} as any);
      return { service, tx, numbers, application };
    }

    it.each([
      { archivedAt: new Date('2026-11-17'), recordStatus: 'draft' },
      { archivedAt: null, recordStatus: 'archived' },
    ])('rejects archived state %j without releasing numbers or rewinding the reused application', async archive => {
      const { service, tx, numbers, application } = cancellationSetup(archive);
      await expect(service.cancelReentry('old-request', { reason: 'Synthetic cancellation' }, 'hr1'))
        .rejects.toBeInstanceOf(ConflictException);
      expect(numbers.releaseReservation).not.toHaveBeenCalled();
      expect(tx.talentApplication.findUnique).not.toHaveBeenCalled();
      expect(tx.talentApplication.updateMany).not.toHaveBeenCalled();
      expect(tx.talentApplicationEvent.create).not.toHaveBeenCalled();
      expect(tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
      expect(application.stage).toBe('onboarding');
    });

    it('still cancels a live intake and records its application transition', async () => {
      const { service, tx, numbers, application } = cancellationSetup({ archivedAt: null, recordStatus: 'draft' });
      await service.cancelReentry('old-request', { reason: 'Synthetic cancellation' }, 'hr1');
      expect(numbers.releaseReservation).toHaveBeenCalledTimes(1);
      expect(application.stage).toBe('accepted');
      expect(tx.talentApplicationEvent.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: 'cancel_onboarding', fromStage: 'onboarding', toStage: 'accepted' }),
      }));
      expect(tx.employeeDataChangeRequest.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ recordStatus: 'cancelled', onboardingStatus: 'cancelled' }),
      }));
    });
  });

  it.each(['pending_entry', 'effective'])('resubmits rejected new-hire performance in %s without rewriting approved employment', async (onboardingStatus) => {
    const request: any = { id: 'r1', userId: 'u1', employeeNo: '358', intakeType: 'new_hire', onboardingStatus,
      profileReviewStatus: 'approved', performanceReviewStatus: 'rejected', profileReviewedById: 'hr-original',
      profileReviewedAt: new Date('2026-09-25'), rejectedReason: '请核对直属上级', requestVersion: 1,
      proposedValue: { employee: { name: '员工', effectiveFrom: '2099-10-01', deptId: 'd1' },
        profile: { gender: '女' }, contracts: [{ name: '劳动合同', attachments: ['retained'] }], performance: { managerId: 'old-manager' } },
    };
    const originalProfile = structuredClone(request.proposedValue);
    const tx: any = { employeeDataChangeRequest: { findUnique: async () => request, update: async ({ data }: any) => Object.assign(request, data) },
      user: { findUnique: async () => ({ id: 'new-manager' }), update: jest.fn(), updateMany: jest.fn() },
      employmentRecord: { deleteMany: jest.fn() }, auditLog: { create: async () => ({}) } };
    const service = new EmployeeOnboardingService({ $transaction: async (callback: any) => callback(tx) } as any, {} as any, {} as any, {} as any);
    const result = await service.reviseReentry('r1', { performanceOnly: true, performanceManagerId: 'new-manager' } as any, 'hr1');
    expect(request.proposedValue).toEqual({ ...originalProfile, performance: { managerId: 'new-manager' } });
    expect(request).toMatchObject({ id: 'r1', employeeNo: '358', profileReviewStatus: 'approved', profileReviewedById: 'hr-original', performanceReviewStatus: 'pending', onboardingStatus });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.employmentRecord.deleteMany).not.toHaveBeenCalled();
    expect((result as any).rejectedReason).toBeNull();
  });

  it('accepts the minimal performance-only HTTP payload but still validates the manager UUID', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const metadata: any = { type: 'body', metatype: ReviseEmployeeReentryDto };
    await expect(pipe.transform({ performanceOnly: true, performanceManagerId: '22222222-2222-4222-8222-222222222222' }, metadata)).resolves.toMatchObject({ performanceOnly: true });
    await expect(pipe.transform({ performanceOnly: true, performanceManagerId: 'bad-id' }, metadata)).rejects.toThrow();
  });
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

  it('allows reentry when the latest effective record is resigned even if an older active record still overlaps', async () => {
    const user = {
      id: 'u1', name: '历史员工', employeeNo: '126', status: UserStatus.resigned,
      archivedAt: null, employmentHistory: [],
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
      employmentRecord: {
        findFirst: jest.fn(async ({ where }: any) => (
          where.employeeStatus
            ? { id: 'older-active', employeeStatus: UserStatus.active, effectiveFrom: new Date('2026-09-14') }
            : { id: 'latest-resigned', employeeStatus: UserStatus.resigned, effectiveFrom: new Date('2026-09-16') }
        )),
      },
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
    const service = new EmployeeOnboardingService(prisma, numberService, {} as any, {} as any);

    await expect(service.createReentry(user.id, {
      company: CompanyCode.fuede, deptId: 'd1', effectiveDate: new Date('2026-09-17'),
      employeeStatus: UserStatus.probation, employmentType: EmploymentType.full_time,
    }, 'hr1')).resolves.toEqual(expect.objectContaining({ employeeNo: '358' }));

    expect(tx.employmentRecord.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { effectiveFrom: 'desc' },
      select: { id: true, employeeStatus: true },
    }));
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
