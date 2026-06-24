import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

/** 单条指标自评项。 */
export class SelfEvalIndicatorItemDto {
  @IsUUID()
  id!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  selfScore!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  selfComment?: string;
}

/** POST /probation-reviews/:id/self-eval 请求体。 */
export class SubmitSelfEvalDto {
  @ValidateNested({ each: true })
  @Type(() => SelfEvalIndicatorItemDto)
  indicators!: SelfEvalIndicatorItemDto[];
}
