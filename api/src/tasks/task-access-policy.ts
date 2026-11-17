import { SysRole } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';

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
    || Boolean(viewer.canViewAll);
}
