import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '@/common/guards/roles.guard';
import { TalentsController } from './talents.controller';

describe('分享接收人静态路由与既有维护权限', () => {
  const handler = Reflect.get(TalentsController.prototype, 'shareRecipients');

  it('静态share-recipients在:id之前注册，不进入UUID详情路由', () => {
    expect(typeof handler).toBe('function');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('share-recipients');
    const names = Object.getOwnPropertyNames(TalentsController.prototype);
    expect(names.indexOf('shareRecipients')).toBeLessThan(names.indexOf('detail'));
  });

  it('仅既有人才维护权限可搜索，不给接收人开放人才库搜索', () => {
    expect(typeof handler).toBe('function');
    const guard = new RolesGuard(new Reflector());
    const ctx = (sysRole: string, hrCapabilities: string[] = []) => ({
      getHandler: () => handler, getClass: () => TalentsController,
      switchToHttp: () => ({ getRequest: () => ({ user: { sysRole, hrCapabilities } }) }),
    }) as never;
    for (const role of ['hr', 'system_admin']) expect(guard.canActivate(ctx(role))).toBe(true);
    expect(guard.canActivate(ctx('hr_user', ['employee_archive_edit']))).toBe(true);
    for (const role of ['employee', 'manager', 'dept_head', 'vp', 'hr_user']) {
      expect(() => guard.canActivate(ctx(role))).toThrow(ForbiddenException);
    }
    expect(() => guard.canActivate(ctx('hr_user', ['employee_archive_review']))).toThrow(ForbiddenException);
  });
});
