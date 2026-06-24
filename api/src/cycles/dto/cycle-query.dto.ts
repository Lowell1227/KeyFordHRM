import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CycleStatus, CycleType } from '@prisma/client';
import { PaginationDto } from '@/common/dto/pagination.dto';

export class CycleQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(CycleStatus)
  status?: CycleStatus;

  @IsOptional()
  @IsEnum(CycleType)
  type?: CycleType;

  @IsOptional()
  @IsString()
  keyword?: string;
}
