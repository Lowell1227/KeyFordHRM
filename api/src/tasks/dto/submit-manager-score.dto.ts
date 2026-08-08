import { Type } from "class-transformer";
import {
  IsArray,
  IsDateString,
  IsDefined,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { VetoDto } from "@/calibration/dto/veto.dto";
import {
  ExtraScoreItemDto,
  ManagerEvalSummaryDto,
  ManagerEvaluationIndicatorBaseDto,
} from "./save-manager-evaluation-draft.dto";

export {
  ExtraScoreItemDto,
  ManagerEvalSummaryDto,
} from "./save-manager-evaluation-draft.dto";

/** 单条指标主管评分项。 */
export class ManagerScoreIndicatorItemDto extends ManagerEvaluationIndicatorBaseDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  managerScore!: number;
}

/** POST /tasks/:id/manager-score 请求体。 */
export class SubmitManagerScoreDto {
  @IsDateString()
  expectedUpdatedAt!: string;

  @IsArray()
  @IsDefined()
  @ValidateNested({ each: true })
  @Type(() => ManagerScoreIndicatorItemDto)
  indicators!: ManagerScoreIndicatorItemDto[];

  @IsDefined()
  @ValidateNested()
  @Type(() => ManagerEvalSummaryDto)
  evalSummary!: ManagerEvalSummaryDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => VetoDto)
  veto?: VetoDto;
}
