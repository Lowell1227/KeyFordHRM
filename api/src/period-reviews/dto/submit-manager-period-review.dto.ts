import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';
import { ManagerPeriodReviewItemDto } from './save-manager-period-review-draft.dto';

export class SubmitManagerPeriodReviewDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsUUID('4')
  idempotencyKey!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ManagerPeriodReviewItemDto)
  indicators!: ManagerPeriodReviewItemDto[];
}
