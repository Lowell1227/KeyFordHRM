import { IsOptional, IsString, Length } from 'class-validator';

export class LaunchCycleDto {
  @IsString()
  @Length(64, 64)
  expectedPlanHash: string;

  @IsOptional()
  @IsString()
  @Length(5, 200)
  overrideReason?: string;
}

export class ScheduleCycleDto {
  @IsString()
  @Length(64, 64)
  expectedPlanHash: string;
}
