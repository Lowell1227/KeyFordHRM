import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsNotEmpty, IsNumber, IsOptional,
  IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class ImprovementGoalDto {
  @IsString() @IsNotEmpty() id: string;
  @IsString() @MaxLength(200) name: string;
  @IsString() @MaxLength(4000) description: string;
  @IsNumber() @Min(0) @Max(100) weight: number;
}

export class CreateImprovementPlanDto {
  @IsUUID() employeeId: string;
  @IsOptional() @IsUUID() cycleId?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) improvementNeed?: string;
  @IsOptional() @IsDateString() targetDate?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ImprovementGoalDto)
  goals?: ImprovementGoalDto[];
}

export class UpdateImprovementPlanDto {
  @IsOptional() @IsUUID() cycleId?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) improvementNeed?: string;
  @IsOptional() @IsDateString() targetDate?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ImprovementGoalDto)
  goals?: ImprovementGoalDto[];
}

export class ImprovementDecisionDto {
  @IsBoolean() approve: boolean;
  @IsOptional() @IsString() @MaxLength(4000) comment?: string;
}

export class ImprovementGoalSuggestionDto {
  @IsString() @IsNotEmpty() goalId: string;
  @IsString() @IsNotEmpty() @MaxLength(4000) comment: string;
}

export class ImprovementGoalDecisionDto extends ImprovementDecisionDto {
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ImprovementGoalSuggestionDto)
  suggestions?: ImprovementGoalSuggestionDto[];
}

export class ImprovementGoalEvaluationDto {
  @IsString() @IsNotEmpty() goalId: string;
  @IsNumber() @Min(0) @Max(100) score: number;
  @IsString() @MaxLength(4000) comment: string;
}

export class ImprovementEvaluationDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ImprovementGoalEvaluationDto)
  items: ImprovementGoalEvaluationDto[];
  @IsString() @MaxLength(4000) overallComment: string;
}

export class ImprovementGoalEvaluationDraftDto {
  @IsString() @IsNotEmpty() goalId: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) score: number | null;
  @IsString() @MaxLength(4000) comment: string;
}

export class ImprovementEvaluationDraftDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ImprovementGoalEvaluationDraftDto)
  items: ImprovementGoalEvaluationDraftDto[];
  @IsString() @MaxLength(4000) overallComment: string;
}
