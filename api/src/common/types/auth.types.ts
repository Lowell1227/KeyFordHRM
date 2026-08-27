import { SysRole } from '@prisma/client';

/** JWT 载荷 / 请求上下文中的当前用户。 */
export interface AuthUser {
  id: string;
  name: string;
  sysRole: SysRole;
  deptId: string | null;
  isAssessorOnly: boolean;
  canViewAll: boolean;
  hrCapabilities?: string[];
}

/** JWT 签发载荷（sub=用户id）。 */
export interface JwtPayload {
  sub: string;
  name: string;
  sysRole: SysRole;
  deptId: string | null;
  isAssessorOnly: boolean;
  canViewAll: boolean;
  hrCapabilities?: string[];
  iat?: number;
  exp?: number;
}
