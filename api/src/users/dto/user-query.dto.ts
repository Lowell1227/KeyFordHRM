import { IsOptional, IsUUID, IsEnum, IsString, IsBoolean, IsIn } from 'class-validator';
import { UserStatus, EmploymentType, SysRole } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { BooleanQuery } from '../../common/dto/boolean-query';

export class UserQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  columns?: string;

  @IsOptional()
  @IsIn(['cycle_owner', 'direct_manager'])
  eligibleFor?: 'cycle_owner' | 'direct_manager';

  @IsOptional()
  @IsUUID()
  deptId?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsOptional()
  @IsEnum(SysRole)
  sysRole?: SysRole;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsBoolean()
  @BooleanQuery()
  includeTestAccounts?: boolean;

  @IsOptional()
  @IsBoolean()
  @BooleanQuery()
  archived?: boolean;

  @IsOptional()
  @IsBoolean()
  @BooleanQuery()
  includeResigned?: boolean;

  @IsOptional()
  @IsBoolean()
  @BooleanQuery()
  unassigned?: boolean;
}
