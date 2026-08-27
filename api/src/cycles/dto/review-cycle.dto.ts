import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewCycleDto {
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
