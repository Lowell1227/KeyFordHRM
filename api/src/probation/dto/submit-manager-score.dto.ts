import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

/** 单条指标主管评分项。 */
export class ManagerScoreIndicatorItemDto {
  @IsUUID()
  id!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  managerScore!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  managerComment?: string;
}

/** POST /probation-reviews/:id/manager-score 请求体。 */
export class SubmitManagerScoreDto {
  @ValidateNested({ each: true })
  @Type(() => ManagerScoreIndicatorItemDto)
  indicators!: ManagerScoreIndicatorItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  strengths?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  improvements?: string;
}
