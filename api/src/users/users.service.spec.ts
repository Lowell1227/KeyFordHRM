import { EmploymentType, SysRole, UserStatus } from '@prisma/client';
import { UsersService } from './users.service';

describe('UsersService', () => {
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
          },
        } as any,
        { getVisibleEmployeeFilter: jest.fn().mockResolvedValue({}) } as any,
      );

      const result = await service.findAll({ page: 1, pageSize: 20, skip: 0, take: 20 } as any, {
        id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(expect.objectContaining({
        id: 'employee-1',
        dingtalkBindingState: 'disabled',
      }));
      expect((service as any).prisma.user.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          accountType: 'employee',
          status: { not: 'resigned' },
        }),
      });
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
      } as any, {} as any);

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

    it('keeps an explicit system role change independent from the performance relationship', async () => {
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
      );

      const result = await (service as any).updateSettings(
        target.id,
        {
          sysRole: SysRole.manager,
        },
        {
          id: 'admin-1',
          name: '系统管理员',
          sysRole: SysRole.system_admin,
          deptId: null,
          isAssessorOnly: false,
          canViewAll: true,
        },
      );

      expect(transactionUpdate).toHaveBeenNthCalledWith(1, {
        where: { id: target.id },
        data: {
          sysRole: SysRole.manager,
        },
      });
      expect(transactionUpdate).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expect.objectContaining({
        sysRole: SysRole.manager,
      }));
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
        {} as any,
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
          status: UserStatus.active,
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
  });
});
