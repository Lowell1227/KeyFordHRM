import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ReviewCycleDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedPlanVersion!: number;

  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
