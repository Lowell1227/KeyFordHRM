import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SysRole } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ERROR_CODE } from '../constants/error-codes';
import { AuthUser } from '../types/auth.types';

/**
 * 角色守卫（菜单/操作级）。读取 @Roles() 元数据，校验当前用户 sysRole。
 * 无 @Roles() 的受保护接口默认放行（仅需登录）。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<SysRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser;
    if (user && required.includes(user.sysRole)) return true;

    throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权限执行此操作' });
  }
}
