import { IsIn } from 'class-validator';
import { SysRole } from '@prisma/client';

export class UpdateRoleDto {
  @IsIn([SysRole.employee, SysRole.hr, SysRole.system_admin])
  sysRole: SysRole;
}
