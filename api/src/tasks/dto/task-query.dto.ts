import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { TaskStatus } from '@prisma/client';
import { LifecycleQueryDto } from '@/performance-lifecycle/lifecycle.dto';

/** GET /tasks 查询参数。 */
export class TaskQueryDto extends LifecycleQueryDto {
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
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsString()
  keyword?: string;
}
