import { SysRole, UserStatus, CompanyCode, EmploymentType } from '@prisma/client';
import { EmployeeArchivesService } from './employee-archives.service';

describe('档案提交生效不依赖历史宽松配置或全局自动审核', () => {
  const operator = {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'HR',
    sysRole: SysRole.hr,
    deptId: null,
    isAssessorOnly: false,
    canViewAll: true,
  };

  const buildUser = () => ({
    id: '10000000-0000-4000-8000-000000000001',
    employeeNo: '001',
    name: '员工甲',
    phone: '13800000000',
    deptId: '30000000-0000-4000-8000-000000000001',
    position: '专员',
    entryDate: new Date('2024-01-01T00:00:00.000Z'),
    plannedRegularDate: null,
    actualRegularDate: null,
    leaveDate: null,
    employmentType: EmploymentType.full_time,
    status: UserStatus.active,
    directManagerId: null,
    deletedAt: null,
    employeeProfile: {
      id: 'profile-1',
      userId: '10000000-0000-4000-8000-000000000001',
      phone: '13800000000',
      gender: null,
      birthDate: null,
      ethnicity: null,
      education: null,
      professionalTitle: null,
      school: null,
      graduationDate: null,
      major: null,
      maritalStatus: null,
      childrenStatus: null,
      childrenCount: null,
      politicalStatus: null,
      nativePlace: null,
      householdType: null,
      idAddress: null,
      idNumberEncrypted: null,
      idNumberFingerprint: null,
      currentAddress: null,
      emergencyContactName: null,
      emergencyContactRelation: null,
      emergencyContactPhone: null,
      socialSecurityStatus: null,
      socialSecurityStartDate: null,
      housingFundStatus: null,
      housingFundStartDate: null,
      bankName: null,
      bankBranch: null,
      bankAccountEncrypted: null,
      bankAccountFingerprint: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    employmentHistory: [{
      company: CompanyCode.fuede,
      companyText: null,
      contractSubjectId: null,
      deptId: '30000000-0000-4000-8000-000000000001',
      position: '专员',
      positionId: null,
      jobGrade: null,
      jobFamily: null,
      directManagerId: null,
      workLocation: null,
      probationMonths: null,
    }],
    employeeContracts: [],
  });

  const buildService = (
    user: Record<string, unknown>,
    mode: 'relaxed' | 'standard',
    approveBatchImpl?: jest.Mock,
  ) => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
        update: jest.fn().mockResolvedValue({}),
      },
      employeeDataChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'request-1', ...data })),
        update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'request-1', ...data })),
      },
      employeeProfile: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn((run: (client: unknown) => unknown) => run(tx)),
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const reviews = {
      approveBatch: approveBatchImpl ?? jest.fn().mockResolvedValue({ succeeded: [{ requestId: 'request-1' }], failed: [] }),
      // Proposal tests stay isolated; real apply/rollback is covered in employee-archive-submit-apply.spec.
      applyArchiveChange: jest.fn(async () => ({ id: 'request-1', ...tx.employeeDataChangeRequest.create.mock.calls.at(-1)![0].data,
        profileReviewStatus: 'approved', appliedAt: new Date() })),
    };
    const personnelConfig = { getReviewMode: jest.fn().mockResolvedValue(mode) };
    const service = new EmployeeArchivesService(
      prisma as any,
      undefined,
      undefined,
      undefined,
      undefined,
      reviews as any,
    );
    const baseVersion = (service as any).archiveVersion(user);
    return { service, tx, prisma, reviews, personnelConfig, baseVersion };
  };

  it('历史宽松配置不影响档案提交立即生效', async () => {
    const user = buildUser();
    const { service, reviews, personnelConfig, baseVersion } = buildService(user, 'relaxed');

    const result = await service.submitDraft(user.id, {
      baseVersion,
      employee: { name: '员工乙' },
      profile: {},
    }, operator);

    expect(result.request).not.toBeNull();
    expect(result.reviewOutcome).toBe('not_required');
    expect(reviews.applyArchiveChange).toHaveBeenCalledTimes(1);
    expect(personnelConfig.getReviewMode).not.toHaveBeenCalled();
    expect(reviews.approveBatch).not.toHaveBeenCalled();
  });

  it('标准配置同样使用限定档案生效入口，不调用全局审批', async () => {
    const user = buildUser();
    const { service, reviews, baseVersion } = buildService(user, 'standard');

    const result = await service.submitDraft(user.id, {
      baseVersion,
      employee: { name: '员工乙' },
      profile: {},
    }, operator);

    expect(result.request).not.toBeNull();
    expect(reviews.applyArchiveChange).toHaveBeenCalledTimes(1);
    expect(reviews.approveBatch).not.toHaveBeenCalled();
  });

  it('不调用自动审核或创建新的自动审核失败审计', async () => {
    const user = buildUser();
    const failingApprove = jest.fn().mockRejectedValue(new Error('审批人范围异常'));
    const { service, prisma, reviews, baseVersion } = buildService(user, 'relaxed', failingApprove);

    const result = await service.submitDraft(user.id, {
      baseVersion,
      employee: { name: '员工乙' },
      profile: {},
    }, operator);

    expect(result.request).not.toBeNull();
    expect(reviews.approveBatch).not.toHaveBeenCalled();
    expect((prisma.auditLog.create as jest.Mock).mock.calls.some((call) => {
      return (call[0] as { data: { action: string } }).data.action === 'auto_approve_employee_data_change_failed';
    })).toBe(false);
  });

  it('宽松模式下仅免审字段直改时无审核单，不触发自动审核', async () => {
    const user = buildUser();
    const { service, reviews, baseVersion } = buildService(user, 'relaxed');

    const result = await service.submitDraft(user.id, {
      baseVersion,
      employee: {},
      profile: { phone: '13911112222' },
    }, operator);

    expect(result.request).toBeNull();
    expect(result.directApplied).toEqual(['手机号']);
    expect(reviews.approveBatch).not.toHaveBeenCalled();
  });

  it('旧全局审批失败配置不参与档案提交生效', async () => {
    const user = buildUser();
    const { service, reviews, baseVersion } = buildService(user, 'relaxed', jest.fn().mockResolvedValue({
      succeeded: [], failed: [{ requestId: 'request-1', reason: '正式档案已变化' }],
    }));
    const result = await service.submitDraft(user.id, { baseVersion, employee: { name: '员工乙' }, profile: {} }, operator);
    expect(result).toMatchObject({ reviewOutcome: 'not_required' });
    expect(reviews.approveBatch).not.toHaveBeenCalled();
    expect(reviews.applyArchiveChange).toHaveBeenCalledTimes(1);
  });

  it('移除自动审核入口', () => {
    const { service } = buildService(buildUser(), 'relaxed');
    expect((service as any).autoApproveRelaxed).toBeUndefined();
  });
});
