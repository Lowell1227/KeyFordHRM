import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';

/** 面谈记录列表查询参数。 */
export class InterviewQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  cycleId?: string;

  @IsOptional()
  @IsUUID()
  deptId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
}
