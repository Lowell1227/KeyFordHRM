import { Type } from 'class-transformer';
import { IsArray, IsDate, IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { CycleType, ScoringFrequency } from '@prisma/client';
import { CyclePeriodScheduleDto } from './cycle-period-schedule.dto';

export class PreviewCycleScheduleDto {
  @IsEnum(CycleType)
  type: CycleType;

  @Type(() => Date)
  @IsDate()
  startDate: Date;

  @Type(() => Date)
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
}
