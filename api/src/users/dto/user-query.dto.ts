import { IsOptional, IsUUID, IsEnum, IsString, IsBoolean, IsIn } from 'class-validator';
import { UserStatus, EmploymentType, SysRole } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { Transform } from 'class-transformer';

export class UserQueryDto extends PaginationDto {
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
  @Transform(({ value }) => value === 'true' || value === true)
  includeTestAccounts?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  archived?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeResigned?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  unassigned?: boolean;
}
