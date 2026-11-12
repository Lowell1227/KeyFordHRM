import { PartialType, OmitType } from '@nestjs/mapped-types';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class CreateTalentInterviewDto {
  @IsOptional() @IsUUID() requestId?: string;
  @IsUUID() candidateId!: string;
  @IsISO8601({ strict: true }) startsAt!: string;
  @IsISO8601({ strict: true }) endsAt!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ArrayUnique() @IsUUID('all', { each: true }) participantIds!: string[];
  @IsString() @MinLength(1) @MaxLength(10000) invitationText!: string;
  @IsOptional() @IsString() @MaxLength(1000) meetingUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) note?: string | null;
}

export class UpdateTalentInterviewDto extends PartialType(OmitType(CreateTalentInterviewDto, ['candidateId', 'requestId'] as const)) {
  @IsInt() @Min(1) version!: number;
}

export class InterviewVersionDto {
  @IsInt() @Min(1) version!: number;
}

export class TalentInterviewQueryDto {
  @IsOptional() @IsIn(['mine', 'created']) scope?: 'mine' | 'created';
  @IsOptional() @IsUUID() candidateId?: string;
}

export class DeleteTalentDto {
  @IsOptional() @IsString() @MaxLength(64) impactVersion?: string;
  @IsOptional() @IsBoolean() force?: boolean;
}
