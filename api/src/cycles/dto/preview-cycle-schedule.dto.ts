import { Transform, Type } from 'class-transformer';
import { IsArray, IsDate, IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { CycleType, ScoringFrequency } from '@prisma/client';
import { CyclePeriodScheduleDto } from './cycle-period-schedule.dto';
import { transformDateOnly } from './date-only.transform';

export class PreviewCycleScheduleDto {
  @IsEnum(CycleType)
  type: CycleType;

  @Transform(transformDateOnly, { toClassOnly: true })
  @IsDate()
  startDate: Date;

  @Transform(transformDateOnly, { toClassOnly: true })
  @IsDate()
  endDate: Date;

  @IsOptional()
  @IsEnum(ScoringFrequency)
  scoringFrequency?: ScoringFrequency;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CyclePeriodScheduleDto)
  schedules?: CyclePeriodScheduleDto[];

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  goalSettingOpenAt?: Date;

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
