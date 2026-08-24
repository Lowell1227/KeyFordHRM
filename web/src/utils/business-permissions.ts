import type { CurrentUser } from '@/types/api.types';

type ApprovalPermissionUser = Pick<CurrentUser, 'sysRole' | 'businessCapabilities'>;

export function canOperatePerformanceApproval(user: ApprovalPermissionUser): boolean {
  if (user.businessCapabilities) {
    return user.businessCapabilities.canOperatePerformanceApproval;
  }
  return ['vp', 'chairman', 'system_admin'].includes(user.sysRole);
}

export function canOperatePerformanceApprovalTask(
  user: ApprovalPermissionUser & Pick<CurrentUser, 'id'>,
  approverId: string | null | undefined,
): boolean {
  return Boolean(
    approverId
    && approverId === user.id
    && canOperatePerformanceApproval(user),
  );
}
