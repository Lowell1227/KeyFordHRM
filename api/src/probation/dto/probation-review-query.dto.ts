import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ProbationReviewStatus } from '@prisma/client';
import { PaginationDto } from '@/common/dto/pagination.dto';

/** GET /probation-reviews 查询参数。 */
export class ProbationReviewQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsUUID()
  managerId?: string;

  @IsOptional()
  @IsEnum(ProbationReviewStatus)
  status?: ProbationReviewStatus;

  @IsOptional()
  @IsString()
  keyword?: string;
}
