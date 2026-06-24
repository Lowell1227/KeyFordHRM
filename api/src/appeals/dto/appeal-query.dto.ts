import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { AppealStatus } from '@prisma/client';
import { PaginationDto } from '@/common/dto/pagination.dto';

/** GET /appeals 查询参数。 */
export class AppealQueryDto extends PaginationDto {
  @IsUUID('4')
  @IsOptional()
  cycleId?: string;

  @IsEnum(AppealStatus)
  @IsOptional()
  status?: 'pending' | 'resolved';

  @IsUUID('4')
  @IsOptional()
  deptId?: string;

  @IsString()
  @IsOptional()
  keyword?: string;
}
