import { IsBoolean, IsISO8601, IsOptional, Matches } from 'class-validator';

export class CyclePeriodScheduleDto {
  @Matches(/^(cycle|\d{4}-(0[1-9]|1[0-2]))$/)
  periodKey: string;

  @IsOptional()
  @IsISO8601()
  selfEvalOpenAt?: string | Date;

  @IsOptional()
  @IsISO8601()
  selfEvalDueAt?: string | Date;

  @IsOptional()
  @IsISO8601()
  managerDueAt?: string | Date;

  @IsOptional()
  @IsBoolean()
  isException?: boolean;
}
