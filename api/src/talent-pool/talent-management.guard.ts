import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/types/auth.types';

@Injectable()
export class TalentManagementGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    // JWT validation refreshes this flag; business writes still recheck after their row locks.
    if (!user?.id || user.isAssessorOnly) throw new ForbiddenException('仅评审账号不可管理或全量查看招聘资料');
    return true;
  }
}
