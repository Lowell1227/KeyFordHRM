import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** 更新行动项进度（0–100）。 */
export class UpdateProgressDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  progress!: number;
}
