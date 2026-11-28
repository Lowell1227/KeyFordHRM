import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';
import { PartialType } from '@nestjs/mapped-types';
import { RECRUITMENT_TRACKING_STATES, type RecruitmentTrackingState } from './recruitment-lifecycle.types';

export class RecruitmentDemandQueryDto extends PaginationDto {
  @IsOptional() @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MaxLength(100) keyword?: string;
  @IsOptional() @IsIn(['draft', 'pending', 'approved', 'rejected', 'withdrawn', 'unknown']) status?: string;
  @IsOptional() @IsIn(['review', 'returned']) workQueue?: 'review' | 'returned';
  @IsOptional() @IsIn(RECRUITMENT_TRACKING_STATES) trackingState?: RecruitmentTrackingState;
}

export class RecruitmentDemandOptionsQueryDto extends PaginationDto {
  @IsUUID() applicationId!: string;
  @IsOptional() @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MaxLength(100) keyword?: string;
}

export class RecruitmentDemandIntentOptionsQueryDto extends RecruitmentDemandQueryDto {
  @IsOptional() @IsUUID() deptId?: string;
  @IsOptional() @IsString() @MaxLength(100) positionName?: string;
}

export class SyncRecruitmentDemandsDto {
  @IsISO8601({ strict: true }) from!: string;
  @IsISO8601({ strict: true }) to!: string;
  @IsOptional() @IsUUID() requestId?: string;
  @IsOptional() @IsUUID() cursor?: string;
}

export class MapRecruitmentDemandDto {
  @IsInt() @Min(1) @Max(2147483646) expectedRevision!: number;
  @IsUUID() deptId!: string;
  @IsUUID() positionId!: string;
  @IsInt() @Min(1) @Max(2147483647) approvedHeadcount!: number;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}

class LocalRecruitmentDemandFieldsDto {
  @IsUUID() deptId!: string;
  @IsUUID() positionId!: string;
  @IsInt() @Min(1) @Max(2147483647) headcount!: number;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}

export class CreateLocalRecruitmentDemandDto extends LocalRecruitmentDemandFieldsDto {
  @IsUUID() requestId!: string;
}

export class UpdateLocalRecruitmentDemandDto extends PartialType(LocalRecruitmentDemandFieldsDto) {
  @IsInt() @Min(1) @Max(2147483646) expectedRevision!: number;
}

export class LocalRecruitmentDemandActionDto {
  @IsInt() @Min(1) @Max(2147483646) expectedRevision!: number;
  @IsIn(['submit', 'submit_approve', 'approve', 'return', 'withdraw']) action!: 'submit' | 'submit_approve' | 'approve' | 'return' | 'withdraw';
  @IsOptional() @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MaxLength(1000) reason?: string;
}
