import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IndicatorProgressHealth } from '@prisma/client';

export class UpdateIndicatorProgressDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  progress!: number;

  @IsEnum(IndicatorProgressHealth)
  healthStatus!: IndicatorProgressHealth;

  @IsString()
  @Matches(/\S/, { message: '进展说明不能为空' })
  @MaxLength(10_000)
  content!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  expectedLatestUpdateAt?: string | null;
}
