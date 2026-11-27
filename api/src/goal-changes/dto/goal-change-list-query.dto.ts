import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { LifecycleQueryDto } from '@/performance-lifecycle/lifecycle.dto';

const statuses = ['draft', 'revision', 'indicator_reviewing', 'indicator_dept_reviewing',
  'indicator_confirming', 'indicator_approving', 'active', 'revoked'] as const;

export class GoalChangeListQueryDto extends LifecycleQueryDto {
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
