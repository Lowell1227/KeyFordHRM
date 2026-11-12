import { IsOptional, IsBoolean, IsEnum } from 'class-validator';
import { BooleanQuery } from '../../common/dto/boolean-query';
import { CompanyCode } from '@prisma/client';

export class DepartmentQueryDto {
  @IsOptional()
  @IsBoolean()
  @BooleanQuery()
  flat?: boolean;

  @IsOptional()
  @IsEnum(CompanyCode)
  company?: CompanyCode;

  @IsOptional()
  @IsBoolean()
  @BooleanQuery()
  isActive?: boolean;
}
