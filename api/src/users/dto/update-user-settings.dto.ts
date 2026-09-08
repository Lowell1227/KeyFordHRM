import { SysRole } from '@prisma/client';
import { IsArray, IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { HR_CAPABILITIES } from '@/auth/hr-capabilities';

export class UpdateUserSettingsDto {
  @IsOptional()
  @IsUUID()
  directManagerId?: string | null;

  @IsOptional()
  @IsIn([SysRole.employee, SysRole.hr_user, SysRole.hr, SysRole.system_admin])
  sysRole?: SysRole;

  @IsOptional()
  @IsArray()
  @IsIn(HR_CAPABILITIES, { each: true })
  hrCapabilities?: string[];

  @IsOptional()
  @IsBoolean()
  /** @deprecated 绩效直属上级权限由关系动态计算；保留字段只为兼容旧客户端。 */
  grantManagerRole?: boolean;
}
