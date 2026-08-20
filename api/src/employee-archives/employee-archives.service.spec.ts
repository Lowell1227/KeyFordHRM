import { CompanyCode, EmploymentType, SysRole, UserStatus } from '@prisma/client';
import { EmployeeArchivesService } from './employee-archives.service';

describe('EmployeeArchivesService', () => {
  it('员工档案的当前所属公司来自有效任职记录而不是部门元数据', async () => {
    const archive = {
      id: 'user-1',
      name: '员工甲',
      dept: { id: 'dept-1', name: '项目一部', fullPath: '项目中心 / 项目一部', company: CompanyCode.fuede },
      directManager: null,
      employeeProfile: null,
      employmentHistory: [{
        id: 'employment-current',
        company: CompanyCode.beijing_fuede,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
        dept: { id: 'dept-1', name: '项目一部', fullPath: '项目中心 / 项目一部' },
        directManager: null,
      }],
      externalIdentityBindings: [],
      employeeContracts: [],
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(archive) },
    };
    const service = new EmployeeArchivesService(prisma as any);

    const result = await service.findOne('user-1');

    expect(result.currentEmployment).toEqual(expect.objectContaining({
      id: 'employment-current',
      company: CompanyCode.beijing_fuede,
    }));
  });

  it('updates the single profile owned by an existing employee instead of creating a second employee record', async () => {
    const user = {
      id: '10000000-0000-4000-8000-000000000001',
      employeeNo: '001',
      name: '李宏',
      phone: '18600000000',
      email: null,
      avatarUrl: null,
      deletedAt: null,
    };
    const profiles = new Map<string, Record<string, unknown>>();
    const tx = {
      employeeProfile: {
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const existing = profiles.get(where.userId);
          const saved = existing
            ? { ...existing, ...update, userId: where.userId }
            : { id: 'profile-1', ...create };
          profiles.set(where.userId, saved);
          return saved;
        }),
      },
      user: {
        update: jest.fn(async ({ data }: any) => ({ ...user, ...data })),
      },
      auditLog: {
        create: jest.fn(async ({ data }: any) => ({ id: 'audit-1', ...data })),
      },
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new EmployeeArchivesService(prisma as any);
    const operator = {
      id: '20000000-0000-4000-8000-000000000001',
      name: 'HR',
      sysRole: SysRole.hr,
      deptId: null,
      isAssessorOnly: false,
      canViewAll: true,
    };

    await service.upsertProfile(user.id, { phone: '13700000001', gender: 'female' }, operator);
    const result = await service.upsertProfile(user.id, { phone: '13700000002', gender: 'female' }, operator);

    expect(profiles.size).toBe(1);
    expect(profiles.get(user.id)).toEqual(expect.objectContaining({
      id: 'profile-1',
      userId: user.id,
      phone: '13700000002',
      gender: 'female',
    }));
    expect(result).toEqual(expect.objectContaining({
      userId: user.id,
      phone: '13700000002',
    }));
  });

  it('creates one current employment segment and projects it onto the existing user', async () => {
    const user = {
      id: '10000000-0000-4000-8000-000000000001',
      employeeNo: '001',
      deletedAt: null,
    };
    const tx = {
      employmentRecord: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => ({ id: 'employment-1', ...data })),
      },
      user: {
        update: jest.fn(async ({ data }: any) => ({ ...user, ...data })),
      },
      auditLog: {
        create: jest.fn(async ({ data }: any) => ({ id: 'audit-1', ...data })),
      },
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new EmployeeArchivesService(prisma as any);
    const operator = {
      id: '20000000-0000-4000-8000-000000000001',
      name: 'HR',
      sysRole: SysRole.hr,
      deptId: null,
      isAssessorOnly: false,
      canViewAll: true,
    };

    const result = await service.createEmploymentRecord(user.id, {
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
      company: CompanyCode.fuede,
      deptId: '30000000-0000-4000-8000-000000000001',
      position: '董事长',
      jobGrade: null,
      jobFamily: '管理',
      directManagerId: null,
      workLocation: '杭州',
      employmentType: EmploymentType.full_time,
      employeeStatus: UserStatus.active,
      entryDate: new Date('2001-01-01T00:00:00.000Z'),
      plannedRegularDate: null,
      actualRegularDate: null,
      leaveDate: null,
      probationMonths: null,
      changeType: 'hire',
      reason: '花名册初始化',
      sourceType: 'manual',
      sourceBatchId: null,
    }, operator);

    expect(tx.employmentRecord.create).toHaveBeenCalledTimes(1);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: expect.objectContaining({
        deptId: '30000000-0000-4000-8000-000000000001',
        position: '董事长',
        directManagerId: null,
        employmentType: EmploymentType.full_time,
        status: UserStatus.active,
      }),
    });
    expect(result).toEqual(expect.objectContaining({ id: 'employment-1', userId: user.id }));
  });

  it('rejects an employment segment that overlaps existing history', async () => {
    const user = {
      id: '10000000-0000-4000-8000-000000000001',
      employeeNo: '001',
      deletedAt: null,
    };
    const tx = {
      employmentRecord: {
        findFirst: jest.fn().mockResolvedValue({ id: 'existing-employment' }),
        create: jest.fn(),
      },
      user: { update: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new EmployeeArchivesService(prisma as any);
    const operator = {
      id: '20000000-0000-4000-8000-000000000001',
      name: 'HR',
      sysRole: SysRole.hr,
      deptId: null,
      isAssessorOnly: false,
      canViewAll: true,
    };

    await expect(service.createEmploymentRecord(user.id, {
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
      company: CompanyCode.fuede,
      employmentType: EmploymentType.full_time,
      employeeStatus: UserStatus.active,
      changeType: 'data_correction',
    }, operator)).rejects.toMatchObject({
      response: expect.objectContaining({ message: '任职生效区间与现有记录重叠' }),
    });

    expect(tx.employmentRecord.create).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('绑定和停用钉钉只改变身份状态，不改员工组织任职', async () => {
    const user = {
      id: '10000000-0000-4000-8000-000000000001',
      employeeNo: '001',
      deptId: 'dept-1',
      position: '项目经理',
      deletedAt: null,
    };
    const binding = {
      id: 'binding-1',
      provider: 'dingtalk',
      userId: user.id,
      externalUserId: 'ding-user-1',
      externalUnionId: 'ding-union-1',
      status: 'enabled',
      endedAt: null,
    };
    const tx = {
      externalIdentityBinding: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => ({ ...binding, ...data })),
        update: jest.fn(async ({ data }: any) => ({ ...binding, ...data })),
      },
      user: {
        update: jest.fn(async ({ data }: any) => ({ ...user, ...data })),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      externalIdentityBinding: { findFirst: jest.fn().mockResolvedValue(binding) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new EmployeeArchivesService(prisma as any);
    const operator = {
      id: '20000000-0000-4000-8000-000000000001',
      name: 'HR',
      sysRole: SysRole.hr,
      deptId: null,
      isAssessorOnly: false,
      canViewAll: true,
    };

    await service.bindDingtalkIdentity(user.id, {
      externalUserId: 'ding-user-1',
      externalUnionId: 'ding-union-1',
    }, operator);
    await service.setDingtalkIdentityEnabled(user.id, false, '暂停登录', operator);

    expect(tx.externalIdentityBinding.create).toHaveBeenCalledTimes(1);
    expect(tx.externalIdentityBinding.update).toHaveBeenCalledWith({
      where: { id: 'binding-1' },
      data: expect.objectContaining({
        status: 'disabled',
        disabledReason: '暂停登录',
      }),
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { dingtalkId: 'ding-user-1', dingtalkUnionId: 'ding-union-1' },
    });
    expect(tx.user.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ deptId: expect.anything() }),
    }));
  });
});
