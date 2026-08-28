import { SysRole } from '@prisma/client';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';

const operator = {
  id: 'hr-1',
  name: 'HR',
  sysRole: SysRole.hr,
  deptId: null,
  isAssessorOnly: false,
  canViewAll: true,
};

describe('EmployeeDataReviewsService', () => {
  it('HR 管理员查看待审核档案时能识别普通 HR 提交人', async () => {
    const item = {
      id: 'review-from-ordinary-hr',
      employeeName: '员工甲',
      profileReviewStatus: 'pending',
      performanceReviewStatus: 'not_required',
      createdBy: { id: 'ordinary-hr-1', name: '余焱玲', sysRole: SysRole.hr_user },
    };
    const prisma = {
      employeeDataChangeRequest: {
        findMany: jest.fn().mockResolvedValue([item]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const service = new EmployeeDataReviewsService(prisma as any);

    const result = await service.findAll({ page: 1, pageSize: 20, status: 'pending' });

    expect(result.items[0]).toMatchObject({
      id: 'review-from-ordinary-hr',
      createdBy: { name: '余焱玲', sysRole: SysRole.hr_user },
    });
    expect(prisma.employeeDataChangeRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: {
        createdBy: { select: { id: true, name: true, sysRole: true } },
        profileReviewedBy: { select: { id: true, name: true } },
        performanceReviewedBy: { select: { id: true, name: true } },
      },
    }));
  });

  it('批量审核隔离异常员工，合法绩效关系仍然生效', async () => {
    const requests = new Map<string, any>([
      ['review-valid', {
        id: 'review-valid',
        userId: 'employee-1',
        employeeName: '员工一',
        profileReviewStatus: 'not_required',
        performanceReviewStatus: 'pending',
        validationErrors: [],
        proposedValue: { performance: { managerId: 'manager-1', managerName: '主管一' } },
      }],
      ['review-invalid', {
        id: 'review-invalid',
        userId: 'employee-2',
        employeeName: '员工二',
        profileReviewStatus: 'not_required',
        performanceReviewStatus: 'pending',
        validationErrors: ['绩效直属上级待设置'],
        proposedValue: { performance: { managerId: null, managerName: null } },
      }],
    ]);
    const changeUpdate = jest.fn(async ({ where, data }: any) => ({ ...requests.get(where.id), ...data }));
    const userUpdate = jest.fn().mockResolvedValue({ id: 'employee-1', directManagerId: 'manager-1' });
    const tx = {
      employeeDataChangeRequest: {
        findUnique: jest.fn(async ({ where }: any) => requests.get(where.id) ?? null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: changeUpdate,
      },
      user: {
        findUnique: jest.fn(async ({ where }: any) => ({
          id: where.id,
          name: where.id === 'manager-1' ? '主管一' : '员工一',
          deletedAt: null,
          directManagerId: null,
          sysRole: where.id === 'manager-1' ? 'employee' : 'employee',
        })),
        update: userUpdate,
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new EmployeeDataReviewsService(prisma as any);

    const result = await service.approveBatch(
      { requestIds: ['review-valid', 'review-invalid'], scopes: ['performance'] },
      operator,
    );

    expect(result).toEqual({
      succeeded: [{ requestId: 'review-valid', scopes: ['performance'] }],
      failed: [{ requestId: 'review-invalid', reason: '绩效直属上级待设置' }],
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'employee-1' },
      data: { directManagerId: 'manager-1' },
    });
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'grant_performance_manager_role' }),
    }));
    expect(changeUpdate).toHaveBeenCalledWith({
      where: { id: 'review-valid' },
      data: expect.objectContaining({
        performanceReviewStatus: 'approved',
        performanceReviewedById: 'hr-1',
      }),
    });
  });

  it('重复提交同一审核时只允许一个请求实际写入正式数据', async () => {
    const request = {
      id: 'review-already-claimed', userId: 'employee-1', profileReviewStatus: 'not_required',
      performanceReviewStatus: 'pending', validationErrors: [],
      proposedValue: { performance: { managerId: 'manager-1' } },
    };
    const userUpdate = jest.fn();
    const tx = {
      employeeDataChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn(),
      },
      user: { findUnique: jest.fn(), update: userUpdate },
      auditLog: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new EmployeeDataReviewsService(prisma as any);

    const result = await service.approveBatch({ requestIds: [request.id], scopes: ['performance'] }, operator);

    expect(result).toEqual({
      succeeded: [],
      failed: [{ requestId: request.id, reason: '该记录已处理' }],
    });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('旧审核单不能覆盖后来已经生效的绩效直属上级', async () => {
    const request = {
      id: 'review-stale-manager', userId: 'employee-1', profileReviewStatus: 'not_required',
      performanceReviewStatus: 'pending', validationErrors: [],
      baseValue: { performance: { managerId: null } },
      proposedValue: { performance: { managerId: 'roster-manager' } },
    };
    const userUpdate = jest.fn();
    const tx = {
      employeeDataChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ directManagerId: 'custom-manager-newer' }),
        update: userUpdate,
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new EmployeeDataReviewsService(prisma as any);

    const result = await service.approveBatch({ requestIds: [request.id], scopes: ['performance'] }, operator);

    expect(result.failed).toEqual([{
      requestId: request.id,
      reason: '正式绩效直属上级已发生变化，请重新提交审核',
    }]);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('旧基础档案审核不能覆盖后来已经生效的离职状态', async () => {
    const baseEmployee = {
      employeeNo: '001', name: '员工一', phone: '13800000000', company: 'fuede',
      deptId: 'dept-1', position: '专员', jobGrade: null, jobFamily: null,
      managerId: null, workLocation: null, entryDate: '2024-01-01T00:00:00.000Z',
      plannedRegularDate: null, actualRegularDate: null, leaveDate: null,
      probationMonths: null, employmentType: 'full_time', employeeStatus: 'active',
    };
    const request = {
      id: 'review-stale-profile', userId: 'employee-1', sourceType: 'manual_profile_change',
      sourceBatchId: null, profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
      validationErrors: [],
      baseValue: { employee: baseEmployee, profile: { gender: '男' } },
      proposedValue: { employee: baseEmployee, profile: { gender: '女' }, contracts: [] },
    };
    const userUpdate = jest.fn();
    const tx = {
      employeeDataChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          employeeNo: '001', name: '员工一', phone: '13800000000', deptId: 'dept-1', position: '专员',
          entryDate: new Date('2024-01-01T00:00:00.000Z'), plannedRegularDate: null,
          actualRegularDate: null, leaveDate: new Date('2026-08-24T00:00:00.000Z'),
          employmentType: 'full_time', status: 'resigned', employeeProfile: { gender: '男' },
          employeeContracts: [],
          employmentHistory: [{
            company: 'fuede', jobGrade: null, jobFamily: null, directManagerId: null,
            directManager: null, workLocation: null, probationMonths: null,
          }],
        }),
        update: userUpdate,
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new EmployeeDataReviewsService(prisma as any);

    const result = await service.approveBatch({ requestIds: [request.id], scopes: ['profile'] }, operator);

    expect(result.failed).toEqual([{
      requestId: request.id,
      reason: '正式基础档案已发生变化，请重新提交审核',
    }]);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('旧审核不能覆盖后来新建的员工扩展档案', async () => {
    const employee = {
      employeeNo: '001', name: '员工一', phone: null, company: 'fuede', deptId: 'dept-1',
      position: '专员', entryDate: '2024-01-01T00:00:00.000Z', employmentType: 'full_time',
      employeeStatus: 'active',
    };
    const request = {
      id: 'review-profile-created-later', userId: 'employee-1', sourceType: 'manual_profile_change',
      sourceBatchId: null, profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
      validationErrors: [],
      baseValue: { employee, profile: {}, profileExists: false },
      proposedValue: { employee, profile: { gender: '女' }, contracts: [] },
    };
    const userUpdate = jest.fn();
    const tx = {
      employeeDataChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          employeeNo: '001', name: '员工一', phone: null, deptId: 'dept-1', position: '专员',
          entryDate: new Date(employee.entryDate), plannedRegularDate: null, actualRegularDate: null,
          leaveDate: null, employmentType: 'full_time', status: 'active',
          employeeProfile: { gender: '男' }, employeeContracts: [],
          employmentHistory: [{
            company: 'fuede', jobGrade: null, jobFamily: null, directManagerId: null,
            directManager: null, workLocation: null, probationMonths: null,
          }],
        }),
        update: userUpdate,
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new EmployeeDataReviewsService(prisma as any);

    const result = await service.approveBatch({ requestIds: [request.id], scopes: ['profile'] }, operator);

    expect(result.failed).toEqual([{
      requestId: request.id,
      reason: '正式基础档案已发生变化，请重新提交审核',
    }]);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('离职员工不能被设置为绩效直属上级', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: 'employee-1', employeeNo: '001', name: '员工一', directManagerId: null,
            deletedAt: null, dept: { parentId: 'dept-root', leaderId: null },
          })
          .mockResolvedValueOnce(null),
      },
      employeeDataChangeRequest: { findFirst: jest.fn(), create: jest.fn() },
    };
    const service = new EmployeeDataReviewsService(prisma as any);

    await expect(service.proposePerformanceManager(
      'employee-1',
      { managerId: 'resigned-manager' },
      operator,
    )).rejects.toMatchObject({ response: expect.objectContaining({ message: '绩效直属上级不存在或已停用' }) });
  });

  it('同一次审核先建立新员工档案，再启用该员工的绩效直属上级', async () => {
    const request = {
      id: 'review-new',
      userId: null,
      employeeNo: 'N-001',
      employeeName: '新员工',
      sourceBatchId: 'batch-1',
      profileReviewStatus: 'pending',
      performanceReviewStatus: 'pending',
      validationErrors: [],
      baseValue: { organizationLeaders: { '项目中心': null } },
      proposedValue: {
        employee: {
          employeeNo: 'N-001',
          name: '新员工',
          phone: '13800000000',
          company: 'fuede',
          deptId: null,
          position: '项目专员',
          entryDate: '2026-08-01T00:00:00.000Z',
          employmentType: 'full_time',
          employeeStatus: 'active',
          managerName: '主管一',
          organizationPath: ['项目中心'],
          organizationLeaderPaths: [['项目中心']],
          organizationNodes: [{
            fullPath: '项目中心', company: 'fuede', sortOrder: 4,
          }],
        },
        profile: { gender: '女' },
        contracts: [],
        performance: { managerName: '主管一' },
      },
    };
    const requestUpdate = jest.fn(async ({ data }: any) => {
      if (data.userId) request.userId = data.userId;
      return { ...request, ...data };
    });
    const userCreate = jest.fn().mockResolvedValue({ id: 'employee-new' });
    const userUpdate = jest.fn().mockResolvedValue({ id: 'employee-new' });
    const tx = {
      employeeDataChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: requestUpdate,
      },
      user: {
        create: userCreate,
        update: userUpdate,
        findUnique: jest.fn(async ({ where }: any) => ({
          id: where.id,
          name: '主管一',
          deletedAt: null,
          directManagerId: null,
        })),
        findMany: jest.fn().mockResolvedValue([{ id: 'manager-1' }]),
      },
      employeeProfile: { upsert: jest.fn().mockResolvedValue({ id: 'profile-new' }) },
      employmentRecord: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'employment-new' }),
      },
      department: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'dept-1', name: '项目中心', leaderId: null, fullPath: '项目中心' },
        ]),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'dept-1' }),
      },
      departmentChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'department-review-1' }),
      },
      employeeContract: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-new' }) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new EmployeeDataReviewsService(prisma as any);

    const result = await service.approveBatch(
      { requestIds: ['review-new'], scopes: ['profile', 'performance'] },
      operator,
    );

    expect(result.failed).toEqual([]);
    expect(result.succeeded).toEqual([{
      requestId: 'review-new',
      scopes: ['profile', 'performance'],
    }]);
    expect(userCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeNo: 'N-001',
        name: '新员工',
        deptId: 'dept-1',
        directManagerId: null,
      }),
      select: { id: true },
    });
    expect(userUpdate).toHaveBeenLastCalledWith({
      where: { id: 'employee-new' },
      data: { directManagerId: 'manager-1' },
    });
    expect(tx.employmentRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'employee-new',
        directManagerId: 'manager-1',
        sourceBatchId: 'batch-1',
      }),
    });
    expect(tx.department.update).not.toHaveBeenCalled();
    expect(tx.departmentChangeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        departmentId: 'dept-1',
        action: 'update_leader',
        status: 'pending',
        proposedValue: { leaderId: 'employee-new' },
      }),
    });
  });

  it('修改绩效直属上级只生成待审核版本，审核前继续使用原关系', async () => {
    const requestCreate = jest.fn().mockResolvedValue({
      id: 'review-manager-change',
      userId: 'employee-1',
      profileReviewStatus: 'not_required',
      performanceReviewStatus: 'pending',
    });
    const userUpdate = jest.fn();
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'employee-1',
          employeeNo: '001',
          name: '员工一',
          directManagerId: 'manager-old',
          deletedAt: null,
        }),
        update: userUpdate,
      },
      employeeDataChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: requestCreate,
      },
    };
    const service = new EmployeeDataReviewsService(prisma as any);

    const result = await service.proposePerformanceManager(
      'employee-1',
      { managerId: 'manager-new' },
      operator,
    );

    expect(result).toEqual(expect.objectContaining({
      id: 'review-manager-change',
      performanceReviewStatus: 'pending',
    }));
    expect(requestCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'employee-1',
        employeeNo: '001',
        employeeName: '员工一',
        sourceType: 'manual_performance_relation',
        baseValue: { performance: { managerId: 'manager-old' } },
        proposedValue: { performance: { managerId: 'manager-new' } },
        profileReviewStatus: 'not_required',
        performanceReviewStatus: 'pending',
      }),
    });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('已有花名册绩效关系待审核时复用原记录而不生成第二条', async () => {
    const pending = {
      id: 'review-roster-pending', userId: 'employee-1', sourceType: 'employee_roster_import',
      baseValue: { employee: { name: '员工一' }, performance: { managerId: null } },
      proposedValue: {
        employee: { name: '员工一', deptId: 'dept-1' },
        profile: { gender: '女' },
        performance: { managerName: '花名册主管' },
      },
      validationErrors: ['绩效直属上级待设置'],
    };
    const update = jest.fn().mockResolvedValue({ ...pending, performanceReviewStatus: 'pending' });
    const create = jest.fn();
    const prisma = {
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: 'employee-1', employeeNo: '001', name: '员工一', directManagerId: null,
            deletedAt: null, dept: { parentId: 'dept-root', leaderId: null },
          })
          .mockResolvedValueOnce({ id: 'manager-new', name: '新主管' }),
      },
      employeeDataChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(pending),
        update,
        create,
      },
    };
    const service = new EmployeeDataReviewsService(prisma as any);

    await service.proposePerformanceManager('employee-1', { managerId: 'manager-new' }, operator);

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: pending.id },
      data: expect.objectContaining({
        proposedValue: {
          employee: { name: '员工一', deptId: 'dept-1' },
          profile: { gender: '女' },
          performance: { managerId: 'manager-new' },
        },
        validationErrors: [],
      }),
    });
  });

  it('组织最高负责人可以提交清空绩效直属上级的审核', async () => {
    const requestCreate = jest.fn().mockResolvedValue({ id: 'review-top-leader' });
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'top-leader', employeeNo: '001', name: '最高负责人', directManagerId: 'manager-old',
          deletedAt: null, dept: { parentId: null, leaderId: 'top-leader' },
        }),
      },
      employeeDataChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: requestCreate,
      },
    };
    const service = new EmployeeDataReviewsService(prisma as any);

    await service.proposePerformanceManager('top-leader', { managerId: null }, operator);

    expect(requestCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'top-leader',
        baseValue: { performance: { managerId: 'manager-old' } },
        proposedValue: { performance: { managerId: null } },
        performanceReviewStatus: 'pending',
      }),
    });
  });

  it('审核通过后允许组织最高负责人的绩效直属上级保持为空', async () => {
    const request = {
      id: 'review-clear-top-leader', userId: 'top-leader', profileReviewStatus: 'not_required',
      performanceReviewStatus: 'pending', validationErrors: [],
      proposedValue: { performance: { managerId: null } },
    };
    const userUpdate = jest.fn();
    const tx = {
      employeeDataChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ ...request, performanceReviewStatus: 'approved' }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ dept: { parentId: null, leaderId: 'top-leader' } }),
        update: userUpdate,
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new EmployeeDataReviewsService(prisma as any);

    const result = await service.approveBatch({ requestIds: [request.id], scopes: ['performance'] }, operator);

    expect(result.failed).toEqual([]);
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'top-leader' }, data: { directManagerId: null } });
  });

  it('待审核列表分页返回两类审核状态和变更摘要', async () => {
    const review = {
      id: 'review-1',
      userId: 'employee-1',
      employeeNo: '001',
      employeeName: '员工一',
      sourceType: 'employee_roster_import',
      profileReviewStatus: 'pending',
      performanceReviewStatus: 'not_required',
      validationErrors: [],
      baseValue: {},
      proposedValue: { employee: { position: '新岗位' } },
      createdAt: new Date('2026-08-23T08:00:00.000Z'),
      updatedAt: new Date('2026-08-23T08:00:00.000Z'),
    };
    const findMany = jest.fn().mockResolvedValue([review]);
    const prisma = {
      employeeDataChangeRequest: {
        findMany,
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const service = new EmployeeDataReviewsService(prisma as any);

    const result = await service.findAll({ page: 2, pageSize: 20, status: 'pending', keyword: '001' });

    expect(result).toEqual({ total: 1, page: 2, pageSize: 20, items: [review] });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 20,
      take: 20,
      where: expect.objectContaining({
        AND: [
          {
            OR: [
              { employeeName: { contains: '001', mode: 'insensitive' } },
              { employeeNo: { contains: '001', mode: 'insensitive' } },
            ],
          },
          {
            OR: [
              { profileReviewStatus: 'pending' },
              { performanceReviewStatus: 'pending' },
            ],
          },
        ],
      }),
    }));
  });

  it('HR补充绩效直属上级后清除该条阻断原因', async () => {
    const request = {
      id: 'review-missing-manager',
      performanceReviewStatus: 'pending',
      proposedValue: { employee: { name: '员工一' }, performance: { managerName: null } },
      validationErrors: ['绩效直属上级待设置', '其他基础档案提醒'],
    };
    const update = jest.fn().mockResolvedValue({ id: request.id, performanceReviewStatus: 'pending' });
    const prisma = {
      employeeDataChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        update,
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'manager-1', name: '主管一', deletedAt: null }),
      },
    };
    const service = new EmployeeDataReviewsService(prisma as any);

    await service.setPendingPerformanceManager('review-missing-manager', 'manager-1', operator);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'review-missing-manager' },
      data: {
        proposedValue: {
          employee: { name: '员工一' },
          performance: { managerName: '主管一', managerId: 'manager-1' },
        },
        validationErrors: ['其他基础档案提醒'],
        rejectedReason: null,
        createdById: 'hr-1',
      },
    });
  });

  it('批量审核先建立全部新员工档案，再解析同批次绩效上级', async () => {
    const requests = new Map<string, any>([
      ['review-employee', {
        id: 'review-employee', userId: null, employeeNo: '002', employeeName: '新员工',
        sourceBatchId: 'batch-1', profileReviewStatus: 'pending', performanceReviewStatus: 'pending',
        validationErrors: [],
        proposedValue: {
          employee: {
            employeeNo: '002', name: '新员工', company: 'fuede', deptId: 'dept-1', position: '专员',
            entryDate: '2026-08-01T00:00:00.000Z', employmentType: 'full_time', employeeStatus: 'active',
            managerName: '新主管',
          },
          profile: {}, contracts: [], performance: { managerName: '新主管' },
        },
      }],
      ['review-manager', {
        id: 'review-manager', userId: null, employeeNo: '001', employeeName: '新主管',
        sourceBatchId: 'batch-1', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
        validationErrors: [],
        proposedValue: {
          employee: {
            employeeNo: '001', name: '新主管', company: 'fuede', deptId: 'dept-1', position: '经理',
            entryDate: '2026-08-01T00:00:00.000Z', employmentType: 'full_time', employeeStatus: 'active',
          },
          profile: {}, contracts: [], performance: {},
        },
      }],
    ]);
    const users = new Map<string, any>();
    const userCreate = jest.fn(async ({ data }: any) => {
      const id = data.employeeNo === '001' ? 'manager-new' : 'employee-new';
      const saved = { id, ...data, deletedAt: null };
      users.set(id, saved);
      return { id };
    });
    const requestUpdate = jest.fn(async ({ where, data }: any) => {
      const request = requests.get(where.id);
      if (data.userId) request.userId = data.userId;
      if (data.profileReviewStatus) request.profileReviewStatus = data.profileReviewStatus;
      if (data.performanceReviewStatus) request.performanceReviewStatus = data.performanceReviewStatus;
      return { ...request };
    });
    const tx = {
      employeeDataChangeRequest: {
        findUnique: jest.fn(async ({ where }: any) => requests.get(where.id) ?? null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: requestUpdate,
      },
      user: {
        create: userCreate,
        update: jest.fn(async ({ where, data }: any) => {
          users.set(where.id, { ...(users.get(where.id) ?? { id: where.id }), ...data });
          return users.get(where.id);
        }),
        findMany: jest.fn(async ({ where }: any) => [...users.values()]
          .filter((user) => user.name === where.name)
          .map((user) => ({ id: user.id }))),
        findUnique: jest.fn(async ({ where }: any) => users.get(where.id) ?? null),
      },
      employeeProfile: { upsert: jest.fn() },
      employmentRecord: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      employeeContract: { createMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      employeeDataChangeRequest: {
        findMany: jest.fn(async ({ where }: any) => where.id.in.map((id: string) => requests.get(id))),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new EmployeeDataReviewsService(prisma as any);

    const result = await service.approveBatch({
      requestIds: ['review-employee', 'review-manager'],
      scopes: ['profile', 'performance'],
    }, operator);

    expect(result.failed).toEqual([]);
    expect(result.succeeded).toEqual([
      { requestId: 'review-employee', scopes: ['profile', 'performance'] },
      { requestId: 'review-manager', scopes: ['profile'] },
    ]);
    expect(users.get('employee-new')).toEqual(expect.objectContaining({ directManagerId: 'manager-new' }));
  });

  it('审核通过离职变更时停用员工和钉钉登录，但不删除员工档案', async () => {
    const request = {
      id: 'review-resigned', userId: 'employee-resigned', employeeNo: '009', employeeName: '离职员工',
      sourceBatchId: 'batch-2', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
      validationErrors: [],
      proposedValue: {
        employee: {
          employeeNo: '009', name: '离职员工', phone: null, company: 'fuede', deptId: 'dept-1',
          position: '专员', entryDate: '2024-01-01T00:00:00.000Z', leaveDate: '2026-08-24T00:00:00.000Z',
          employmentType: 'full_time', employeeStatus: 'resigned', managerId: null,
        },
        profile: {}, contracts: [], performance: {},
      },
    };
    const userUpdate = jest.fn().mockResolvedValue({ id: 'employee-resigned', status: 'resigned' });
    const userDelete = jest.fn();
    const bindingUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      employeeDataChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(async ({ data }: any) => {
          request.profileReviewStatus = data.profileReviewStatus ?? request.profileReviewStatus;
          return request;
        }),
      },
      user: { update: userUpdate, delete: userDelete },
      employeeProfile: { upsert: jest.fn() },
      employmentRecord: {
        findFirst: jest.fn().mockResolvedValue({ id: 'employment-current', effectiveFrom: new Date('2024-01-01') }),
        update: jest.fn(), create: jest.fn(),
      },
      employeeContract: { createMany: jest.fn() },
      externalIdentityBinding: { updateMany: bindingUpdate },
      auditLog: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new EmployeeDataReviewsService(prisma as any);

    const result = await service.approveBatch({ requestIds: [request.id], scopes: ['profile'] }, operator);

    expect(result.failed).toEqual([]);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'employee-resigned' },
      data: expect.objectContaining({ status: 'resigned', leaveDate: new Date('2026-08-24T00:00:00.000Z') }),
    });
    expect(bindingUpdate).toHaveBeenCalledWith({
      where: { userId: 'employee-resigned', status: 'enabled', endedAt: null },
      data: expect.objectContaining({
        status: 'disabled',
        disabledById: 'hr-1',
        disabledReason: '员工档案审核为离职',
      }),
    });
    expect(userDelete).not.toHaveBeenCalled();
  });

  it('仅修改基础档案时不重复生成任职历史', async () => {
    const baseEmployee = {
      employeeNo: '001', name: '员工一', phone: '13800000000', company: 'fuede',
      deptId: 'dept-1', position: '专员', jobGrade: 'P3', jobFamily: '运营', managerId: 'roster-manager',
      workLocation: '杭州', entryDate: '2024-01-01T00:00:00.000Z', plannedRegularDate: null,
      actualRegularDate: null, leaveDate: null, probationMonths: 3,
      employmentType: 'full_time', employeeStatus: 'active',
    };
    const existingContract = {
      id: 'contract-1', contractType: 'contract', sequence: 0, name: '劳动合同',
      signingCompany: '孚德', signedAt: '2024-01-01T00:00:00.000Z',
      effectiveFrom: '2024-01-02T00:00:00.000Z', expiresAt: '2026-12-31T00:00:00.000Z',
      termType: '3年', originalCompany: null, newCompany: null,
      confidentialityAgreement: null, nonCompeteAgreement: null, portraitAgreement: null,
    };
    const request = {
      id: 'review-profile-only', userId: 'employee-1', employeeNo: '001', employeeName: '员工一',
      sourceType: 'manual_profile_change', sourceBatchId: null,
      profileReviewStatus: 'pending', performanceReviewStatus: 'not_required', validationErrors: [],
      baseValue: {
        employee: baseEmployee, profile: { gender: '男' }, contracts: [existingContract],
        performance: { managerId: 'manager-1' },
      },
      proposedValue: {
        employee: baseEmployee, profile: { gender: '女' }, contracts: [existingContract],
        performance: { managerId: 'manager-1' },
      },
    };
    const employmentCreate = jest.fn();
    const tx = {
      employeeDataChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ ...request, profileReviewStatus: 'approved' }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          employeeNo: '001', name: '员工一', phone: '13800000000', deptId: 'dept-1', position: '专员',
          entryDate: new Date('2024-01-01T00:00:00.000Z'), plannedRegularDate: null,
          actualRegularDate: null, leaveDate: null, employmentType: 'full_time', status: 'active',
          employeeProfile: { gender: '男' },
          employeeContracts: [{
            ...existingContract,
            signedAt: new Date(existingContract.signedAt),
            effectiveFrom: new Date(existingContract.effectiveFrom),
            expiresAt: new Date(existingContract.expiresAt),
          }],
          employmentHistory: [{
            company: 'fuede', jobGrade: 'P3', jobFamily: '运营', directManagerId: 'roster-manager',
            directManager: null, workLocation: '杭州', probationMonths: 3,
          }],
        }),
        update: jest.fn().mockResolvedValue({ id: 'employee-1' }),
      },
      employeeProfile: { upsert: jest.fn().mockResolvedValue({ id: 'profile-1' }) },
      employmentRecord: { findFirst: jest.fn(), update: jest.fn(), create: employmentCreate },
      employeeContract: { createMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new EmployeeDataReviewsService(prisma as any);

    const result = await service.approveBatch({ requestIds: [request.id], scopes: ['profile'] }, operator);

    expect(result.failed).toEqual([]);
    expect(tx.employeeProfile.upsert).toHaveBeenCalled();
    expect(tx.employmentRecord.findFirst).not.toHaveBeenCalled();
    expect(employmentCreate).not.toHaveBeenCalled();
  });

  it('同一天再次审核任职变化时更新当天记录而不制造无效日期区间', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const request = {
      id: 'review-same-day-employment', userId: 'employee-1', sourceType: 'employee_roster_import',
      sourceBatchId: null, profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
      validationErrors: [], baseValue: {},
      proposedValue: {
        employee: {
          employeeNo: '001', name: '员工一', phone: null, company: 'fuede', deptId: 'dept-1',
          position: '新岗位', entryDate: '2024-01-01T00:00:00.000Z', employmentType: 'full_time',
          employeeStatus: 'active', managerId: null,
        },
        profile: {},
        contracts: [{
          sequence: 0, kind: 'contract', name: '劳动合同',
          signedAt: '2024-01-01T00:00:00.000Z', expiresAt: '2026-12-31T00:00:00.000Z',
          termText: '3年',
        }],
        performance: { managerId: null },
      },
    };
    const employmentUpdate = jest.fn();
    const employmentCreate = jest.fn();
    const tx = {
      employeeDataChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ ...request, profileReviewStatus: 'approved' }),
      },
      user: { update: jest.fn() },
      employeeProfile: { upsert: jest.fn() },
      employmentRecord: {
        findFirst: jest.fn().mockResolvedValue({ id: 'employment-today', effectiveFrom: today }),
        update: employmentUpdate,
        create: employmentCreate,
      },
      employeeContract: {
        findMany: jest.fn().mockResolvedValue([{ id: 'contract-existing', contractType: 'contract', sequence: 0 }]),
        findFirst: jest.fn().mockResolvedValue({ id: 'contract-existing' }),
        update: jest.fn(),
        create: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new EmployeeDataReviewsService(prisma as any);

    const result = await service.approveBatch({ requestIds: [request.id], scopes: ['profile'] }, operator);

    expect(result.failed).toEqual([]);
    expect(employmentUpdate).toHaveBeenCalledWith({
      where: { id: 'employment-today' },
      data: expect.objectContaining({ effectiveFrom: today, position: '新岗位', effectiveTo: null }),
    });
    expect(employmentCreate).not.toHaveBeenCalled();
    expect(tx.employeeContract.update).toHaveBeenCalledWith({
      where: { id: 'contract-existing' },
      data: expect.objectContaining({ name: '劳动合同', termType: '3年' }),
    });
    expect(tx.employeeContract.create).not.toHaveBeenCalled();
  });

  it('花名册审核将缺失合同停用但保留历史记录', async () => {
    const employee = {
      employeeNo: '001', name: '员工一', phone: null, company: 'fuede', deptId: 'dept-1',
      position: '专员', jobGrade: null, jobFamily: null, managerId: null, workLocation: null,
      entryDate: '2024-01-01T00:00:00.000Z', plannedRegularDate: null, actualRegularDate: null,
      leaveDate: null, probationMonths: null, employmentType: 'full_time', employeeStatus: 'active',
    };
    const keptContract = {
      contractType: 'contract', sequence: 0, name: '劳动合同', signedAt: '2024-01-01T00:00:00.000Z',
      expiresAt: '2026-12-31T00:00:00.000Z', termType: '3年', originalCompany: null,
      newCompany: null, confidentialityAgreement: null, nonCompeteAgreement: null, portraitAgreement: null,
    };
    const removedContract = { ...keptContract, contractType: 'confidentiality', name: '保密协议' };
    const request = {
      id: 'review-contract-removal', userId: 'employee-1', sourceType: 'employee_roster_import',
      sourceBatchId: null, profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
      validationErrors: [], baseValue: { employee, profile: {}, contracts: [keptContract, removedContract] },
      proposedValue: {
        employee, profile: {},
        contracts: [{
          kind: 'contract', sequence: 0, name: '劳动合同', signedAt: keptContract.signedAt,
          expiresAt: keptContract.expiresAt, termText: '3年', originalCompany: null,
          newCompany: null, confidentialityAgreement: null, nonCompeteAgreement: null, portraitAgreement: null,
        }],
      },
    };
    const contractUpdate = jest.fn();
    const tx = {
      employeeDataChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ ...request, profileReviewStatus: 'approved' }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          employeeNo: '001', name: '员工一', phone: null, deptId: 'dept-1', position: '专员',
          entryDate: new Date(employee.entryDate), plannedRegularDate: null, actualRegularDate: null,
          leaveDate: null, employmentType: 'full_time', status: 'active', employeeProfile: null,
          employeeContracts: [keptContract, removedContract],
          employmentHistory: [{
            company: 'fuede', jobGrade: null, jobFamily: null, directManagerId: null,
            directManager: null, workLocation: null, probationMonths: null,
          }],
        }),
        update: jest.fn(),
      },
      employeeProfile: { upsert: jest.fn() },
      employmentRecord: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
      employeeContract: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'contract-kept', contractType: 'contract', sequence: 0 },
          { id: 'contract-removed', contractType: 'confidentiality', sequence: 0 },
        ]),
        findFirst: jest.fn(),
        update: contractUpdate,
        create: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new EmployeeDataReviewsService(prisma as any);

    const result = await service.approveBatch({ requestIds: [request.id], scopes: ['profile'] }, operator);

    expect(result.failed).toEqual([]);
    expect(contractUpdate).toHaveBeenCalledWith({
      where: { id: 'contract-removed' },
      data: { isActive: false, endedAt: expect.any(Date) },
    });
  });

  it('旧合同审核不能覆盖后来已经生效的合同修订', async () => {
    const employee = {
      employeeNo: '001', name: '员工一', company: 'fuede', deptId: 'dept-1', position: '专员',
      entryDate: '2024-01-01T00:00:00.000Z', employmentType: 'full_time', employeeStatus: 'active',
    };
    const request = {
      id: 'review-stale-contract', userId: 'employee-1', sourceType: 'employee_roster_import',
      sourceBatchId: null, profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
      validationErrors: [],
      baseValue: { employee, profile: {}, contracts: [{ contractType: 'contract', sequence: 0, name: '旧合同' }] },
      proposedValue: { employee, profile: {}, contracts: [{ kind: 'contract', sequence: 0, name: '花名册合同' }] },
    };
    const userUpdate = jest.fn();
    const tx = {
      employeeDataChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          employeeNo: '001', name: '员工一', phone: null, deptId: 'dept-1', position: '专员',
          entryDate: new Date(employee.entryDate), plannedRegularDate: null, actualRegularDate: null,
          leaveDate: null, employmentType: 'full_time', status: 'active', employeeProfile: null,
          employeeContracts: [{ contractType: 'contract', sequence: 0, name: 'HR刚修订的合同' }],
          employmentHistory: [{
            company: 'fuede', jobGrade: null, jobFamily: null, directManagerId: null,
            directManager: null, workLocation: null, probationMonths: null,
          }],
        }),
        update: userUpdate,
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new EmployeeDataReviewsService(prisma as any);

    const result = await service.approveBatch({ requestIds: [request.id], scopes: ['profile'] }, operator);

    expect(result.failed).toEqual([{
      requestId: request.id,
      reason: '正式基础档案已发生变化，请重新提交审核',
    }]);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('停用合同重新出现在花名册时新建有效版本且不改写历史版本', async () => {
    const employee = {
      employeeNo: '001', name: '员工一', company: 'fuede', deptId: 'dept-1', position: '专员',
      entryDate: '2024-01-01T00:00:00.000Z', employmentType: 'full_time', employeeStatus: 'active',
    };
    const request = {
      id: 'review-contract-returned', userId: 'employee-1', sourceType: 'employee_roster_import',
      sourceBatchId: null, profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
      validationErrors: [], baseValue: { employee, profile: {}, contracts: [] },
      proposedValue: {
        employee, profile: {},
        contracts: [{ kind: 'contract', sequence: 0, name: '重新签订合同', termText: '3年' }],
      },
    };
    const contractCreate = jest.fn();
    const contractUpdate = jest.fn();
    const inactiveLookup = jest.fn().mockResolvedValue({ id: 'contract-history' });
    const tx = {
      employeeDataChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ ...request, profileReviewStatus: 'approved' }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          employeeNo: '001', name: '员工一', phone: null, deptId: 'dept-1', position: '专员',
          entryDate: new Date(employee.entryDate), plannedRegularDate: null, actualRegularDate: null,
          leaveDate: null, employmentType: 'full_time', status: 'active', employeeProfile: null,
          employeeContracts: [],
          employmentHistory: [{
            company: 'fuede', jobGrade: null, jobFamily: null, directManagerId: null,
            directManager: null, workLocation: null, probationMonths: null,
          }],
        }),
        update: jest.fn(),
      },
      employeeProfile: { upsert: jest.fn() },
      employmentRecord: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
      employeeContract: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: inactiveLookup,
        update: contractUpdate,
        create: contractCreate,
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new EmployeeDataReviewsService(prisma as any);

    const result = await service.approveBatch({ requestIds: [request.id], scopes: ['profile'] }, operator);

    expect(result.failed).toEqual([]);
    expect(inactiveLookup).not.toHaveBeenCalled();
    expect(contractUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'contract-history' } }));
    expect(contractCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'employee-1', contractType: 'contract', sequence: 0,
        name: '重新签订合同', isActive: true, endedAt: null,
      }),
    });
  });

  it('手工档案删减合同后仍按不可变合同 ID 更新保留记录', async () => {
    const update = jest.fn();
    const tx = {
      employeeContract: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'contract-a', contractType: 'contract', sequence: 0 },
          { id: 'contract-b', contractType: 'contract', sequence: 1 },
        ]),
        update,
        create: jest.fn(),
      },
    };
    const service = new EmployeeDataReviewsService({} as any);

    await (service as any).reconcileRosterContracts(
      tx,
      'employee-1',
      { companyText: '孚德' },
      [{
        id: 'contract-b',
        contractType: 'contract',
        sequence: 0,
        name: '保留的第二份合同',
        signingCompany: '孚德体育文化',
        signedAt: '2025-01-01',
        effectiveFrom: '2025-02-01',
      }],
      null,
      operator,
      'manual_archive_change',
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: 'contract-b' },
      data: expect.objectContaining({
        sequence: 0,
        name: '保留的第二份合同',
        signedAt: new Date('2025-01-01'),
        effectiveFrom: new Date('2025-02-01'),
      }),
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'contract-a' },
      data: { isActive: false, endedAt: expect.any(Date) },
    });
    expect(tx.employeeContract.create).not.toHaveBeenCalled();
  });

  it('合同并发校验覆盖签约公司、生效日期和不可变 ID', () => {
    const service = new EmployeeDataReviewsService({} as any);
    const base = [{
      id: 'contract-1', contractType: 'contract', sequence: 0, name: '劳动合同',
      signingCompany: '孚德', signedAt: '2025-01-01', effectiveFrom: '2025-01-02',
    }];

    expect((service as any).sameContractSet(base, [{ ...base[0], signingCompany: '北京孚德' }])).toBe(false);
    expect((service as any).sameContractSet(base, [{ ...base[0], effectiveFrom: '2025-02-01' }])).toBe(false);
    expect((service as any).sameContractSet(base, [{ ...base[0], id: 'contract-2' }])).toBe(false);
  });

  it('员工档案审核只解析已生效部门，不直接改写或新建组织架构', async () => {
    const update = jest.fn();
    const create = jest.fn();
    const service = new EmployeeDataReviewsService({} as any);
    const existingTx = {
      department: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'dept-1', name: '项目中心', leaderId: null, fullPath: '项目中心' },
        ]),
        update,
        create,
      },
    };

    await expect((service as any).ensureReviewedDepartmentPath(
      existingTx,
      ['项目中心'],
      'fuede',
      [{ fullPath: '项目中心', company: 'beijing_fuede', sortOrder: 99 }],
    )).resolves.toEqual({ id: 'dept-1', name: '项目中心', fullPath: '项目中心', leaderId: null });
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();

    const missingTx = {
      department: {
        findMany: jest.fn().mockResolvedValue([]),
        update,
        create,
      },
    };
    await expect((service as any).ensureReviewedDepartmentPath(
      missingTx,
      ['项目中心', '新部门'],
      'fuede',
      [],
    )).rejects.toMatchObject({
      response: expect.objectContaining({ message: '部门“项目中心”尚未通过部门架构审核' }),
    });
    expect(create).not.toHaveBeenCalled();
  });
});
