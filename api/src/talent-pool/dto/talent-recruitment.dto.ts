import { PartialType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';
import { TALENT_APPLICATION_ACTIONS, TALENT_RESERVE_REASONS, type TalentApplicationAction, type TalentReserveReason } from '../talent-recruitment-policy';

export class TalentOwnerQueryDto extends PaginationDto {
  @IsOptional() @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MaxLength(100) keyword?: string;
}

class TalentApplicationFields {
  @IsString() @MinLength(1) @MaxLength(100) positionName!: string;
  @IsOptional() @IsString() @MaxLength(100) recruitmentBatch?: string | null;
  @IsOptional() @IsUUID() deptId?: string | null;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) expectedEntryDate?: string | null;
}

export class CreateTalentApplicationDto extends TalentApplicationFields {
  @IsOptional() @IsUUID() requestId?: string;
}

export class UpdateTalentApplicationDto extends PartialType(TalentApplicationFields) {
  @IsInt() @Min(0) @Max(2147483646) expectedRevision!: number;
}

export class TalentApplicationActionDto {
  @IsInt() @Min(0) @Max(2147483646) expectedRevision!: number;
  @IsIn(TALENT_APPLICATION_ACTIONS) action!: TalentApplicationAction;
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
