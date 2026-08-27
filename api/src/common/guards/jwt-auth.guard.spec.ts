import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { SysRole } from '@prisma/client';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  it('restores HR capabilities from the signed token into the request user', async () => {
    const request = { headers: { authorization: 'Bearer signed-token' } } as any;
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({
        sub: 'user-1',
        name: '普通 HR',
        sysRole: SysRole.hr_user,
        deptId: 'dept-1',
        isAssessorOnly: false,
        canViewAll: false,
        hrCapabilities: ['employee_archive_edit', 'organization_edit'],
      }),
    };
    const context = {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const guard = new JwtAuthGuard(reflector as unknown as Reflector, jwt as unknown as JwtService);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(expect.objectContaining({
      sysRole: SysRole.hr_user,
      hrCapabilities: ['employee_archive_edit', 'organization_edit'],
    }));
  });
});
