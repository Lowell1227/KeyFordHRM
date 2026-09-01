import { BadRequestException } from '@nestjs/common';
import { DepartmentsService } from './departments.service';

const operator = {
  id: 'operator-335',
  name: '余焱玲',
  sysRole: 'hr_user',
  deptId: 'dept-admin',
  hrCapabilities: ['organization_edit'],
} as any;

const hrAdmin = {
  id: 'hr-admin-1',
  name: '姚遥',
  sysRole: 'hr',
  deptId: 'dept-admin',
} as any;

describe("DepartmentsService", () => {
  it("正式组织人数只统计员工账号，不把测试或服务账号算入花名册组织", async () => {
    const prisma = {
      department: { findMany: jest.fn().mockResolvedValue([]) },
      user: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    const service = new DepartmentsService(prisma as any);

    await service.findAll({ isActive: true });

    expect(prisma.user.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ accountType: "employee" }),
      }),
    );
  });

  it("返回一级部门负责人直属主管作为最终业务审批人", async () => {
    const prisma = {
      department: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "dept-hr",
            name: "人事行政部",
            fullPath: "人事行政部",
            parentId: null,
            leaderId: "leader-yao",
            approverId: null,
            company: "fuede",
            sortOrder: 1,
            isActive: true,
            leader: {
              name: "姚瑶",
              directManagerId: "manager-guo",
              directManager: { name: "郭志浩" },
            },
            approver: null,
          },
        ]),
      },
      user: {
        groupBy: jest.fn().mockResolvedValue([
          { deptId: "dept-hr", _count: { _all: 8 } },
        ]),
      },
    };
    const service = new DepartmentsService(prisma as any);

    const result = await service.findAll({ isActive: true, flat: true });

    expect(result[0]).toMatchObject({
      effectiveApproverId: "manager-guo",
      effectiveApproverName: "郭志浩",
      effectiveApproverSource: "leader_manager",
    });
  });

  it('普通 HR 调整部门父级时只生成待审核申请，不改正式组织', async () => {
    const request = {
      id: 'change-structure-1',
      action: 'update_structure',
      status: 'pending',
      departmentId: 'dept-visual',
    };
    const tx = {
      department: { update: jest.fn().mockResolvedValue({}) },
      departmentChangeRequest: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(request) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      department: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'dept-visual', name: '视觉设计部', fullPath: '视觉设计部', parentId: null, company: 'fuede', isActive: true },
          { id: 'dept-project', name: '项目中心', fullPath: '项目中心', parentId: null, company: 'fuede', isActive: true },
        ]),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new DepartmentsService(prisma as any);
    jest.spyOn(service, 'findAll').mockResolvedValue([
      { id: 'dept-visual', name: '视觉设计部', fullPath: '项目中心 / 视觉设计部', memberCount: 0 },
    ] as any);

    await expect(service.updateStructure(
      'dept-visual',
      { parentId: 'dept-project' },
      operator,
    )).resolves.toMatchObject({ id: 'change-structure-1', status: 'pending' });
    expect(tx.departmentChangeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'update_structure',
        departmentId: 'dept-visual',
        createdById: 'operator-335',
        baseValue: expect.objectContaining({ name: '视觉设计部', parentId: null }),
        proposedValue: expect.objectContaining({ name: '视觉设计部', parentId: 'dept-project' }),
      }),
    });
    expect(tx.department.update).not.toHaveBeenCalled();
  });

  it('新建下级部门时继承上级公司并提交审核，审核前不创建正式部门', async () => {
    const created = {
      id: 'dept-new',
      name: '品牌组',
      fullPath: '市场部 / 品牌组',
      parentId: 'dept-market',
      company: 'fuede_sports',
      sortOrder: 4,
      isActive: true,
    };
    const tx = {
      department: { create: jest.fn().mockResolvedValue(created) },
      departmentChangeRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'change-create-1', action: 'create', status: 'pending' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      department: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'dept-market', name: '市场部', fullPath: '市场部', parentId: null, company: 'fuede_sports', sortOrder: 3, isActive: true },
        ]),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new DepartmentsService(prisma as any);
    jest.spyOn(service, 'findAll').mockResolvedValue([{ ...created, memberCount: 0 }] as any);

    await expect(service.create(
      { name: ' 品牌组 ', parentId: 'dept-market' } as any,
      operator,
    )).resolves.toMatchObject({ id: 'change-create-1', status: 'pending' });
    expect(tx.departmentChangeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'create',
        createdById: 'operator-335',
        proposedValue: expect.objectContaining({
        name: '品牌组',
        parentId: 'dept-market',
        company: 'fuede_sports',
        fullPath: '市场部 / 品牌组',
        }),
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'submit_department_change', userId: 'operator-335' }),
    }));
    expect(tx.department.create).not.toHaveBeenCalled();
  });

  it('同一上级下已有同名新建部门待审时拒绝重复提交', async () => {
    const tx = {
      departmentChangeRequest: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'create-pending',
          proposedValue: { name: '品牌组', parentId: 'dept-market', company: 'fuede_sports' },
        }]),
        create: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const service = new DepartmentsService({
      department: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'dept-market', name: '市场部', fullPath: '市场部', parentId: null,
          company: 'fuede_sports', sortOrder: 1, isActive: true, leaderId: null, approverId: null,
        }]),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as any);

    await expect(service.create({ name: '品牌组', parentId: 'dept-market' } as any, operator))
      .rejects.toThrow('同一上级下已有同名部门待审核');
    expect(tx.departmentChangeRequest.create).not.toHaveBeenCalled();
  });

  it('普通 HR 合并部门时只提交包含影响范围的待审核申请', async () => {
    const tx = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
      department: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        update: jest.fn().mockResolvedValue({}),
      },
      departmentChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'change-merge-1', action: 'merge', status: 'pending' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      department: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'dept-sales', name: '销售部', fullPath: '销售部', parentId: null, company: 'fuede_sports', isActive: true },
          { id: 'dept-source', name: '旧零售部', fullPath: '销售部 / 旧零售部', parentId: 'dept-sales', company: 'fuede', isActive: true },
          { id: 'dept-target', name: '新零售部', fullPath: '销售部 / 新零售部', parentId: 'dept-sales', company: 'fuede_sports', isActive: true },
          { id: 'dept-child', name: '门店组', fullPath: '销售部 / 旧零售部 / 门店组', parentId: 'dept-source', company: 'fuede', isActive: true },
        ]),
      },
      user: { count: jest.fn().mockResolvedValue(3) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new DepartmentsService(prisma as any);

    await expect(service.merge(
      'dept-source',
      { targetDepartmentId: 'dept-target' } as any,
      operator,
    )).resolves.toEqual(expect.objectContaining({ id: 'change-merge-1', status: 'pending' }));
    expect(tx.departmentChangeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'merge',
        departmentId: 'dept-source',
        proposedValue: expect.objectContaining({ targetDepartmentId: 'dept-target' }),
        baseValue: expect.objectContaining({ directMemberCount: 3, childDepartmentIds: ['dept-child'] }),
      }),
    });
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.department.updateMany).not.toHaveBeenCalled();
    expect(tx.department.update).not.toHaveBeenCalled();
  });

  it('HR 管理员通过部门调整后才事务性写入正式组织', async () => {
    const request = {
      id: 'change-approve-1',
      action: 'update_structure',
      status: 'pending',
      departmentId: 'dept-visual',
      createdById: 'operator-335',
      baseValue: { name: '视觉设计部', parentId: null, fullPath: '视觉设计部' },
      proposedValue: { name: '视觉设计部', parentId: 'dept-project' },
    };
    const tx = {
      departmentChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ ...request, status: 'approved' }),
      },
      department: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'dept-visual', name: '视觉设计部', fullPath: '视觉设计部', parentId: null, company: 'fuede', isActive: true },
          { id: 'dept-project', name: '项目中心', fullPath: '项目中心', parentId: null, company: 'beijing_fuede', isActive: true },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      departmentChangeRequest: { findUnique: jest.fn().mockResolvedValue(request) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new DepartmentsService(prisma as any);

    await expect((service as any).approveChange(request.id, hrAdmin)).resolves.toMatchObject({
      id: request.id,
      status: 'approved',
    });
    expect(tx.department.update).toHaveBeenCalledWith({
      where: { id: 'dept-visual' },
      data: { name: '视觉设计部', parentId: 'dept-project' },
    });
    expect(tx.departmentChangeRequest.update).toHaveBeenCalledWith({
      where: { id: request.id },
      data: expect.objectContaining({ status: 'approved', reviewedById: 'hr-admin-1' }),
    });
  });

  it('HR 管理员通过新建部门后把正式部门标识回填到审核记录', async () => {
    const request = {
      id: 'change-create-approve', action: 'create', status: 'pending', departmentId: null,
      departmentName: '品牌组', createdById: 'operator-335', baseValue: {},
      proposedValue: { name: '品牌组', parentId: null, company: 'fuede', sortOrder: 1, fullPath: '品牌组' },
    };
    const tx = {
      departmentChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...request, ...data })),
      },
      department: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'dept-new', name: '品牌组' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new DepartmentsService(prisma as any);

    await service.approveChange(request.id, hrAdmin);

    expect(tx.departmentChangeRequest.update).toHaveBeenCalledWith({
      where: { id: request.id },
      data: expect.objectContaining({ status: 'approved', departmentId: 'dept-new' }),
    });
  });

  it('花名册新增下级部门时按已审核的上级路径挂靠', async () => {
    const request = {
      id: 'change-create-child', action: 'create', status: 'pending', departmentId: null,
      departmentName: '品牌组', createdById: 'operator-335', baseValue: {},
      proposedValue: {
        name: '品牌组', parentId: null, parentFullPath: '市场部', company: 'fuede',
        sortOrder: 1, fullPath: '市场部 / 品牌组', sourceBatchId: 'batch-1',
      },
    };
    const departmentCreate = jest.fn().mockResolvedValue({ id: 'dept-brand', name: '品牌组' });
    const tx = {
      departmentChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...request, ...data })),
      },
      department: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'dept-market', name: '市场部', fullPath: '市场部', parentId: null,
          company: 'fuede', sortOrder: 0, isActive: true,
        }]),
        create: departmentCreate,
      },
      auditLog: { create: jest.fn() },
    };
    const service = new DepartmentsService({
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as any);

    await service.approveChange(request.id, hrAdmin);

    expect(departmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '品牌组', parentId: 'dept-market', fullPath: '市场部 / 品牌组', company: 'fuede',
      }),
    });
  });

  it('花名册组织元数据调整审核后可重新启用部门并更新排序', async () => {
    const request = {
      id: 'change-reactivate', action: 'update_structure', status: 'pending', departmentId: 'dept-old',
      departmentName: '项目组', createdById: 'operator-335',
      baseValue: {
        id: 'dept-old', name: '项目组', parentId: null, fullPath: '项目组',
        company: 'fuede', sortOrder: 8, isActive: false,
      },
      proposedValue: {
        id: 'dept-old', name: '项目组', parentId: null, parentFullPath: null,
        company: 'beijing_fuede', sortOrder: 2, isActive: true,
      },
    };
    const departmentUpdate = jest.fn();
    const tx = {
      departmentChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...request, ...data })),
      },
      department: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'dept-old', name: '项目组', fullPath: '项目组', parentId: null,
          company: 'fuede', sortOrder: 8, isActive: false,
        }]),
        update: departmentUpdate,
      },
      auditLog: { create: jest.fn() },
    };
    const service = new DepartmentsService({
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as any);

    await service.approveChange(request.id, hrAdmin);

    expect(departmentUpdate).toHaveBeenCalledWith({
      where: { id: 'dept-old' },
      data: expect.objectContaining({ company: 'beijing_fuede', sortOrder: 2, isActive: true }),
    });
  });

  it('花名册产生的部门负责人变更仍需 HR 管理员审核后生效', async () => {
    const request = {
      id: 'change-leader-approve', action: 'update_leader', status: 'pending', departmentId: 'dept-1',
      departmentName: '项目中心', createdById: 'operator-335',
      baseValue: { id: 'dept-1', name: '项目中心', fullPath: '项目中心', leaderId: null },
      proposedValue: { leaderId: 'employee-new' },
    };
    const departmentUpdate = jest.fn();
    const tx = {
      departmentChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...request, ...data })),
      },
      department: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'dept-1', name: '项目中心', fullPath: '项目中心', leaderId: null, isActive: true,
        }),
        update: departmentUpdate,
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'employee-new', deletedAt: null }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new DepartmentsService(prisma as any);

    await service.approveChange(request.id, hrAdmin);

    expect(departmentUpdate).toHaveBeenCalledWith({
      where: { id: 'dept-1' },
      data: { leaderId: 'employee-new' },
    });
    expect(tx.departmentChangeRequest.update).toHaveBeenCalledWith({
      where: { id: request.id },
      data: expect.objectContaining({ status: 'approved', reviewedById: 'hr-admin-1' }),
    });
  });

  it('普通 HR 即使有组织编辑能力也不能审核部门变更', async () => {
    const service = new DepartmentsService({} as any);

    await expect(service.approveChange('change-1', operator)).rejects.toThrow('仅 HR 管理员可审核部门变更');
  });

  it('HR 管理员退回部门变更时只更新申请状态，不修改正式部门', async () => {
    const request = {
      id: 'change-reject-1', action: 'update_structure', status: 'pending', departmentId: 'dept-1',
      createdById: 'operator-335', baseValue: {}, proposedValue: {},
    };
    const tx = {
      departmentChangeRequest: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(request)
          .mockResolvedValueOnce({ ...request, status: 'rejected', rejectedReason: '名称不符合规范' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      department: { update: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new DepartmentsService(prisma as any);

    await expect(service.rejectChange(request.id, '名称不符合规范', hrAdmin)).resolves.toMatchObject({
      status: 'rejected',
      rejectedReason: '名称不符合规范',
    });
    expect(tx.departmentChangeRequest.updateMany).toHaveBeenCalledWith({
      where: { id: request.id, status: 'pending' },
      data: expect.objectContaining({
        status: 'rejected',
        reviewedById: 'hr-admin-1',
        rejectedReason: '名称不符合规范',
      }),
    });
    expect(tx.department.update).not.toHaveBeenCalled();
  });

  it('部门待审核列表返回普通 HR 提交人供管理员识别', async () => {
    const item = {
      id: 'change-list-1', action: 'delete', status: 'pending', departmentName: '空部门',
      createdBy: { id: 'operator-335', name: '余焱玲', sysRole: 'hr_user' },
    };
    const prisma = {
      departmentChangeRequest: {
        findMany: jest.fn().mockResolvedValue([item]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const service = new DepartmentsService(prisma as any);

    const result = await service.findChangeRequests({ status: 'pending', page: 1, pageSize: 20 });

    expect(result.items[0].createdBy).toMatchObject({ name: '余焱玲', sysRole: 'hr_user' });
    expect(prisma.departmentChangeRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: {
        createdBy: { select: { id: true, name: true, sysRole: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    }));
  });

  it('停用非空部门时只提交待处理影响，不自动安排人员释放或下级提升', async () => {
    const tx = {
      departmentChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'change-delete-busy', action: 'delete', status: 'pending' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      department: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'dept-busy',
          name: '项目部',
          fullPath: '项目中心 / 项目部',
          parentId: 'dept-project',
          isActive: true,
          members: [{ id: 'user-1' }, { id: 'user-2' }],
          children: [{ id: 'dept-child' }],
        }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new DepartmentsService(prisma as any);

    await expect(service.remove('dept-busy', operator)).resolves.toMatchObject({
      id: 'change-delete-busy',
      status: 'pending',
    });
    expect(tx.departmentChangeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'delete',
        baseValue: expect.objectContaining({
          directMemberIds: ['user-1', 'user-2'],
          childDepartmentIds: ['dept-child'],
        }),
        proposedValue: expect.objectContaining({
          isActive: false,
          requiresResolution: true,
        }),
      }),
    });
  });

  it('删除空部门只提交待审核申请，审核前保持启用', async () => {
    const tx = {
      department: { update: jest.fn() },
      departmentChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'change-delete-1', action: 'delete', status: 'pending' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      department: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'dept-empty', name: '空部门', fullPath: '空部门', parentId: null, isActive: true,
          members: [], children: [],
        }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new DepartmentsService(prisma as any);

    await expect(service.remove('dept-empty', operator)).resolves.toMatchObject({
      id: 'change-delete-1',
      status: 'pending',
    });
    expect(tx.departmentChangeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'delete', departmentId: 'dept-empty', createdById: 'operator-335' }),
    });
    expect(tx.department.update).not.toHaveBeenCalled();
  });

  it('审核停用部门时如仍有人员或下级部门则拒绝生效且不自动改动', async () => {
    const request = {
      id: 'change-delete-approve', action: 'delete', status: 'pending', departmentId: 'dept-source',
      departmentName: '项目部', createdById: 'operator-335',
      baseValue: {
        id: 'dept-source', name: '项目部', parentId: 'dept-parent', fullPath: '事业部 / 项目部',
        directMemberIds: ['user-1', 'user-2'], childDepartmentIds: ['dept-child'],
      },
      proposedValue: { releaseMembersToRoot: true, promoteChildrenToParentId: 'dept-parent', isActive: false },
    };
    const tx = {
      departmentChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...request, ...data })),
      },
      department: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'dept-source', name: '项目部', parentId: 'dept-parent', isActive: true,
          members: [{ id: 'user-1' }, { id: 'user-2' }], children: [{ id: 'dept-child' }],
        }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'dept-parent', name: '事业部', fullPath: '事业部', parentId: null, company: 'fuede', sortOrder: 1, isActive: true },
          { id: 'dept-source', name: '项目部', fullPath: '事业部 / 项目部', parentId: 'dept-parent', company: 'fuede', sortOrder: 1, isActive: true },
          { id: 'dept-child', name: '实施组', fullPath: '事业部 / 项目部 / 实施组', parentId: 'dept-source', company: 'fuede', sortOrder: 1, isActive: true },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      employmentRecord: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'employment-user-1', userId: 'user-1', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
          effectiveTo: null, company: 'fuede', deptId: 'dept-source', position: '项目专员',
          jobGrade: 'P3', jobFamily: '项目', directManagerId: null, workLocation: '上海',
          employmentType: 'full_time', employeeStatus: 'active', entryDate: new Date('2025-01-01T00:00:00.000Z'),
          plannedRegularDate: null, actualRegularDate: null, leaveDate: null, probationMonths: 3,
          changeType: 'onboarding', reason: null, sourceType: 'roster', sourceBatchId: null, createdById: 'operator-335',
        }]),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new DepartmentsService({
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as any);

    await expect(service.approveChange(request.id, hrAdmin))
      .rejects.toThrow('请先处理在职人员和下级部门');

    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.department.updateMany).not.toHaveBeenCalled();
    expect(tx.department.update).not.toHaveBeenCalled();
    expect(tx.employmentRecord.update).not.toHaveBeenCalled();
    expect(tx.employmentRecord.create).not.toHaveBeenCalled();
  });

  it('部门编辑一次提交名称公司上级负责人和审批人', async () => {
    const tx = {
      departmentChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'change-details', action: 'update_structure', status: 'pending' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      department: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'dept-1', name: '旧名称', fullPath: '旧名称', parentId: null, company: 'fuede',
            leaderId: null, approverId: null, isActive: true,
          },
          {
            id: 'dept-parent', name: '事业部', fullPath: '事业部', parentId: null, company: 'beijing_fuede',
            leaderId: null, approverId: null, isActive: true,
          },
        ]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'leader-1' }, { id: 'approver-1' }]),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new DepartmentsService(prisma as any);

    await service.updateStructure('dept-1', {
      name: '新名称', parentId: 'dept-parent', company: 'beijing_fuede',
      leaderId: 'leader-1', approverId: 'approver-1',
    } as any, operator);

    expect(tx.departmentChangeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        baseValue: expect.objectContaining({ company: 'fuede', leaderId: null, approverId: null }),
        proposedValue: expect.objectContaining({
          name: '新名称', parentId: 'dept-parent', company: 'beijing_fuede',
          leaderId: 'leader-1', approverId: 'approver-1',
        }),
      }),
    });
  });

  it('部门不能挂靠到其他公司的上级部门', async () => {
    const service = new DepartmentsService({
      department: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'dept-1', name: '项目部', fullPath: '项目部', parentId: null, company: 'fuede', leaderId: null, approverId: null, isActive: true },
          { id: 'dept-parent', name: '北京事业部', fullPath: '北京事业部', parentId: null, company: 'beijing_fuede', leaderId: null, approverId: null, isActive: true },
        ]),
      },
    } as any);

    await expect(service.updateStructure('dept-1', { parentId: 'dept-parent' }, operator))
      .rejects.toThrow('上级部门与所属公司必须一致');
  });

  it('审核人不能通过自己提交的部门变更', async () => {
    const ownRequest = {
      id: 'change-own', action: 'update_structure', status: 'pending', departmentId: 'dept-1',
      departmentName: '项目部', createdById: 'hr-admin-1', baseValue: {}, proposedValue: {},
    };
    const tx = { departmentChangeRequest: { findUnique: jest.fn().mockResolvedValue(ownRequest) } };
    const service = new DepartmentsService({
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as any);

    await expect(service.approveChange(ownRequest.id, hrAdmin)).rejects.toThrow('不能审核自己提交的部门变更');
  });

  it('审核人不能退回自己提交的部门变更', async () => {
    const ownRequest = {
      id: 'change-own-reject', action: 'update_structure', status: 'pending', departmentId: 'dept-1',
      departmentName: '项目部', createdById: 'hr-admin-1', baseValue: {}, proposedValue: {},
    };
    const tx = {
      departmentChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(ownRequest),
        updateMany: jest.fn(),
      },
    };
    const service = new DepartmentsService({
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as any);

    await expect(service.rejectChange(ownRequest.id, '信息不完整', hrAdmin))
      .rejects.toThrow('不能审核自己提交的部门变更');
    expect(tx.departmentChangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('同一部门已有待审核结构变更时拒绝重复提交', async () => {
    const tx = {
      departmentChangeRequest: {
        findFirst: jest.fn().mockResolvedValue({ id: 'change-pending', status: 'pending' }),
        create: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const service = new DepartmentsService({
      department: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'dept-1', name: '项目部', fullPath: '项目部', parentId: null, company: 'fuede',
          leaderId: null, approverId: null, isActive: true,
        }]),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as any);

    await expect(service.updateStructure('dept-1', { name: '新项目部' }, operator))
      .rejects.toThrow('该部门已有变更审核中');
    expect(tx.departmentChangeRequest.create).not.toHaveBeenCalled();
  });

  it('并发提交由数据库唯一索引拦截时返回明确的待审冲突', async () => {
    const duplicateError = Object.assign(new Error('unique constraint'), { code: 'P2002' });
    const tx = {
      departmentChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(duplicateError),
      },
      auditLog: { create: jest.fn() },
    };
    const service = new DepartmentsService({
      department: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'dept-1', name: '项目部', fullPath: '项目部', parentId: null, company: 'fuede',
          leaderId: null, approverId: null, isActive: true,
        }]),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as any);

    await expect(service.updateStructure('dept-1', { name: '新项目部' }, operator))
      .rejects.toThrow('该部门已有变更审核中');
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
