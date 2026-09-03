import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IndicatorProgressHealth } from '@prisma/client';

export class SubmitEmployeePeriodReviewItemDto {
  @IsUUID()
  indicatorVersionItemId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number | null;

  @IsOptional()
  @IsEnum(IndicatorProgressHealth)
  healthStatus?: IndicatorProgressHealth | null;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  employeeComment?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  selfScore?: number | null;
}

export class SubmitEmployeePeriodReviewDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsUUID()
  idempotencyKey!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SubmitEmployeePeriodReviewItemDto)
  indicators!: SubmitEmployeePeriodReviewItemDto[];
}
