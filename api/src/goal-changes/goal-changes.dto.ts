import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { IndicatorType } from '@prisma/client';

export class ChangeRevisionDto { @IsInt() @Min(0) expectedRevision: number }
export class ChangeTaskDto { @IsUUID() taskId: string }
export class ChangeGrantDto extends ChangeTaskDto { @IsOptional() @IsInt() @Min(0) expectedRevision?: number }
export class ChangeGoalDto {
  @IsOptional() @IsUUID() sourceInstanceId: string | null;
  @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @IsOptional() @IsString() @MaxLength(10000) description: string | null;
  @IsOptional() @IsString() @MaxLength(10000) scoringStandard: string | null;
  @IsOptional() @IsNumber() targetValue: number | null;
  @IsOptional() @IsString() @MaxLength(100) targetValueText: string | null;
  @IsOptional() @IsString() @MaxLength(30) unit: string | null;
  @IsNumber() @Min(0) @Max(1) weight: number;
  @IsEnum(IndicatorType) indicatorType: IndicatorType;
  @IsOptional() @IsString() @MaxLength(100) dimensionName: string | null;
  @IsNumber() @Min(0) @Max(1) dimensionWeight: number;
  @IsInt() @Min(0) sortOrder: number;
}
export class ChangeDraftDto extends ChangeRevisionDto {
  @IsString() @MaxLength(4000) reason: string;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ChangeGoalDto) goals: ChangeGoalDto[];
}
export class ChangeSubmitDto extends ChangeRevisionDto {
  @IsOptional() @IsString() @MaxLength(4000) reason?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ChangeGoalDto) goals?: ChangeGoalDto[];
}
export class ChangeDecisionDto extends ChangeRevisionDto {
  @IsBoolean() approve: boolean;
  @IsOptional() @IsString() @MaxLength(4000) comment?: string;
}
