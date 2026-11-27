import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { LifecycleQueryDto } from '@/performance-lifecycle/lifecycle.dto';
import { ImprovementPlanStatus } from '@prisma/client';

/** 改进计划列表查询参数。 */
export class ImprovementPlanQueryDto extends LifecycleQueryDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsUUID()
  cycleId?: string;

  @IsOptional()
  @IsUUID()
  deptId?: string;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsEnum(ImprovementPlanStatus)
  status?: ImprovementPlanStatus;
}
