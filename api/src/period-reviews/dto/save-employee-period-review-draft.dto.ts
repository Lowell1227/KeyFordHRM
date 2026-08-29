import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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

export class EmployeePeriodReviewDraftItemDto {
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
  @MaxLength(200)
  actualValueText?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  employeeComment?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  problemReason?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  nextMonthPlan?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  supportNeeded?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PeriodReviewAttachmentDto)
  attachments?: PeriodReviewAttachmentDto[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  selfScore?: number | null;
}

export class SaveEmployeePeriodReviewDraftDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmployeePeriodReviewDraftItemDto)
  indicators!: EmployeePeriodReviewDraftItemDto[];
}
