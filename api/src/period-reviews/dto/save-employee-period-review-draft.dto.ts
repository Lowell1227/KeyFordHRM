import { Type } from 'class-transformer';
import {
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
  @MaxLength(10_000)
  employeeComment?: string | null;

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
