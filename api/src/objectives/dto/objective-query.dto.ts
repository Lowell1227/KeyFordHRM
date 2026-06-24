import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ObjectiveLevel, ObjectiveStatus } from '@prisma/client';
import { PaginationDto } from '@/common/dto/pagination.dto';

/** 目标列表查询参数。 */
export class ObjectiveQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(ObjectiveLevel)
  level?: ObjectiveLevel;

  @IsOptional()
  @IsUUID()
  deptId?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsUUID()
  cycleId?: string;

  @IsOptional()
  @IsEnum(ObjectiveStatus)
  status?: ObjectiveStatus;

  @IsOptional()
  @IsString()
  keyword?: string;

  /** 为真时返回平铺列表；为假（默认）时返回树。 */
  @IsOptional()
  @Type(() => Boolean)
  flat?: boolean;
}
