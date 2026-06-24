import { Type } from 'class-transformer';
import { IsArray, IsDate, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ProbationIndicatorType } from '@prisma/client';

/** 试用期考核指标项（创建用）。 */
export class CreateProbationIndicatorDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsEnum(ProbationIndicatorType)
  type!: ProbationIndicatorType;

  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  weight!: number;

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

/** POST /probation-reviews 请求体。 */
export class CreateProbationReviewDto {
  @IsUUID()
  employeeId!: string;

  @IsUUID()
  managerId!: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  plannedRegularDate?: Date;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProbationIndicatorDto)
  indicators?: CreateProbationIndicatorDto[];
}
