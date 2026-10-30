import { EmploymentType, SysRole, UserStatus } from '@prisma/client';
import { toSystemPermission, UsersService } from './users.service';

const noBusinessIdentities = {
  getIdentitySummariesForUsers: jest.fn().mockResolvedValue(new Map()),
};

describe('UsersService', () => {
  describe('system permissions', () => {
    it('普通HR使用独立系统权限标签而不是标准用户', () => {
      expect(toSystemPermission('hr_user' as SysRole)).toBe('hr_user');
    });
  });

  describe('findAll', () => {
    it('员工列表一人一行，并返回钉钉关联三态', async () => {
      const user = {
        id: 'employee-1',
        employeeNo: '001',
        name: '李宏',
        phone: null,
        email: null,
        avatarUrl: null,
        deptId: 'dept-1',
        dept: { name: '总经办' },
        position: '董事长',
        sysRole: SysRole.chairman,
        status: UserStatus.active,
        employmentType: EmploymentType.full_time,
        directManagerId: null,
        directManager: null,
        isAssessorOnly: false,
        canViewAll: true,
        entryDate: new Date('2001-01-01T00:00:00.000Z'),
        externalIdentityBindings: [{ status: 'disabled' }],
      };
      const service = new UsersService(
        {
          user: {
            count: jest.fn().mockResolvedValue(1),
            findMany: jest.fn().mockResolvedValue([user]),
            groupBy: jest.fn().mockResolvedValue([]),
          },
          employeeDataChangeRequest: { findMany: jest.fn().mockResolvedValue([]) },
        } as any,
        { getVisibleEmployeeFilter: jest.fn().mockResolvedValue({}) } as any,
        {
          getIdentitySummariesForUsers: jest.fn().mockResolvedValue(new Map([
            ['employee-1', [
              { type: 'department_leader', label: '部门负责人', count: 1 },
              { type: 'performance_approver', label: '分管领导', count: 2 },
            ]],
          ])),
        } as any,
      );

      const result = await service.findAll({ page: 1, pageSize: 20, skip: 0, take: 20 } as any, {
        id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(expect.objectContaining({
        id: 'employee-1',
        dingtalkBindingState: 'disabled',
        systemPermission: 'standard_user',
        businessIdentities: [
          { type: 'department_leader', label: '部门负责人', count: 1 },
          { type: 'performance_approver', label: '分管领导', count: 2 },
        ],
      }));
      expect((service as any).prisma.user.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          accountType: 'employee',
          archivedAt: null,
          status: { not: 'resigned' },
        }),
      });
    });

    it('已归档视图只返回已离职且已归档员工', async () => {
      const count = jest.fn().mockResolvedValue(0);
      const findMany = jest.fn().mockResolvedValue([]);
      const service = new UsersService(
        { user: { count, findMany } } as any,
        { getVisibleEmployeeFilter: jest.fn().mockResolvedValue({}) } as any,
        noBusinessIdentities as any,
      );

      await service.findAll({
        page: 1, pageSize: 20, skip: 0, take: 20, archived: true,
      } as any, {
        id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null,
        isAssessorOnly: false, canViewAll: true,
      });

      expect(count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          archivedAt: { not: null },
          status: UserStatus.resigned,
        }),
      });
    });

    it('全部分类返回所有未归档员工并包含已离职员工', async () => {
      const count = jest.fn().mockResolvedValue(0);
      const findMany = jest.fn().mockResolvedValue([]);
      const service = new UsersService(
        { user: { count, findMany } } as any,
        { getVisibleEmployeeFilter: jest.fn().mockResolvedValue({}) } as any,
        noBusinessIdentities as any,
      );

      await service.findAll({
        page: 1, pageSize: 20, skip: 0, take: 20, includeResigned: true,
      } as any, {
        id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null,
        isAssessorOnly: false, canViewAll: true,
      });

      const where = count.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ archivedAt: null }));
      expect(where).not.toHaveProperty('status');
    });

    it('未分配人员筛选只查询根节点人员且不展开部门范围', async () => {
      const count = jest.fn().mockResolvedValue(0);
      const findMany = jest.fn().mockResolvedValue([]);
      const getSubDeptIds = jest.fn();
      const service = new UsersService(
        { user: { count, findMany } } as any,
        {
          getSubDeptIds,
          getVisibleEmployeeFilter: jest.fn().mockResolvedValue({}),
        } as any,
        noBusinessIdentities as any,
      );

      await service.findAll({
        page: 1, pageSize: 20, skip: 0, take: 20, unassigned: true,
      } as any, {
        id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null,
        isAssessorOnly: false, canViewAll: true,
      });

      expect(count).toHaveBeenCalledWith({
        where: expect.objectContaining({ deptId: null }),
      });
      expect(getSubDeptIds).not.toHaveBeenCalled();
    });

    it.each([
      { label: 'HR全量范围', scope: {} },
      { label: '受限人员范围', scope: { deptId: { in: ['visible-dept'] } } },
    ])('按$label一次统计当前页直属下属，未匹配人员返回0', async ({ scope }) => {
      const managers = ['manager-1', 'manager-2'].map((id) => ({
        id, employeeNo: null, name: id, phone: null, email: null, avatarUrl: null,
        deptId: 'manager-dept', dept: { name: '管理部门' }, position: '负责人',
        sysRole: SysRole.employee, hrCapabilities: [], status: UserStatus.active,
        employmentType: EmploymentType.full_time, directManagerId: null, directManager: null,
        isAssessorOnly: false, canViewAll: false, entryDate: null, archivedAt: null,
        externalIdentityBindings: [], employeeNumberAssignments: [], employeeChangeRequests: [],
      }));
      const groupBy = jest.fn().mockResolvedValue([
        { directManagerId: 'manager-1', _count: { _all: 2 } },
      ]);
      const service = new UsersService({ user: {
        count: jest.fn().mockResolvedValue(2), findMany: jest.fn().mockResolvedValue(managers), groupBy,
      } } as any, {
        getVisibleEmployeeFilter: jest.fn().mockResolvedValue(scope),
        getSubDeptIds: jest.fn().mockResolvedValue(['manager-dept']),
      } as any, noBusinessIdentities as any);

      const result = await service.findAll({
        page: 2, pageSize: 2, skip: 2, take: 2, keyword: '负责人', deptId: 'manager-dept',
      } as any, { id: 'viewer', sysRole: SysRole.employee } as any);

      expect(result.items.map(({ id, directReportCount }) => [id, directReportCount]))
        .toEqual([['manager-1', 2], ['manager-2', 0]]);
      expect(groupBy).toHaveBeenCalledTimes(1);
      expect(groupBy).toHaveBeenCalledWith({
        by: ['directManagerId'],
        where: {
          directManagerId: { in: ['manager-1', 'manager-2'] },
          deletedAt: null, archivedAt: null, accountType: 'employee',
          status: { in: ['active', 'probation'] },
          ...(Object.keys(scope).length ? { AND: [scope] } : {}),
        },
        _count: { _all: true },
      });
    });

    it('空页不查询直属下属统计', async () => {
      const groupBy = jest.fn();
      const service = new UsersService({ user: {
        count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), groupBy,
      } } as any, { getVisibleEmployeeFilter: jest.fn().mockResolvedValue({}) } as any,
      noBusinessIdentities as any);

      expect((await service.findAll({ page: 1, pageSize: 20 } as any,
        { id: 'viewer', sysRole: SysRole.employee } as any)).items).toEqual([]);
      expect(groupBy).not.toHaveBeenCalled();
    });
  });

  describe('archive warnings', () => {
    const hr = { id: 'hr-1', name: 'HR', sysRole: SysRole.hr_user, hrCapabilities: ['employee_archive_review'],
      deptId: null, isAssessorOnly: false, canViewAll: false };
    const query = { page: 1, pageSize: 20, skip: 0, take: 20 } as any;
    const phoneWarning = { field: 'profile.phone', message: '联系电话待补充', code: 'missing', source: { row: 2 } };

    function setup(formal: Record<string, any> = {}, warnings: Record<string, any>[] = [phoneWarning]) {
      const user = { id: 'employee-1', employeeNo: '001', name: '测试员工', phone: null, email: null,
        avatarUrl: null, deptId: 'dept-1', dept: { name: '人事部' }, position: '专员', sysRole: SysRole.employee,
        hrCapabilities: [], status: UserStatus.active, employmentType: EmploymentType.full_time,
        directManagerId: null, directManager: null, isAssessorOnly: false, canViewAll: false,
        entryDate: null, archivedAt: null, externalIdentityBindings: [], employeeNumberAssignments: [],
        employeeChangeRequests: [{ id: 'pending-1', profileReviewStatus: 'pending', proposedValue: { profile: { phone: '测试草稿' } } }],
      };
      const requests: Array<Record<string, any>> = [{ id: 'initial-1', userId: user.id, sourceSystem: 'roster_initialization',
        profileReviewStatus: 'approved', appliedAt: new Date('2026-09-01'), validationWarnings: warnings,
        proposedValue: { employee: { companyText: null }, profile: { phone: null } },
        user: { employeeProfile: { phone: null }, employmentHistory: [{ company: 'fuede', companyText: null }],
          employeeContracts: [], ...formal },
      }];
      const prisma = { user: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([user]),
        groupBy: jest.fn().mockResolvedValue([]) },
        employeeDataChangeRequest: { findMany: jest.fn().mockResolvedValue(requests) } };
      const service = new UsersService(prisma as any,
        { getVisibleEmployeeFilter: jest.fn().mockResolvedValue({ deptId: 'dept-1' }) } as any,
        noBusinessIdentities as any);
      return { service, prisma, user, requests };
    }

    it('档案审核人员只获得本页已生效初始化问题的安全字段，重复问题合并', async () => {
      const { service, prisma } = setup({}, [phoneWarning, phoneWarning]);
      const result = await service.findAll(query, hr);
      expect(result.items[0]).toHaveProperty('archiveWarnings', [{ field: 'profile.phone', message: '联系电话待补充' }]);
      expect(prisma.employeeDataChangeRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ userId: { in: ['employee-1'] }, sourceSystem: { in: ['roster_initialization', 'roster_reconcile_20261030'] },
          profileReviewStatus: 'approved', appliedAt: { not: null } }),
      }));
      expect(prisma.user.findMany.mock.calls[0][0].where.AND).toEqual([{ deptId: 'dept-1' }]);
    });

    it('普通员工即使能读名册也不读取或返回档案问题', async () => {
      const { service, prisma } = setup();
      const result = await service.findAll(query, { ...hr, sysRole: SysRole.employee, hrCapabilities: [] });
      expect(result.items[0]).not.toHaveProperty('archiveWarnings');
      expect(prisma.employeeDataChangeRequest.findMany).not.toHaveBeenCalled();
    });

    it('待审核提议不能清除历史问题，正式字段填妥后才消除', async () => {
      const { service, requests } = setup();
      expect((await service.findAll(query, hr)).items[0]).toHaveProperty('archiveWarnings', [
        { field: 'profile.phone', message: '联系电话待补充' },
      ]);
      requests[0].user.employeeProfile.phone = '已审核测试号码';
      expect((await service.findAll(query, hr)).items[0]).toHaveProperty('archiveWarnings', []);
    });

    it('无关字段完善或默认公司枚举不能消除原字段问题', async () => {
      const { service } = setup({ employeeProfile: { phone: null, education: '本科' } }, [
        phoneWarning, { field: 'employee.companyText', message: '公司待补充', code: 'missing' },
        { field: 'contracts.latestSummary', message: '合同摘要待核对', code: 'review' },
      ]);
      expect((await service.findAll(query, hr)).items[0]).toHaveProperty('archiveWarnings', [
        { field: 'profile.phone', message: '联系电话待补充' },
        { field: 'employee.companyText', message: '公司待补充' },
        { field: 'contracts.latestSummary', message: '合同摘要待核对' },
      ]);
    });

    it('合同问题只随同一合同的对应字段完善而消除', async () => {
      const { service, requests } = setup({ employeeContracts: [
        { id: 'contract-1', sequence: 1, signedAt: null, expiresAt: new Date('2028-01-01') },
        { id: 'contract-2', sequence: 2, signedAt: new Date('2026-01-01') },
      ] }, [{ field: 'contracts.signedAt', message: '第一次合同签订日期待补充', code: 'invalid_date', contractId: 'contract-1' }]);
      expect((await service.findAll(query, hr)).items[0]).toHaveProperty('archiveWarnings', [
        { field: 'contracts.signedAt', message: '第一次合同签订日期待补充' },
      ]);
      requests[0].user.employeeContracts[0].signedAt = new Date('2025-01-01');
      expect((await service.findAll(query, hr)).items[0]).toHaveProperty('archiveWarnings', []);
    });

    it('证件缺失不因银行卡或待审核证件内容消除，正式证件指纹只消除缺失提示', async () => {
      const { service, requests, user } = setup({ employeeProfile: { idNumberFingerprint: null, bankAccountFingerprint: 'test-bank-fingerprint' } }, [
        { field: 'profile.idNumber', message: '身份证号待补充', code: 'missing' },
        { field: 'profile.idNumber', message: '身份证号待核对', code: 'review' },
      ]);
      user.employeeChangeRequests[0].proposedValue.profile = { idNumberFingerprint: 'pending-id-fingerprint' } as any;
      expect((await service.findAll(query, hr)).items[0]).toHaveProperty('archiveWarnings', [
        { field: 'profile.idNumber', message: '身份证号待补充' },
        { field: 'profile.idNumber', message: '身份证号待核对' },
      ]);
      requests[0].user.employeeProfile.idNumberFingerprint = 'formal-id-fingerprint';
      expect((await service.findAll(query, hr)).items[0]).toHaveProperty('archiveWarnings', [
        { field: 'profile.idNumber', message: '身份证号待核对' },
      ]);
    });

    it('花名册主管只随正式任职主管完善而消除，不借用绩效直属上级', async () => {
      const { service, requests, user } = setup({ employmentHistory: [{ directManagerId: null, jobFamily: '人事' }] }, [
        { field: 'employee.managerId', message: '花名册直属主管待核对', code: 'missing' },
        { field: 'employee.jobFamily', message: '职系待补充', code: 'missing' },
      ]);
      (user as any).directManagerId = 'performance-manager';
      expect((await service.findAll(query, hr)).items[0]).toHaveProperty('archiveWarnings', [
        { field: 'employee.managerId', message: '花名册直属主管待核对' },
      ]);
      requests[0].user.employmentHistory[0].directManagerId = 'roster-manager';
      expect((await service.findAll(query, hr)).items[0]).toHaveProperty('archiveWarnings', []);
    });
  });

  describe('updateManager', () => {
    it('rejects the legacy direct manager update so the HR review cannot be bypassed', async () => {
      const target = {
        id: 'employee-1',
        employeeNo: null,
        name: '余焱玲',
        sysRole: SysRole.employee,
        status: UserStatus.active,
        deptId: 'hr-dept',
        directManagerId: null,
      };
      const transaction = jest.fn(async (callback: (tx: unknown) => unknown) => callback({
        user: { update: jest.fn().mockResolvedValue({ ...target, directManagerId: 'manager-1' }) },
      }));
      const service = new UsersService(
        {
          user: {
            findUnique: jest.fn().mockResolvedValue(target),
          },
          $transaction: transaction,
        } as any,
        {} as any,
        noBusinessIdentities as any,
      );

      await expect((service.updateManager as any)(
        target.id,
        { directManagerId: 'manager-1', grantManagerRole: true },
        {
          id: 'admin-1',
          name: '系统管理员',
          sysRole: SysRole.system_admin,
          deptId: null,
          isAssessorOnly: false,
          canViewAll: true,
        },
      )).rejects.toMatchObject({
        response: { code: 4001, message: '绩效直属上级变更必须提交 HR 审核' },
      });

      expect(transaction).not.toHaveBeenCalled();
    });

    it('rejects directManagerId in the combined settings endpoint', async () => {
      const target = {
        id: 'employee-1', employeeNo: null, name: '员工一', sysRole: SysRole.employee,
        status: UserStatus.active, deptId: 'dept-1', directManagerId: null,
      };
      const service = new UsersService({
        user: {
          findUnique: jest.fn()
            .mockResolvedValueOnce(target)
            .mockResolvedValueOnce({ id: 'manager-1' })
            .mockResolvedValueOnce({ directManagerId: null }),
        },
        $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback({
          user: { update: jest.fn().mockResolvedValue({ ...target, directManagerId: 'manager-1' }) },
        })),
      } as any, {} as any, noBusinessIdentities as any);

      await expect((service as any).updateSettings(
        'employee-1',
        { directManagerId: 'manager-1' },
        {
          id: 'admin-1', name: '系统管理员', sysRole: SysRole.system_admin,
          deptId: null, isAssessorOnly: false, canViewAll: true,
        },
      )).rejects.toMatchObject({
        response: { code: 4001, message: '绩效直属上级变更必须提交 HR 审核' },
      });
    });

    it('rejects legacy business roles as system permissions', async () => {
      const target = {
        id: 'employee-1',
        employeeNo: null,
        name: '余焱玲',
        sysRole: SysRole.employee,
        status: UserStatus.active,
        deptId: 'hr-dept',
        directManagerId: null,
      };
      const transactionUpdate = jest.fn()
        .mockResolvedValueOnce({ ...target, sysRole: SysRole.manager });
      const service = new UsersService(
        {
          user: {
            findUnique: jest.fn().mockResolvedValueOnce(target),
          },
          $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback({
            user: { update: transactionUpdate },
          })),
        } as any,
        {} as any,
        noBusinessIdentities as any,
      );

      await expect((service as any).updateSettings(
        target.id,
        { sysRole: SysRole.manager },
        {
          id: 'admin-1', name: '系统管理员', sysRole: SysRole.system_admin,
          deptId: null, isAssessorOnly: false, canViewAll: true,
        },
      )).rejects.toMatchObject({
        response: { message: '系统权限仅支持标准用户、普通 HR、HR 管理员或系统管理员' },
      });

      expect(transactionUpdate).not.toHaveBeenCalled();
    });
  });

  describe('findSubordinates', () => {
    it('returns the real direct-report roster with organization display fields', async () => {
      const findMany = jest.fn().mockResolvedValue([
        {
          id: 'employee-1',
          employeeNo: null,
          name: '俞丹',
          avatarUrl: null,
          sysRole: SysRole.employee,
          status: UserStatus.active,
          deptId: 'hr-dept',
          dept: { name: '人事部' },
          position: '人事专员',
          directManagerId: 'manager-1',
        },
      ]);
      const service = new UsersService(
        { user: { findMany } } as any,
        { getVisibleEmployeeFilter: jest.fn().mockResolvedValue({}) } as any,
        noBusinessIdentities as any,
      );

      const result = await service.findSubordinates('manager-1', {
        id: 'manager-1',
        name: '姚瑶',
        sysRole: SysRole.manager,
        deptId: 'hr-dept',
        isAssessorOnly: false,
        canViewAll: false,
      });

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          directManagerId: 'manager-1',
          deletedAt: null,
          archivedAt: null,
          accountType: 'employee',
          status: { in: ['active', 'probation'] },
        },
        select: expect.objectContaining({
          avatarUrl: true,
          dept: { select: { name: true } },
          position: true,
        }),
      }));
      expect(result).toEqual([
        expect.objectContaining({
          id: 'employee-1',
          name: '俞丹',
          deptName: '人事部',
          position: '人事专员',
          directManagerId: 'manager-1',
        }),
      ]);
    });

    it.each(['employee_archive_edit', 'employee_archive_review', 'organization_edit'])(
      '保留%s查看下属资格并叠加人员可见范围', async (capability) => {
        const scope = { deptId: { in: ['visible-dept'] } };
        const findMany = jest.fn().mockResolvedValue([]);
        const service = new UsersService({ user: { findMany } } as any,
          { getVisibleEmployeeFilter: jest.fn().mockResolvedValue(scope) } as any,
          noBusinessIdentities as any);

        await expect(service.findSubordinates('other-manager', {
          id: 'hr-user', sysRole: SysRole.hr_user, hrCapabilities: [capability], canViewAll: false,
        } as any)).resolves.toEqual([]);
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
          directManagerId: 'other-manager', deletedAt: null, archivedAt: null,
          status: { in: ['active', 'probation'] }, accountType: 'employee', AND: [scope],
        } }));
      },
    );

    it.each([
      { id: 'manager-1', sysRole: SysRole.employee, canViewAll: false },
      { id: 'hr', sysRole: SysRole.hr, canViewAll: false },
      { id: 'admin', sysRole: SysRole.system_admin, canViewAll: false },
      { id: 'viewer', sysRole: SysRole.employee, canViewAll: true },
    ])('保留已有$id查看下属资格', async (viewer) => {
      const service = new UsersService({ user: { findMany: jest.fn().mockResolvedValue([]) } } as any,
        { getVisibleEmployeeFilter: jest.fn().mockResolvedValue({}) } as any,
        noBusinessIdentities as any);
      await expect(service.findSubordinates('manager-1', viewer as any)).resolves.toEqual([]);
    });

    it('拒绝无关员工和无人员管理能力的HR查询其他人的下属', async () => {
      const findMany = jest.fn();
      const service = new UsersService({ user: { findMany } } as any, {} as any,
        noBusinessIdentities as any);
      for (const viewer of [
        { id: 'other', sysRole: SysRole.employee },
        { id: 'other-hr', sysRole: SysRole.hr_user, hrCapabilities: ['cycle_plan_edit'] },
      ]) {
        await expect(service.findSubordinates('manager-1', viewer as any))
          .rejects.toMatchObject({ response: { code: 4003 } });
      }
      expect(findMany).not.toHaveBeenCalled();
    });
  });
});
