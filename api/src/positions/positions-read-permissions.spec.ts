import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SysRole } from '@prisma/client';
import { RolesGuard } from '@/common/guards/roles.guard';
import { PositionsController } from './positions.controller';

describe('position catalog read permissions', () => {
  const guard = new RolesGuard(new Reflector());
  const context = (sysRole: SysRole, hrCapabilities: string[]) => ({
    getClass: () => PositionsController,
    getHandler: () => PositionsController.prototype.findAll,
    switchToHttp: () => ({ getRequest: () => ({ user: { sysRole, hrCapabilities } }) }),
  }) as any;
  it.each(['organization_edit', 'employee_archive_edit', 'employee_archive_review'])('lets HR read with %s', capability => {
    expect(guard.canActivate(context(SysRole.hr_user, [capability]))).toBe(true);
  });
  it('rejects employee capability spoofing', () => {
    expect(() => guard.canActivate(context(SysRole.employee, ['organization_edit']))).toThrow(ForbiddenException);
  });
});
