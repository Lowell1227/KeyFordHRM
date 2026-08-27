import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ERROR_CODE } from '../constants/error-codes';
import { AuthUser, JwtPayload } from '../types/auth.types';

/**
 * 全局 JWT 鉴权守卫。验证 Authorization: Bearer <token>，解析后挂到 req.user。
 * @Public() 标记的路由跳过。失败抛 401（业务码 4010）。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);
    if (!token) {
      throw new UnauthorizedException({ code: ERROR_CODE.UNAUTHORIZED, message: '未登录或令牌缺失' });
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      const user: AuthUser = {
        id: payload.sub,
        name: payload.name,
        sysRole: payload.sysRole,
        deptId: payload.deptId,
        isAssessorOnly: payload.isAssessorOnly,
        canViewAll: payload.canViewAll,
        hrCapabilities: payload.hrCapabilities ?? [],
      };
      (req as Request & { user: AuthUser }).user = user;
      return true;
    } catch {
      throw new UnauthorizedException({ code: ERROR_CODE.UNAUTHORIZED, message: '令牌无效或已过期' });
    }
  }

  private extractToken(req: Request): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const [type, token] = auth.split(' ');
    return type === 'Bearer' && token ? token : null;
  }
}
