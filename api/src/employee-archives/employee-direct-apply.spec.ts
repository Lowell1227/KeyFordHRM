import { SysRole, UserStatus, CompanyCode, EmploymentType } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { EmployeeArchivesService } from './employee-archives.service';

describe('员工档案免审个人信息字段直改', () => {
  const operator = {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'HR',
    sysRole: SysRole.hr,
    deptId: null,
    isAssessorOnly: false,
    canViewAll: true,
  };

  const buildUser = (profile: Record<string, unknown> | null = {
    id: 'profile-1',
    userId: '10000000-0000-4000-8000-000000000001',
    phone: '13800000000',
    gender: '男',
    birthDate: new Date('1990-01-01T00:00:00.000Z'),
    ethnicity: null,
    education: '本科',
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
  }) => ({
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
    employeeProfile: profile,
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

  const buildService = (user: Record<string, unknown>, pendingRequests: Array<{ id: string; baseValue: unknown }> = []) => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
        update: jest.fn().mockResolvedValue({}),
      },
      employeeDataChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue(pendingRequests),
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
    };
    const service = new EmployeeArchivesService(prisma as any);
    const baseVersion = (service as any).archiveVersion(user);
    return { service, tx, baseVersion };
  };

  it('只改手机号等免审字段时不生成审核单，直接写入正式档案并记审计日志', async () => {
    const user = buildUser();
    const { service, tx, baseVersion } = buildService(user);

    const result = await service.submitDraft(user.id, {
      baseVersion,
      employee: { phone: '13911112222' },
      profile: { phone: '13911112222', education: '硕士' },
    }, operator);

    expect(result.request).toBeNull();
    expect(result.directApplied).toEqual(['手机号', '学历']);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: user.id }, data: { phone: '13911112222' } });
    expect(tx.employeeProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: user.id },
      update: { phone: '13911112222', education: '硕士' },
    }));
    expect(tx.employeeDataChangeRequest.create).not.toHaveBeenCalled();
    expect(tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: operator.id,
        action: 'employee_profile_direct_update',
        entityType: 'user',
        entityId: user.id,
        oldValue: expect.objectContaining({ phone: '138****0000', education: '本科' }),
        newValue: expect.objectContaining({ phone: '139****2222', education: '硕士' }),
      }),
    }));
  });

  it('出生日期等日期字段以字符串提交也能识别为直改变更', async () => {
    const user = buildUser();
    const { service, tx, baseVersion } = buildService(user);

    const result = await service.submitDraft(user.id, {
      baseVersion,
      employee: {},
      profile: { birthDate: '1991-05-05' },
    }, operator);

    expect(result.request).toBeNull();
    expect(result.directApplied).toEqual(['出生日期']);
    const upsert = tx.employeeProfile.upsert.mock.calls[0][0] as { update: Record<string, unknown> };
    expect(upsert.update.birthDate).toBeInstanceOf(Date);
    expect((upsert.update.birthDate as Date).toISOString().slice(0, 10)).toBe('1991-05-05');
  });

  it('带空格的手机号按审核生效路径同样规则归一化，与现值一致时按“无实际变更”拒绝', async () => {
    const user = buildUser();
    const { service, tx, baseVersion } = buildService(user);

    await expect(service.submitDraft(user.id, {
      baseVersion,
      employee: { phone: ' 13800000000 ' },
      profile: { phone: ' 13800000000 ' },
    }, operator)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.employeeProfile.upsert).not.toHaveBeenCalled();
    expect(tx.employeeDataChangeRequest.create).not.toHaveBeenCalled();
  });

  it('非法出生日期在提交入口直接拒绝，不写入正式档案', async () => {
    const user = buildUser();
    const { service, tx, baseVersion } = buildService(user);

    await expect(service.submitDraft(user.id, {
      baseVersion,
      employee: {},
      profile: { birthDate: 'invalid-date' },
    }, operator)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.employeeProfile.upsert).not.toHaveBeenCalled();
    expect(tx.employeeDataChangeRequest.create).not.toHaveBeenCalled();
  });

  it('混合提交时免审字段直改，审核字段照常生成审核单且不含免审字段差异', async () => {
    const user = buildUser();
    const { service, tx, baseVersion } = buildService(user);

    const result = await service.submitDraft(user.id, {
      baseVersion,
      employee: { name: '员工乙', phone: '13911112222' },
      profile: { phone: '13911112222' },
    }, operator);

    expect(result.directApplied).toEqual(['手机号']);
    expect(result.request).not.toBeNull();
    expect(tx.employeeProfile.upsert).toHaveBeenCalled();
    expect(tx.employeeDataChangeRequest.create).toHaveBeenCalledTimes(1);
    const createData = tx.employeeDataChangeRequest.create.mock.calls[0][0].data as Record<string, any>;
    expect(createData.proposedValue.employee.name).toBe('员工乙');
    // 手机号已直改生效，审核单内不再包含手机号差异（base 与 proposed 一致）
    expect(createData.baseValue.employee.phone).toBe('13911112222');
    expect(createData.proposedValue.employee.phone).toBe('13911112222');
    expect(createData.profileReviewStatus).toBe('pending');
  });

  it('免审更新同时刷新待审单未修改字段的基准和提案，并保留修订版本', async () => {
    const user = buildUser();
    const pending = [{
      id: 'pending-1',
      baseValue: {
        employee: { name: '员工甲', phone: '13800000000' },
        profile: { phone: '13800000000', gender: '男' },
      },
      proposedValue: { employee: { name: '员工乙', phone: '13800000000' }, profile: { phone: '13800000000', gender: '男' } },
      requestVersion: 1,
      recordStatus: 'submitted',
      updatedAt: new Date('2026-01-01'),
    }];
    const { service, tx, baseVersion } = buildService(user, pending);

    const result = await service.submitDraft(user.id, {
      baseVersion,
      employee: { phone: '13911112222' },
      profile: { phone: '13911112222' },
    }, operator);

    expect(result.request).toBeNull();
    expect(tx.employeeDataChangeRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'pending-1', requestVersion: 1 }),
      data: expect.objectContaining({
        baseValue: expect.objectContaining({
          employee: expect.objectContaining({ name: '员工甲', phone: '13911112222' }),
          profile: expect.objectContaining({ phone: '13911112222', gender: '男' }),
        }),
        proposedValue: expect.objectContaining({ employee: expect.objectContaining({ name: '员工乙', phone: '13911112222' }) }),
        requestVersion: { increment: 1 },
        revisionHistory: expect.any(Array),
      }),
    }));
  });

  it.each(['2026-02-31', '2026-13-01', '02/01/2026'])('拒绝无效或含糊的日历日期 %s', async birthDate => {
    const user = buildUser();
    const { service, tx, baseVersion } = buildService(user);
    await expect(service.submitDraft(user.id, { baseVersion, employee: {}, profile: { birthDate } }, operator))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(tx.employeeProfile.upsert).not.toHaveBeenCalled();
  });

  it('已自动保存的纯免审草稿可提交，并归档已完成的草稿', async () => {
    const user = buildUser();
    const { service, tx } = buildService(user);
    const existing = {
      id: 'draft-1', requestVersion: 1, recordStatus: 'draft', updatedAt: new Date(),
      profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
      baseValue: { employee: { name: user.name, phone: user.phone }, profile: (service as any).profileReviewData(user.employeeProfile),
        profileExists: true, contracts: [], performance: { managerId: null } },
      proposedValue: {},
    };
    tx.employeeDataChangeRequest.findFirst.mockResolvedValue(existing as any);
    const result = await service.submitDraft(user.id, {
      draftId: existing.id, expectedVersion: 1, employee: {}, profile: { education: '硕士' },
    }, operator);
    expect(result.request).toBeNull();
    expect(result.directApplied).toEqual(['学历']);
    expect(tx.employeeDataChangeRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ archivedAt: expect.any(Date), recordStatus: 'submitted' }),
    }));
  });

  it('另一待审单明确修改同一字段时阻止免审更新，不静默覆盖其提案', async () => {
    const user = buildUser();
    const { service, baseVersion } = buildService(user, [{
      id: 'pending-conflict', baseValue: { profile: { education: '本科' } },
      proposedValue: { profile: { education: '博士' } },
    } as any]);
    await expect(service.submitDraft(user.id, { baseVersion, employee: {}, profile: { education: '硕士' } }, operator))
      .rejects.toMatchObject({ status: 409 });
  });

  it('社保状态等中间档字段不直改，仍走审核', async () => {
    const user = buildUser();
    const { service, tx, baseVersion } = buildService(user);

    const result = await service.submitDraft(user.id, {
      baseVersion,
      employee: {},
      profile: { socialSecurityStatus: '已缴纳' },
    }, operator);

    expect(result.directApplied).toEqual([]);
    expect(result.request).not.toBeNull();
    expect(tx.employeeProfile.upsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.employeeDataChangeRequest.create).toHaveBeenCalledTimes(1);
  });

  it('完全没有实际变更时维持原有拒绝行为', async () => {
    const user = buildUser();
    const { service, baseVersion } = buildService(user);

    await expect(service.submitDraft(user.id, {
      baseVersion,
      employee: {},
      profile: { phone: '13800000000', education: '本科' },
    }, operator)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('保存草稿时与当前档案一致的输入视为幂等空保存，返回空且不写草稿、不记审计', async () => {
    const user = buildUser();
    const { service, tx, baseVersion } = buildService(user);

    const result = await service.saveArchiveDraft(user.id, {
      baseVersion,
      employee: { jobFamily: '' },
      profile: { phone: '13800000000', education: '本科' },
    }, operator);

    expect(result).toBeNull();
    expect(tx.employeeDataChangeRequest.create).not.toHaveBeenCalled();
    expect(tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('将已有草稿改回正式原值时覆盖旧提案并递增版本，不提交审核或改写正式资料', async () => {
    const user = buildUser();
    const profileRow = user.employeeProfile as Record<string, unknown>;
    const baseProfile = Object.fromEntries(Object.entries(profileRow)
      .filter(([key]) => !['id', 'userId', 'createdAt', 'updatedAt'].includes(key)));
    const existingDraft = {
      id: 'draft-1',
      userId: user.id,
      sourceType: 'manual_archive_change',
      recordStatus: 'draft',
      profileReviewStatus: 'pending',
      performanceReviewStatus: 'not_required',
      requestVersion: 3,
      baseValue: {
        employee: { name: '员工甲', phone: '13800000000' },
        profile: baseProfile,
        profileExists: true,
        contracts: [],
        performance: { managerId: null },
      },
      proposedValue: { employee: { name: '曾暂存的修改' }, profile: {}, contracts: [], performance: { managerId: null } },
      createdBy: { id: operator.id, name: operator.name, sysRole: operator.sysRole },
      createdAt: new Date('2026-11-11T01:00:00.000Z'),
      updatedAt: new Date('2026-11-11T01:00:00.000Z'),
      archivedAt: null,
    };
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue(user), update: jest.fn().mockResolvedValue({}) },
      employeeDataChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(existingDraft),
        create: jest.fn(),
        update: jest.fn(async ({ data }) => {
          const version = existingDraft.requestVersion;
          Object.assign(existingDraft, data, { requestVersion: version + data.requestVersion.increment });
          return existingDraft;
        }),
      },
      employeeProfile: { upsert: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((run: (client: unknown) => unknown) => run(tx)) };
    const service = new EmployeeArchivesService(prisma as any);
    const baseVersion = (service as any).archiveVersion(user);

    const result = await service.saveArchiveDraft(user.id, {
      draftId: 'draft-1',
      expectedVersion: 3,
      baseVersion,
      employee: { jobFamily: '' },
      profile: { phone: '13800000000', education: '本科' },
    }, operator);

    expect(result).not.toBeNull();
    expect(result).toMatchObject({ id: 'draft-1', requestVersion: 4, recordStatus: 'draft',
      profileReviewStatus: 'not_required', performanceReviewStatus: 'not_required',
      proposedValue: { employee: { name: '员工甲' }, profile: { education: '本科' } } });
    expect(existingDraft.proposedValue.employee.name).toBe('员工甲');
    expect(tx.employeeDataChangeRequest.create).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.employeeProfile.upsert).not.toHaveBeenCalled();
  });
});
