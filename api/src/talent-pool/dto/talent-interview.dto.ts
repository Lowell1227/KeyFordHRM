import { IntersectionType, PartialType, OmitType } from '@nestjs/mapped-types';
import { PaginationDto } from '@/common/dto/pagination.dto';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class CreateTalentInterviewDto {
  @IsOptional() @IsUUID() requestId?: string;
  @IsUUID() candidateId!: string;
  @IsUUID() applicationId!: string;
  @IsISO8601({ strict: true }) startsAt!: string;
  @IsISO8601({ strict: true }) endsAt!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ArrayUnique() @IsUUID('all', { each: true }) participantIds!: string[];
  @IsString() @MinLength(1) @MaxLength(10000) invitationText!: string;
  @IsOptional() @IsString() @MaxLength(1000) meetingUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) note?: string | null;
}

export class UpdateTalentInterviewDto extends PartialType(OmitType(CreateTalentInterviewDto, ['candidateId', 'requestId', 'applicationId'] as const)) {
  @IsInt() @Min(1) version!: number;
}

export class InterviewVersionDto {
  @IsInt() @Min(1) version!: number;
}

export class TalentInterviewQueryDto {
  @IsOptional() @IsIn(['mine', 'created', 'responsible', 'all']) scope?: 'mine' | 'created' | 'responsible' | 'all';
  @IsOptional() @IsUUID() candidateId?: string;
  @IsOptional() @IsUUID() applicationId?: string;
  @IsOptional() @IsString() @MaxLength(100) keyword?: string;
  @IsOptional() @IsIn(['scheduled', 'completed', 'cancelled']) status?: string;
  @IsOptional() @IsIn(['upcoming', 'feedback', 'history', 'all']) view?: 'upcoming' | 'feedback' | 'history' | 'all';
  @IsOptional() @IsISO8601({ strict: true }) day?: string;
}

// Mapped types retain validated page fields, not PaginationDto's skip/take getters.
export class TalentInterviewQueueQueryDto extends IntersectionType(TalentInterviewQueryDto, PaginationDto) {}

export class DeleteTalentDto {
  @IsOptional() @IsString() @MaxLength(64) impactVersion?: string;
  @IsOptional() @IsBoolean() force?: boolean;
}
