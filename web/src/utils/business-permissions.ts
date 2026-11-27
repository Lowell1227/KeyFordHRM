import type { CurrentUser, HrCapability } from '@/types/api.types';

export function maintainedHrCapabilities(role: CurrentUser['sysRole'], capabilities: readonly HrCapability[]): HrCapability[] {
  if (role === 'hr_user') return [...capabilities].sort();
  const explicit = ['recruitment_view', 'recruitment_edit', 'recruitment_demand_review', 'talent_hiring_confirm'];
  if (role === 'hr' || role === 'system_admin') explicit.push('cycle_terminate');
  return capabilities.filter(capability => explicit.includes(capability)).sort();
}

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
