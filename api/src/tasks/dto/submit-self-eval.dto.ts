import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';

/** 单条指标自评项。 */
export class SelfEvalIndicatorItemDto {
  @IsUUID()
  id!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  selfScore!: number;

  @IsOptional()
  @IsString()
  selfComment?: string;
}

/** 自评总结四栏。 */
export class SelfEvalSummaryDto {
  @IsOptional()
  @IsString()
  achievements?: string;

  @IsOptional()
  @IsString()
  improvements?: string;

  @IsOptional()
  @IsString()
  suggestions?: string;

  @IsOptional()
  @IsString()
  nextGoals?: string;

  @IsOptional()
  @IsString()
  supportNeeded?: string;

  @IsOptional()
  attachments?: unknown[];
}

/** POST /tasks/:id/self-eval 请求体。 */
export class SubmitSelfEvalDto {
  @ValidateNested({ each: true })
  @Type(() => SelfEvalIndicatorItemDto)
  indicators!: SelfEvalIndicatorItemDto[];

  @ValidateNested()
  @Type(() => SelfEvalSummaryDto)
  summary!: SelfEvalSummaryDto;
}
