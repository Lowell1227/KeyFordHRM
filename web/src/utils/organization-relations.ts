import type { Department, User } from '@/types/api.types';

type RelationUser = Pick<User, 'id' | 'deptId' | 'directManagerId'>;
type RelationDepartment = Pick<Department, 'id' | 'parentId' | 'leaderId'>;

/** 根部门负责人就是组织最高负责人，可不设置绩效直属上级。 */
export function isTopLevelDepartmentLeader(
  user: RelationUser,
  departments: RelationDepartment[],
): boolean {
  if (!user.deptId) return false;
  const department = departments.find((item) => item.id === user.deptId);
  return Boolean(department && department.parentId == null && department.leaderId === user.id);
}
