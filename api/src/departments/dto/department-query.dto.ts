import { IsOptional, IsBoolean, IsEnum } from 'class-validator';
import { Transform } from 'class-transformer';
import { CompanyCode } from '@prisma/client';

export class DepartmentQueryDto {
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  flat?: boolean;

  @IsOptional()
  @IsEnum(CompanyCode)
  company?: CompanyCode;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isActive?: boolean;
}
