import { IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';

/** GET /appeals 查询参数。 */
export class AppealQueryDto extends PaginationDto {
  @IsUUID('4')
  @IsOptional()
  cycleId?: string;

  @IsUUID('4')
  @IsOptional()
  deptId?: string;

  @IsString()
  @IsOptional()
  keyword?: string;
}
