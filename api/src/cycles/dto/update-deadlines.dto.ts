import { Type } from 'class-transformer';
import { IsOptional, IsDate, IsInt, Min } from 'class-validator';

/**
 * 修改考核周期各节点截止日期。
 * 已执行节点仅允许延期；节点之间的先后异常由页面和发起检查提示。
 */
export class UpdateDeadlinesDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedPlanVersion!: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  deadlineIndicatorSetting?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  deadlineIndicatorConfirm?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  deadlineSelfEval?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  deadlineManagerScore?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  deadlineHrCalibration?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  deadlineApproval?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  deadlinePublish?: Date;
}
