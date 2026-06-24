import { IsEnum, IsOptional, IsString } from 'class-validator';

/** POST /tasks/:id/dept-review 请求体。 */
export class DeptReviewDto {
  @IsEnum({ approve: 'approve', reject: 'reject' } as const)
  action!: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  comment?: string;
}
