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
  /** 绑定本次任职工号；再入职换号后，旧会话不能恢复使用。缺失表示旧版令牌，需重新登录。 */
  employeeNo?: string | null;
  name: string;
  sysRole: SysRole;
  deptId: string | null;
  isAssessorOnly: boolean;
  canViewAll: boolean;
  hrCapabilities?: string[];
  iat?: number;
  exp?: number;
}
