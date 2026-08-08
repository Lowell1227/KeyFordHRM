import { Type } from "class-transformer";
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from "class-validator";

export class BatchTaskRefDto {
  @IsUUID()
  taskId!: string;

  @IsISO8601()
  updatedAt!: string;
}

export class BatchIndicatorReviewDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique((task: BatchTaskRefDto) => task.taskId)
  @ValidateNested({ each: true })
  @Type(() => BatchTaskRefDto)
  tasks!: BatchTaskRefDto[];
}

export class BatchRejectIndicatorReviewDto extends BatchIndicatorReviewDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
