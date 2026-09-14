import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthUser } from '@/common/types/auth.types';
import { ERROR_CODE } from '@/common/constants/error-codes';

export function canManageAppealLedger(viewer: AuthUser): boolean {
  return viewer.sysRole === 'hr' || (viewer.sysRole === 'hr_user'
    && Boolean(viewer.hrCapabilities?.includes('cycle_plan_edit') && viewer.hrCapabilities.includes('performance_publish')));
}

@Injectable()
export class AppealsAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const viewer = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (viewer && canManageAppealLedger(viewer)) return true;
    throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅 HR 管理员或绩效专员可访问申诉台账' });
  }
}
