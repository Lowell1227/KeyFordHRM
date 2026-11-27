import { SysRole } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { canManageLifecycle } from '@/performance-lifecycle/lifecycle-policy';

export interface TaskViewScope {
  employeeId: string;
  managerId: string | null;
  deptHeadId: string | null;
  approverId: string | null;
}

export function canViewTask(task: TaskViewScope, viewer: AuthUser): boolean {
  return task.employeeId === viewer.id
    || task.managerId === viewer.id
    || task.deptHeadId === viewer.id
    || task.approverId === viewer.id
    || viewer.sysRole === SysRole.hr
    || viewer.sysRole === SysRole.system_admin
    || canManageLifecycle(viewer, 'view')
    || Boolean(viewer.canViewAll);
}
