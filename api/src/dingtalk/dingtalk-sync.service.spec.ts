import { GoneException } from '@nestjs/common';
import { DingtalkSyncService } from './dingtalk-sync.service';

describe('DingtalkSyncService', () => {
  it('拒绝组织同步且不读取钉钉组织、不写 HRM 主数据', () => {
    const dingtalk = {
      fetchDepartments: jest.fn(),
      fetchUsersByDepartment: jest.fn(),
      fetchUserDetail: jest.fn(),
    };
    const prisma = {
      department: {
        findMany: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const service = new DingtalkSyncService(dingtalk as any, prisma as any);

    expect(() => service.runSync('operator-1')).toThrow(GoneException);
    expect(dingtalk.fetchDepartments).not.toHaveBeenCalled();
    expect(dingtalk.fetchUsersByDepartment).not.toHaveBeenCalled();
    expect(prisma.department.upsert).not.toHaveBeenCalled();
    expect(prisma.user.upsert).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});
