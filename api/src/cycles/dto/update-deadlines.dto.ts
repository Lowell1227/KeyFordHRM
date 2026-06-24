import { Type } from 'class-transformer';
import { IsOptional, IsDate } from 'class-validator';

/**
 * 修改考核周期各节点截止日期。
 * 仅允许延期，不允许提前；新值仍需保持递增顺序。
 */
export class UpdateDeadlinesDto {
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
