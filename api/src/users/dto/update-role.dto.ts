import { IsEnum } from 'class-validator';
import { SysRole } from '@prisma/client';

export class UpdateRoleDto {
  @IsEnum(SysRole)
  sysRole: SysRole;
}
