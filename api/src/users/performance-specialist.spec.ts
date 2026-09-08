import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';
import { UserQueryDto } from './dto/user-query.dto';

describe('assigning performance specialist', () => {
  it('offers only active cycle owners while retaining the employee visibility scope', async () => {
    const prisma = { user: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) } };
    const scope = { deptId: { in: ['allowed-dept'] } };
    const service = new UsersService(prisma as any,
      { getVisibleEmployeeFilter: jest.fn().mockResolvedValue(scope) } as any,
      { getIdentitySummariesForUsers: jest.fn().mockResolvedValue(new Map()) } as any);
    await service.findAll(Object.assign(new UserQueryDto(), { eligibleFor: 'cycle_owner' }), { id: 'admin', sysRole: 'system_admin' } as any);
    expect(prisma.user.findMany.mock.calls[0][0].where.AND).toEqual([scope, {
      status: { not: 'resigned' }, OR: [
        { sysRole: 'hr' }, { sysRole: 'hr_user', hrCapabilities: { has: 'cycle_plan_edit' } },
      ],
    }]);
  });
  it('validates the shared HR capability set and rejects unknown grants', async () => {
    expect(await validate(plainToInstance(UpdateUserSettingsDto, { hrCapabilities: ['cycle_plan_edit', 'performance_publish', 'performance_calibration'] }))).toEqual([]);
    expect(await validate(plainToInstance(UpdateUserSettingsDto, { hrCapabilities: ['result_approval'] }))).not.toHaveLength(0);
  });
  it('only admin may assign and the exact permission change is audited', async () => {
    const target = { id: 'target', name: '专员', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'], status: 'active' };
    const updated = { ...target, hrCapabilities: ['employee_archive_edit', 'cycle_plan_edit', 'performance_publish'] };
    const tx = { user: { update: jest.fn().mockResolvedValue(updated) }, auditLog: { create: jest.fn() } };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(target) }, $transaction: jest.fn((fn) => fn(tx)) };
    const service = new UsersService(prisma as any, {} as any, {} as any);
    const dto = { hrCapabilities: updated.hrCapabilities };
    await expect(service.updateSettings('target', dto, { id: 'hr', sysRole: 'hr' } as any)).rejects.toThrow(ForbiddenException);
    expect(tx.user.update).not.toHaveBeenCalled();
    await service.updateSettings('target', dto, { id: 'admin', sysRole: 'system_admin' } as any);
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: {
      userId: 'admin', action: 'user_permissions_updated', entityType: 'user', entityId: 'target',
      oldValue: { sysRole: 'hr_user', hrCapabilities: target.hrCapabilities },
      newValue: { sysRole: 'hr_user', hrCapabilities: updated.hrCapabilities },
    } });
  });
});
