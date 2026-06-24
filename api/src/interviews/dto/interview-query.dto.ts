import { Type } from 'class-transformer';
import { IsOptional, IsEnum, IsString, IsUUID } from 'class-validator';
import { InterviewStatus } from '@prisma/client';
import { PaginationDto } from '@/common/dto/pagination.dto';

/** 面谈记录列表查询参数。 */
export class InterviewQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  cycleId?: string;

  @IsOptional()
  @IsEnum(InterviewStatus)
  status?: InterviewStatus;

  @IsOptional()
  @IsString()
  keyword?: string;
}
