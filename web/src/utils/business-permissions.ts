import type { CurrentUser } from '@/types/api.types';

type ApprovalPermissionUser = Pick<CurrentUser, 'sysRole' | 'businessCapabilities'>;

export function canMaintainContractSubjects(
  user: Pick<CurrentUser, 'sysRole' | 'hrCapabilities'> | null | undefined,
): boolean {
  return user?.sysRole === 'system_admin' || user?.sysRole === 'hr'
    || (user?.sysRole === 'hr_user' && Boolean(user.hrCapabilities?.includes('employee_archive_edit')));
}

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
