import { IsInt, Max, Min } from 'class-validator';

/** 完成改进计划并录入最终评分。 */
export class CompleteImprovementPlanDto {
  @IsInt()
  @Min(1)
  @Max(10)
  finalScore: number;
}
