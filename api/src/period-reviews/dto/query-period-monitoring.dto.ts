import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';

export const PERIOD_MONITORING_STATUSES = [
  'employee_pending',
  'employee_overdue',
  'manager_pending',
  'manager_completed',
] as const;

export type PeriodMonitoringStatus = typeof PERIOD_MONITORING_STATUSES[number];

export class QueryPeriodMonitoringDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  periodKey?: string;

  @IsOptional()
  @IsIn(PERIOD_MONITORING_STATUSES)
  status?: PeriodMonitoringStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
}
