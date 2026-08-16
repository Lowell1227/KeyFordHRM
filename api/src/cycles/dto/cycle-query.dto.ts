import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CycleStatus, CycleType } from '@prisma/client';
import { PaginationDto } from '@/common/dto/pagination.dto';

export enum CycleStatusGroup {
  attention = 'attention',
  active = 'active',
  finished = 'finished',
}

export class CycleQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(CycleStatus)
  status?: CycleStatus;

  @IsOptional()
  @IsEnum(CycleType)
  type?: CycleType;

  @IsOptional()
  @IsEnum(CycleStatusGroup)
  group?: CycleStatusGroup;

  @IsOptional()
  @IsString()
  keyword?: string;
}
