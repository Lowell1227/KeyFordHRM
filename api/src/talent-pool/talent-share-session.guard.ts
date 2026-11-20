import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '@/auth/auth.service';
import type { AuthUser, JwtPayload } from '@/common/types/auth.types';

/** Only share views accept a guest; legacy access still requires a validated current session. */
@Injectable()
export class TalentShareSessionGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string }; user?: AuthUser }>();
    request.user = undefined;
    const [kind, token] = request.headers.authorization?.split(' ') ?? [];
    if (kind === 'Bearer' && token) {
      try {
        request.user = await this.auth.validateSession(await this.jwt.verifyAsync<JwtPayload>(token));
      } catch { /* Invalid saved credentials remain guests; the share service enforces legacy restrictions. */ }
    }
    return true;
  }
}
