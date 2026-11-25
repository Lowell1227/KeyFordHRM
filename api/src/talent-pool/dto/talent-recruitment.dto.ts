import { PartialType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';
import { BooleanQuery } from '@/common/dto/boolean-query';
import { TALENT_APPLICATION_ACTIONS, TALENT_RESERVE_REASONS, type TalentApplicationAction, type TalentReserveReason } from '../talent-recruitment-policy';
import { TALENT_SOURCE_CHANNELS } from '../talent.constants';

export class TalentOwnerQueryDto extends PaginationDto {
  @IsOptional() @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MaxLength(100) keyword?: string;
}

export class TalentApplicationQueueQueryDto extends TalentOwnerQueryDto {
  @IsOptional() @IsIn(['owned', 'all']) scope?: 'owned' | 'all';
  @IsOptional() @IsIn(['screening', 'interviewing', 'hiring_review', 'offered', 'accepted', 'declined', 'rejected', 'reserve', 'withdrawn', 'onboarding', 'hired']) stage?: string;
  @IsOptional() @IsUUID() deptId?: string;
  @IsOptional() @BooleanQuery() @IsBoolean() overdueOnly?: boolean;
}

class TalentApplicationFields {
  @IsString() @MinLength(1) @MaxLength(100) positionName!: string;
  @IsOptional() @IsString() @MaxLength(100) recruitmentBatch?: string | null;
  @IsOptional() @IsUUID() deptId?: string | null;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsUUID() intentDemandId?: string | null;
  @IsOptional() @IsIn(TALENT_SOURCE_CHANNELS) sourceChannel?: string | null;
  @IsOptional() @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) expectedEntryDate?: string | null;
}

export class CreateTalentApplicationDto extends TalentApplicationFields {
  @IsOptional() @IsUUID() requestId?: string;
}

export class UpdateTalentApplicationDto extends PartialType(TalentApplicationFields) {
  @IsInt() @Min(0) @Max(2147483646) expectedRevision!: number;
  @IsOptional() @IsString() @MaxLength(2000) intentChangeReason?: string;
}

export class TalentApplicationActionDto {
  @IsInt() @Min(0) @Max(2147483646) expectedRevision!: number;
  @IsIn(TALENT_APPLICATION_ACTIONS) action!: TalentApplicationAction;
  @IsOptional() @IsUUID() recruitmentDemandId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(2147483646) expectedDemandRevision?: number;
  @IsOptional() @IsString() @MaxLength(4000) note?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @ArrayUnique() @IsIn(TALENT_RESERVE_REASONS, { each: true })
  reserveReasons?: TalentReserveReason[];
  @IsOptional() @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) expectedEntryDate?: string | null;
}

export class SaveTalentInterviewFeedbackDto {
  @IsInt() @Min(1) @Max(2147483646) interviewVersion!: number;
  @IsInt() @Min(0) @Max(2147483646) expectedRevision!: number;
  @IsOptional() @IsIn(['pass', 'reject', 'pending']) outcome?: 'pass' | 'reject' | 'pending' | null;
  @IsOptional() @IsString() @MaxLength(4000) summary?: string | null;
  @IsBoolean() submit!: boolean;
}

export class ReturnTalentInterviewFeedbackDto {
  @IsInt() @Min(1) @Max(2147483646) interviewVersion!: number;
  @IsInt() @Min(1) @Max(2147483646) expectedRevision!: number;
  @IsString() @MinLength(1) @MaxLength(4000) note!: string;
}
