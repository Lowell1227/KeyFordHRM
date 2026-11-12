import { SysRole, UserStatus, CompanyCode, EmploymentType } from '@prisma/client';
import { EmployeeArchivesService } from './employee-archives.service';

describe('宽松模式：档案提交后自动审核通过', () => {
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
    const reviews = { approveBatch: approveBatchImpl ?? jest.fn().mockResolvedValue({ succeeded: [{ requestId: 'request-1' }], failed: [] }) };
    const personnelConfig = { getReviewMode: jest.fn().mockResolvedValue(mode) };
    const service = new EmployeeArchivesService(
      prisma as any,
      undefined,
      undefined,
      undefined,
      undefined,
      reviews as any,
      personnelConfig as any,
    );
    const baseVersion = (service as any).archiveVersion(user);
    return { service, tx, prisma, reviews, personnelConfig, baseVersion };
  };

  it('宽松模式下需审核字段的提交在事务提交后自动审核通过（带 autoApproved 标记）', async () => {
    const user = buildUser();
    const { service, reviews, personnelConfig, baseVersion } = buildService(user, 'relaxed');

    const result = await service.submitDraft(user.id, {
      baseVersion,
      employee: { name: '员工乙' },
      profile: {},
    }, operator);

    expect(result.request).not.toBeNull();
    expect(result.reviewOutcome).toBe('approved');
    expect(personnelConfig.getReviewMode).toHaveBeenCalled();
    expect(reviews.approveBatch).toHaveBeenCalledWith(
      { requestIds: [result.request!.id], scopes: ['profile', 'performance'] },
      operator,
      { autoApproved: true },
    );
  });

  it('标准模式或不具备服务依赖时不自动审核', async () => {
    const user = buildUser();
    const { service, reviews, baseVersion } = buildService(user, 'standard');

    const result = await service.submitDraft(user.id, {
      baseVersion,
      employee: { name: '员工乙' },
      profile: {},
    }, operator);

    expect(result.request).not.toBeNull();
    expect(reviews.approveBatch).not.toHaveBeenCalled();
  });

  it('宽松模式下自动审核失败不阻断提交结果，并记录失败留痕', async () => {
    const user = buildUser();
    const failingApprove = jest.fn().mockRejectedValue(new Error('审批人范围异常'));
    const { service, prisma, reviews, baseVersion } = buildService(user, 'relaxed', failingApprove);

    const result = await service.submitDraft(user.id, {
      baseVersion,
      employee: { name: '员工乙' },
      profile: {},
    }, operator);

    expect(result.request).not.toBeNull();
    expect(reviews.approveBatch).toHaveBeenCalled();
    expect((prisma.auditLog.create as jest.Mock).mock.calls.some((call) => {
      return (call[0] as { data: { action: string } }).data.action === 'auto_approve_employee_data_change_failed';
    })).toBe(true);
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

  it('审批失败列表必须返回待人工审核，不能报已生效', async () => {
    const user = buildUser();
    const { service, baseVersion } = buildService(user, 'relaxed', jest.fn().mockResolvedValue({
      succeeded: [], failed: [{ requestId: 'request-1', reason: '正式档案已变化' }],
    }));
    const result = await service.submitDraft(user.id, { baseVersion, employee: { name: '员工乙' }, profile: {} }, operator);
    expect(result).toMatchObject({ reviewOutcome: 'pending' });
  });

  it('仅自动审核调用方明确提交的部分', async () => {
    const { service, reviews } = buildService(buildUser(), 'relaxed');
    await service.autoApproveRelaxed(['request-1'], operator, ['performance']);
    expect(reviews.approveBatch).toHaveBeenLastCalledWith(
      { requestIds: ['request-1'], scopes: ['performance'] }, operator, { autoApproved: true },
    );
    await service.autoApproveRelaxed(['request-1'], operator, ['profile']);
    expect(reviews.approveBatch).toHaveBeenLastCalledWith(
      { requestIds: ['request-1'], scopes: ['profile'] }, operator, { autoApproved: true },
    );
  });
});
