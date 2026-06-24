import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { TaskStatus } from '@prisma/client';
import { PaginationDto } from '@/common/dto/pagination.dto';

/** GET /tasks 查询参数。 */
export class TaskQueryDto extends PaginationDto {
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
