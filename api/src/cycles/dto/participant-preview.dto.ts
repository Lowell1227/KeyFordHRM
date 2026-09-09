import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';

/** POST /cycles/participant-preview — 创建周期前预览当前选择范围。 */
export class ParticipantPreviewDto extends PaginationDto {
  @IsIn(['all', 'custom'])
  scope: 'all' | 'custom';

  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  departmentIds: string[];

  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  userIds: string[];

  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  excludedDepartmentIds: string[];

  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  excludedUserIds: string[];

  @IsOptional()
  @IsString()
  keyword?: string;
}
