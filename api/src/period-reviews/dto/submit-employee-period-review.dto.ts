import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
import { PeriodReviewAttachmentDto } from './period-review-attachment.dto';

export class SubmitEmployeePeriodReviewItemDto {
  @IsUUID()
  indicatorVersionItemId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  progress!: number;

  @IsEnum(IndicatorProgressHealth)
  healthStatus!: IndicatorProgressHealth;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  actualValueText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  employeeComment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  problemReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  nextMonthPlan?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  supportNeeded?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PeriodReviewAttachmentDto)
  attachments?: PeriodReviewAttachmentDto[];

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  selfScore!: number;
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
