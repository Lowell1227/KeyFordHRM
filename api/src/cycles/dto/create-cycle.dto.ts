import { Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsDate,
  IsObject,
  IsNumber,
  IsArray,
  IsUUID,
  IsIn,
  IsBoolean,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { CycleType, ScoringFrequency } from '@prisma/client';
import { CyclePeriodScheduleDto } from './cycle-period-schedule.dto';

/**
 * 创建考核周期请求体（对应后端文档 3.7）。
 * deadline_appeal 由公示时自动计算，创建时无需提供。
 */
export class CreateCycleDto {
  @IsString()
  name: string;

  @IsEnum(CycleType)
  type: CycleType;

  @IsOptional()
  @IsIn([1, 2])
  workflowVersion?: 1 | 2;

  @IsOptional()
  @IsEnum(ScoringFrequency)
  scoringFrequency?: ScoringFrequency;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CyclePeriodScheduleDto)
  periodSchedules?: CyclePeriodScheduleDto[];

  @IsOptional()
  @IsIn(['off', 'launch_only', 'launch_and_reminders'])
  notificationMode?: 'off' | 'launch_only' | 'launch_and_reminders';

  @Type(() => Date)
  @IsDate()
  startDate: Date;

  @Type(() => Date)
  @IsDate()
  endDate: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  goalSettingOpenAt?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  selfEvalOpenAt?: Date;

  @IsOptional()
  @IsUUID()
  hrOwnerId?: string;

  @IsOptional()
  @IsUUID()
  reviewerId?: string;

  @IsOptional()
  @IsBoolean()
  monthlyFollowUpRequired?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  participantDeptIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  participantUserIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  explicitExemptDeptIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  explicitExemptUserIds?: string[];

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

  @IsOptional()
  @IsObject()
  publishVisibleFields?: Record<string, boolean>;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  gradeAMaxRatio?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  gradeBMaxRatio?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  gradeCMaxRatio?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  gradeDMaxRatio?: number;
}
