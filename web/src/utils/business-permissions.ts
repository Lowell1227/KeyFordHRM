import type { CurrentUser } from '@/types/api.types';

type ApprovalPermissionUser = Pick<CurrentUser, 'sysRole' | 'businessCapabilities'>;

export function canOperatePerformanceApproval(user: ApprovalPermissionUser): boolean {
  return Boolean(user.businessCapabilities?.canOperatePerformanceApproval);
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
