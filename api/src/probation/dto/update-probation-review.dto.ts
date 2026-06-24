import { Type } from 'class-transformer';
import { IsArray, IsDate, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ProbationIndicatorType } from '@prisma/client';

/** 试用期考核指标项（更新用）。 */
export class UpdateProbationIndicatorDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsEnum(ProbationIndicatorType)
  type?: ProbationIndicatorType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  weight?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  targetValue?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  sortOrder?: number;
}

/** PUT /probation-reviews/:id 请求体。 */
export class UpdateProbationReviewDto {
  @IsOptional()
  @IsUUID()
  managerId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  plannedRegularDate?: Date;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateProbationIndicatorDto)
  indicators?: UpdateProbationIndicatorDto[];
}
