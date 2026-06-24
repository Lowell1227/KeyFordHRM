import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { VetoDto } from '@/calibration/dto/veto.dto';

/** 单条加减分项。 */
export class ExtraScoreItemDto {
  @IsString()
  label!: string;

  @IsNumber()
  value!: number;
}

/** 单条指标主管评分项。 */
export class ManagerScoreIndicatorItemDto {
  @IsUUID()
  id!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  managerScore!: number;

  @IsOptional()
  @IsString()
  managerComment?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ExtraScoreItemDto)
  extraScores?: ExtraScoreItemDto[];
}

/** 主管总体评价。 */
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
  attachments?: unknown[];
}

/** POST /tasks/:id/manager-score 请求体。 */
export class SubmitManagerScoreDto {
  @ValidateNested({ each: true })
  @Type(() => ManagerScoreIndicatorItemDto)
  indicators!: ManagerScoreIndicatorItemDto[];

  @ValidateNested()
  @Type(() => ManagerEvalSummaryDto)
  evalSummary!: ManagerEvalSummaryDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => VetoDto)
  veto?: VetoDto;
}
