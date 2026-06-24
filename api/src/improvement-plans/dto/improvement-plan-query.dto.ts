import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';
import { ImprovementPlanStatus } from '@prisma/client';

/** 改进计划列表查询参数。 */
export class ImprovementPlanQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsUUID()
  cycleId?: string;

  @IsOptional()
  @IsEnum(ImprovementPlanStatus)
  status?: ImprovementPlanStatus;
}
