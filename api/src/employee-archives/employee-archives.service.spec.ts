import { CompanyCode, EmploymentType, SysRole, UserStatus } from '@prisma/client';
import { EmployeeArchivesService } from './employee-archives.service';

describe('EmployeeArchivesService', () => {
  const archiveEditorUser = () => ({
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
    employeeProfile: null,
    employmentHistory: [{
      company: CompanyCode.fuede,
      deptId: '30000000-0000-4000-8000-000000000001',
      position: '专员',
      directManagerId: null,
    }],
    employeeContracts: [],
  });

  const hrOperator = {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'HR',
    sysRole: SysRole.hr,
    deptId: null,
    isAssessorOnly: false,
    canViewAll: true,
  };

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

  it('档案字段修改只生成待审核版本，正式档案在审核前保持不变', async () => {
    const user = {
      id: '10000000-0000-4000-8000-000000000001',
      employeeNo: '001',
      name: '员工甲',
      phone: '13800000000',
      deptId: 'dept-1',
      position: '专员',
      entryDate: new Date('2024-01-01T00:00:00.000Z'),
      plannedRegularDate: null,
      actualRegularDate: null,
      leaveDate: null,
      employmentType: 'full_time',
      status: 'active',
      directManagerId: 'performance-manager-1',
      deletedAt: null,
      employeeProfile: { gender: '女', phone: '13800000000' },
      employmentHistory: [{
        company: 'fuede', deptId: 'dept-1', position: '专员', jobGrade: 'P3', jobFamily: '职能',
        directManagerId: 'roster-manager-1', workLocation: '杭州', probationMonths: null,
      }],
    };
    const reviewCreate = jest.fn().mockResolvedValue({ id: 'profile-review', profileReviewStatus: 'pending' });
    const profileUpsert = jest.fn();
    const userUpdate = jest.fn();
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      employeeDataChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: reviewCreate,
      },
      employeeProfile: { upsert: profileUpsert },
      $transaction: jest.fn(),
    };
    const service = new EmployeeArchivesService(prisma as any);
    const operator = {
      id: '20000000-0000-4000-8000-000000000001', name: 'HR', sysRole: SysRole.hr,
      deptId: null, isAssessorOnly: false, canViewAll: true,
    };

    const result = await service.upsertProfile(user.id, { phone: '13900000000', gender: '女' }, operator);

    expect(result).toEqual(expect.objectContaining({ id: 'profile-review', profileReviewStatus: 'pending' }));
    expect(reviewCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: user.id,
        sourceType: 'manual_profile_change',
        profileReviewStatus: 'pending',
        performanceReviewStatus: 'not_required',
        proposedValue: expect.objectContaining({
          profile: expect.objectContaining({ phone: '13900000000', gender: '女' }),
        }),
      }),
    });
    expect(profileUpsert).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('同一员工连续修改档案时合并到同一条待审核记录', async () => {
    const user = {
      id: '10000000-0000-4000-8000-000000000001', employeeNo: '001', name: '李宏',
      phone: '18600000000', deptId: 'dept-1', position: '董事长',
      entryDate: new Date('2001-01-01T00:00:00.000Z'), plannedRegularDate: null,
      actualRegularDate: null, leaveDate: null, employmentType: 'full_time', status: 'active',
      directManagerId: null, deletedAt: null, employeeProfile: { phone: '18600000000', gender: '男' },
      employmentHistory: [{ company: 'fuede', deptId: 'dept-1', position: '董事长', directManagerId: null }],
    };
    const pending = { id: 'review-profile', userId: user.id, profileReviewStatus: 'pending' };
    const reviewUpdate = jest.fn().mockResolvedValue({ ...pending, proposedValue: { profile: { phone: '13700000002' } } });
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      employeeDataChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(pending),
        update: reviewUpdate,
      },
    };
    const service = new EmployeeArchivesService(prisma as any);
    const operator = {
      id: '20000000-0000-4000-8000-000000000001', name: 'HR', sysRole: SysRole.hr,
      deptId: null, isAssessorOnly: false, canViewAll: true,
    };

    const result = await service.upsertProfile(user.id, { phone: '13700000002', gender: '男' }, operator);

    expect(result).toEqual(expect.objectContaining({ id: 'review-profile' }));
    expect(reviewUpdate).toHaveBeenCalledWith({
      where: { id: 'review-profile' },
      data: expect.objectContaining({
        proposedValue: expect.objectContaining({
          profile: expect.objectContaining({ phone: '13700000002', gender: '男' }),
        }),
      }),
    });
  });

  it('新增任职记录只生成基础档案待审核版本', async () => {
    const user = {
      id: '10000000-0000-4000-8000-000000000001', employeeNo: '001', name: '李宏',
      phone: null, deptId: null, position: null, entryDate: new Date('2001-01-01T00:00:00.000Z'),
      plannedRegularDate: null, actualRegularDate: null, leaveDate: null, employmentType: 'full_time',
      status: 'active', directManagerId: null, deletedAt: null, employeeProfile: null, employmentHistory: [],
    };
    const reviewCreate = jest.fn().mockResolvedValue({ id: 'employment-review', profileReviewStatus: 'pending' });
    const employmentCreate = jest.fn();
    const userUpdate = jest.fn();
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      employmentRecord: { findFirst: jest.fn().mockResolvedValue(null), create: employmentCreate },
      employeeDataChangeRequest: { create: reviewCreate },
    };
    const service = new EmployeeArchivesService(prisma as any);
    const operator = {
      id: '20000000-0000-4000-8000-000000000001', name: 'HR', sysRole: SysRole.hr,
      deptId: null, isAssessorOnly: false, canViewAll: true,
    };

    const result = await service.createEmploymentRecord(user.id, {
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: null, company: CompanyCode.fuede,
      deptId: '30000000-0000-4000-8000-000000000001', position: '董事长', jobGrade: null,
      jobFamily: '管理', directManagerId: null, workLocation: '杭州',
      employmentType: EmploymentType.full_time, employeeStatus: UserStatus.active,
      entryDate: new Date('2001-01-01T00:00:00.000Z'), plannedRegularDate: null, actualRegularDate: null,
      leaveDate: null, probationMonths: null, changeType: 'hire', reason: '花名册初始化',
      sourceType: 'manual', sourceBatchId: null,
    }, operator);

    expect(result).toEqual(expect.objectContaining({ id: 'employment-review', profileReviewStatus: 'pending' }));
    expect(reviewCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: user.id, sourceType: 'manual_employment_change', profileReviewStatus: 'pending',
        performanceReviewStatus: 'not_required',
        proposedValue: expect.objectContaining({
          employee: expect.objectContaining({
            deptId: '30000000-0000-4000-8000-000000000001',
            position: '董事长',
            managerId: null,
          }),
        }),
      }),
    });
    expect(employmentCreate).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
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
      employmentRecord: tx.employmentRecord,
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

  it('合同图片超过 5 张时拒绝提交档案审核', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(archiveEditorUser()) },
      employeeDataChangeRequest: { findFirst: jest.fn(), create: jest.fn() },
    };
    const service = new EmployeeArchivesService(prisma as any);
    const images = Array.from({ length: 6 }, (_, index) => ({
      name: `合同-${index + 1}.jpg`,
      url: `/storage/download?key=image-${index + 1}`,
      size: 1024,
      mimeType: 'image/jpeg',
    }));

    await expect(service.submitDraft(archiveEditorUser().id, {
      employee: {},
      profile: {},
      contracts: [{ contractType: '劳动合同', images, attachments: [] }],
    }, hrOperator)).rejects.toMatchObject({
      response: expect.objectContaining({ message: '每份合同最多上传 5 张图片' }),
    });
    expect(prisma.employeeDataChangeRequest.create).not.toHaveBeenCalled();
  });

  it('合同图片或附件超过单文件限制时拒绝提交档案审核', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(archiveEditorUser()) },
      employeeDataChangeRequest: { findFirst: jest.fn(), create: jest.fn() },
    };
    const service = new EmployeeArchivesService(prisma as any);

    await expect(service.submitDraft(archiveEditorUser().id, {
      employee: {},
      profile: {},
      contracts: [{
        contractType: '劳动合同',
        images: [{ name: '合同.jpg', url: '/storage/download?key=image', size: 2 * 1024 * 1024 + 1, mimeType: 'image/jpeg' }],
        attachments: [],
      }],
    }, hrOperator)).rejects.toMatchObject({
      response: expect.objectContaining({ message: '合同图片单张不能超过 2MB' }),
    });

    await expect(service.submitDraft(archiveEditorUser().id, {
      employee: {},
      profile: {},
      contracts: [{
        contractType: '劳动合同',
        images: [],
        attachments: [{ name: '合同.pdf', url: '/storage/download?key=attachment', size: 10 * 1024 * 1024 + 1, mimeType: 'application/pdf' }],
      }],
    }, hrOperator)).rejects.toMatchObject({
      response: expect.objectContaining({ message: '合同附件单个不能超过 10MB' }),
    });
  });

  it('合法合同材料进入待审核版本且不提前修改正式合同', async () => {
    const reviewCreate = jest.fn().mockResolvedValue({ id: 'archive-review', profileReviewStatus: 'pending' });
    const contractUpdate = jest.fn();
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(archiveEditorUser()) },
      employeeDataChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: reviewCreate,
      },
      employeeContract: { update: contractUpdate },
    };
    const service = new EmployeeArchivesService(prisma as any);
    const images = [{
      name: '合同.jpg',
      url: '/storage/download?key=employee-contracts%2Fimages%2F2026%2F08%2F28%2Fimage.jpg',
      size: 2048,
      mimeType: 'image/jpeg',
    }];
    const attachments = [{
      name: '合同.pdf',
      url: '/storage/download?key=employee-contracts%2Fattachments%2F2026%2F08%2F28%2Fattachment.pdf',
      size: 4096,
      mimeType: 'application/pdf',
    }];

    await service.submitDraft(archiveEditorUser().id, {
      employee: {},
      profile: {},
      contracts: [{ contractType: '劳动合同', images, attachments }],
    }, hrOperator);

    expect(reviewCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        proposedValue: expect.objectContaining({
          contracts: [expect.objectContaining({ images, attachments })],
        }),
      }),
    });
    expect(contractUpdate).not.toHaveBeenCalled();
  });

  it('通用上传目录的文件不能伪装成合同私有材料', async () => {
    const reviewCreate = jest.fn();
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(archiveEditorUser()) },
      employeeDataChangeRequest: { findFirst: jest.fn(), create: reviewCreate },
    };
    const service = new EmployeeArchivesService(prisma as any);

    await expect(service.submitDraft(archiveEditorUser().id, {
      employee: {},
      profile: {},
      contracts: [{
        contractType: '劳动合同',
        images: [{
          name: '合同.jpg',
          url: '/storage/download?key=uploads%2F2026%2F08%2F28%2Ffake.jpg',
          size: 1024,
          mimeType: 'image/jpeg',
        }],
        attachments: [],
      }],
    }, hrOperator)).rejects.toMatchObject({
      response: expect.objectContaining({ message: '合同材料必须通过系统合同专用入口安全上传' }),
    });
    expect(reviewCreate).not.toHaveBeenCalled();
  });

  it('批量归属部门为每名员工生成待审核版本且不直接改正式部门', async () => {
    const users = [archiveEditorUser(), {
      ...archiveEditorUser(),
      id: '10000000-0000-4000-8000-000000000002',
      employeeNo: '002',
      name: '员工乙',
      deptId: null,
      employmentHistory: [{
        company: CompanyCode.fuede,
        deptId: null,
        position: '专员',
        directManagerId: null,
      }],
    }];
    const reviewCreate = jest.fn(async ({ data }: any) => ({ id: `review-${data.userId}`, ...data }));
    const userUpdate = jest.fn();
    const tx = {
      department: {
        findUnique: jest.fn().mockResolvedValue({
          id: '40000000-0000-4000-8000-000000000001', isActive: true,
        }),
      },
      user: {
        findUnique: jest.fn(({ where }: any) => Promise.resolve(users.find((user) => user.id === where.id) ?? null)),
        findMany: jest.fn().mockResolvedValue(users.map((user) => ({ id: user.id, deptId: user.deptId }))),
        update: userUpdate,
      },
      employeeDataChangeRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: reviewCreate,
      },
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new EmployeeArchivesService(prisma as any);

    const result = await service.submitDepartmentAssignments(
      users.map((user) => user.id),
      '40000000-0000-4000-8000-000000000001',
      hrOperator,
    );

    expect(result).toEqual({ submitted: 2 });
    expect(reviewCreate).toHaveBeenCalledTimes(2);
    expect(reviewCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: users[1].id,
        proposedValue: expect.objectContaining({
          employee: expect.objectContaining({ deptId: '40000000-0000-4000-8000-000000000001' }),
        }),
      }),
    });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('批量归属预检发现员工不存在时不生成部分审核单', async () => {
    const reviewCreate = jest.fn();
    const tx = {
      department: { findUnique: jest.fn().mockResolvedValue({ id: 'dept-target', isActive: true }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'employee-1', deptId: null }]) },
      employeeDataChangeRequest: { findMany: jest.fn(), create: reviewCreate },
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new EmployeeArchivesService(prisma as any);

    await expect(service.submitDepartmentAssignments(
      ['employee-1', 'employee-missing'],
      'dept-target',
      hrOperator,
    )).rejects.toMatchObject({
      response: expect.objectContaining({ message: '部分员工不存在或已停用，请刷新后重试' }),
    });
    expect(reviewCreate).not.toHaveBeenCalled();
  });

  it('批量归属遇到已有档案待审时整批拒绝且不覆盖原草稿', async () => {
    const reviewCreate = jest.fn();
    const reviewUpdate = jest.fn();
    const tx = {
      department: { findUnique: jest.fn().mockResolvedValue({ id: 'dept-target', isActive: true }) },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'employee-1', deptId: null },
          { id: 'employee-2', deptId: null },
        ]),
      },
      employeeDataChangeRequest: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'employee-2', employeeName: '员工乙' }]),
        create: reviewCreate,
        update: reviewUpdate,
      },
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new EmployeeArchivesService(prisma as any);

    await expect(service.submitDepartmentAssignments(
      ['employee-1', 'employee-2'],
      'dept-target',
      hrOperator,
    )).rejects.toMatchObject({
      response: expect.objectContaining({ message: expect.stringContaining('员工乙已有档案变更待审') }),
    });
    expect(reviewCreate).not.toHaveBeenCalled();
    expect(reviewUpdate).not.toHaveBeenCalled();
  });

  it('批量归属的全部审核单在同一事务中创建', async () => {
    const users = [archiveEditorUser(), {
      ...archiveEditorUser(),
      id: '10000000-0000-4000-8000-000000000002',
      employeeNo: '002',
      name: '员工乙',
      deptId: null,
    }];
    const reviewCreate = jest.fn()
      .mockResolvedValueOnce({ id: 'review-1' })
      .mockRejectedValueOnce(new Error('第二张审核单创建失败'));
    const tx = {
      department: { findUnique: jest.fn().mockResolvedValue({ id: 'dept-target', isActive: true }) },
      user: {
        findMany: jest.fn().mockResolvedValue(users.map((user) => ({ id: user.id, deptId: user.deptId }))),
        findUnique: jest.fn(({ where }: any) => Promise.resolve(users.find((user) => user.id === where.id) ?? null)),
      },
      employeeDataChangeRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: reviewCreate,
      },
    };
    const transaction = jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx));
    const service = new EmployeeArchivesService({ ...tx, $transaction: transaction } as any);

    await expect(service.submitDepartmentAssignments(
      users.map((user) => user.id),
      'dept-target',
      hrOperator,
    )).rejects.toThrow('第二张审核单创建失败');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(reviewCreate).toHaveBeenCalledTimes(2);
  });
});
