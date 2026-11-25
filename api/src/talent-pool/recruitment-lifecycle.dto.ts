import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';
import { BooleanQuery } from '@/common/dto/boolean-query';
import { RECRUITMENT_ANALYTICS_METRICS, RECRUITMENT_TRACKING_STATES, type RecruitmentAnalyticsMetric, type RecruitmentTrackingState } from './recruitment-lifecycle.types';

export class ChangeRecruitmentLifecycleDto {
  @IsInt() @Min(1) @Max(2147483646) expectedRevision: number;
  @IsIn(RECRUITMENT_TRACKING_STATES) trackingState: RecruitmentTrackingState;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason: string;
}

export class RecruitmentAnalyticsQueryDto extends PaginationDto {
  @IsOptional() @IsUUID() demandId?: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(80) sourceChannel?: string;
  @IsOptional() @BooleanQuery() @IsBoolean() unknownSource?: boolean;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsIn(RECRUITMENT_ANALYTICS_METRICS) metric?: RecruitmentAnalyticsMetric;
}
