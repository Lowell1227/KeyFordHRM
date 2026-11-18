import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';

const statuses = ['draft', 'revision', 'indicator_reviewing', 'indicator_dept_reviewing',
  'indicator_confirming', 'indicator_approving', 'active', 'revoked'] as const;

export class GoalChangeListQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['self', 'team', 'review', 'all'])
  scope: 'self' | 'team' | 'review' | 'all' = 'self';

  @IsOptional()
  @IsIn(statuses)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
}
