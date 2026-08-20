import { SysRole } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';

export class UpdateUserSettingsDto {
  @IsOptional()
  @IsUUID()
  directManagerId?: string | null;

  @IsOptional()
  @IsEnum(SysRole)
  sysRole?: SysRole;

  @IsOptional()
  @IsBoolean()
  grantManagerRole?: boolean;
}
