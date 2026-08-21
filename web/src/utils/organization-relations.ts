import type { Department, User } from '@/types/api.types';

type RelationUser = Pick<User, 'id' | 'deptId' | 'directManagerId'>;
type RelationDepartment = Pick<Department, 'id' | 'parentId' | 'leaderId'>;

/** 根部门负责人就是组织最高负责人，不要求再设置直属主管。 */
export function isTopLevelDepartmentLeader(
  user: RelationUser,
  departments: RelationDepartment[],
): boolean {
  if (user.directManagerId || !user.deptId) return false;
  const department = departments.find((item) => item.id === user.deptId);
  return Boolean(department && department.parentId == null && department.leaderId === user.id);
}
