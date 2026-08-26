import { IsOptional, IsUUID, IsEnum, IsString, IsBoolean } from 'class-validator';
import { UserStatus, EmploymentType, SysRole } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { Transform } from 'class-transformer';

export class UserQueryDto extends PaginationDto {
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
}
