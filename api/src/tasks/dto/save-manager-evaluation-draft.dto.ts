import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsDateString,
  IsDefined,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export class ExtraScoreItemDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsNumber()
  value!: number;
}

export class ManagerEvalSummaryDto {
  @IsOptional()
  @IsString()
  strengths?: string;

  @IsOptional()
  @IsString()
  improvements?: string;

  @IsOptional()
  @IsString()
  developmentPlan?: string;

  @IsOptional()
  @IsArray()
  attachments?: unknown[];
}

export class ManagerEvaluationIndicatorBaseDto {
  @IsUUID()
  id!: string;

  @IsOptional()
  @IsString()
  managerComment?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtraScoreItemDto)
  extraScores?: ExtraScoreItemDto[];
}

export class ManagerEvaluationDraftIndicatorDto extends ManagerEvaluationIndicatorBaseDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  managerScore?: number;
}

export class SaveManagerEvaluationDraftDto {
  @IsDateString()
  expectedUpdatedAt!: string;

  @IsArray()
  @IsDefined()
  @ValidateNested({ each: true })
  @Type(() => ManagerEvaluationDraftIndicatorDto)
  indicators!: ManagerEvaluationDraftIndicatorDto[];

  @IsDefined()
  @ValidateNested()
  @Type(() => ManagerEvalSummaryDto)
  evalSummary!: ManagerEvalSummaryDto;
}
