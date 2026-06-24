import { SetMetadata } from '@nestjs/common';
import { SysRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * 限定可访问接口的系统角色（菜单/操作级权限）。
 * 注意：数据级权限（看哪些人的数据）与审批资格（approver_id）在各 service 内单独判断，
 *      不由此装饰器表达。见评审决策 #3。
 *
 * 用法：@Roles(SysRole.hr, SysRole.system_admin)
 */
export const Roles = (...roles: SysRole[]) => SetMetadata(ROLES_KEY, roles);
