import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ActionItemStatus } from '@prisma/client';
import { PaginationDto } from '@/common/dto/pagination.dto';

/** 行动项列表查询参数。 */
export class ActionItemQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID('4')
  objectiveId?: string;

  @IsOptional()
  @IsEnum(ActionItemStatus)
  status?: ActionItemStatus;

  @IsOptional()
  @IsUUID('4')
  assigneeId?: string;

  /** null = 只查顶层；undefined = 不过滤。前端传 'null' 字符串时会被转为 null。 */
  @IsOptional()
  parentId?: string | null;
}
