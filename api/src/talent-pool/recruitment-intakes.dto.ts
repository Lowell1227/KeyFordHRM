import { OmitType, PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';
import { CreateTalentDto } from './dto/create-talent.dto';
import { CreateTalentApplicationDto } from './dto/talent-recruitment.dto';
import { TALENT_SOURCE_CHANNELS } from './talent.constants';
import { RECRUITMENT_INTAKE_STATES } from './recruitment-intakes.types';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class RecruitmentIntakeCandidateDraftDto extends PartialType(CreateTalentDto) {}
export class RecruitmentIntakeApplicationDraftDto extends PartialType(CreateTalentApplicationDto) {}
export class RecruitmentIntakeQueryDto extends PaginationDto {
  @IsOptional() @IsString() @MaxLength(100) keyword?: string;
  @IsOptional() @IsIn(RECRUITMENT_INTAKE_STATES) state?: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsUUID() demandId?: string;
  @IsOptional() @IsUUID() postingId?: string;
  @IsOptional() @IsIn(TALENT_SOURCE_CHANNELS) sourceChannel?: string;
  @IsOptional() @IsIn(['review', 'assignment']) workQueue?: 'review' | 'assignment';
}
export class CreateRecruitmentIntakeDto {
  @IsUUID() requestId!: string;
  @IsOptional() @IsIn(['awaiting_resume', 'pending_review', 'needs_material']) state?: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsIn(TALENT_SOURCE_CHANNELS) sourceChannel?: string | null;
  @IsOptional() @IsUUID() postingId?: string | null;
  @IsOptional() @IsUUID() demandId?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) positionName?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) sourceNotes?: string | null;
  @IsOptional() @IsISO8601({ strict: true, strictSeparator: true }) nextFollowUpAt?: string | null;
  @IsOptional() @ValidateNested() @Type(() => RecruitmentIntakeCandidateDraftDto) candidateDraft?: RecruitmentIntakeCandidateDraftDto | null;
  @IsOptional() @ValidateNested() @Type(() => RecruitmentIntakeApplicationDraftDto) applicationDraft?: RecruitmentIntakeApplicationDraftDto | null;
}
export class UpdateRecruitmentIntakeDto extends PartialType(OmitType(CreateRecruitmentIntakeDto, ['requestId'] as const)) {
  @IsInt() @Min(1) @Max(2147483646) expectedRevision!: number;
}
export class RecruitmentIntakeVersionDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483646) expectedRevision!: number;
}
export class ParseRecruitmentIntakeDto extends RecruitmentIntakeVersionDto {
  @IsOptional() @IsUUID() fileId?: string;
}
export class ConfirmRecruitmentIntakeDto extends RecruitmentIntakeVersionDto {
  @IsUUID() requestId!: string;
  @IsIn(['candidate_only', 'candidate_application']) mode!: 'candidate_only' | 'candidate_application';
  @IsOptional() @IsUUID() existingCandidateId?: string;
  @IsOptional() @ValidateNested() @Type(() => CreateTalentDto) candidate?: CreateTalentDto;
  @IsOptional() @ValidateNested() @Type(() => CreateTalentApplicationDto) application?: CreateTalentApplicationDto;
  @IsOptional() @IsUUID() existingApplicationId?: string;
  @IsOptional() @IsInt() @Min(0) @Max(2147483646) expectedExistingApplicationRevision?: number;
}
export class CloseRecruitmentIntakeDto extends RecruitmentIntakeVersionDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(2000) reason!: string;
}
export class AssociateRecruitmentIntakeDto extends RecruitmentIntakeVersionDto {
  @IsUUID() targetIntakeId!: string;
  @IsInt() @Min(1) @Max(2147483646) expectedTargetRevision!: number;
}
export class SyncRecruitmentMailboxDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit = 10;
}
