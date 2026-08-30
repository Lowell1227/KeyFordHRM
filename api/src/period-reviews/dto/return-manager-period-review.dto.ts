import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class ReturnManagerPeriodReviewDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsUUID('4')
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  reason?: string | null;
}
