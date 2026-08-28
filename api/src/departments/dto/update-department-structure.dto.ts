import { CompanyCode } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class UpdateDepartmentStructureDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsEnum(CompanyCode)
  company?: CompanyCode;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  leaderId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  approverId?: string | null;
}
