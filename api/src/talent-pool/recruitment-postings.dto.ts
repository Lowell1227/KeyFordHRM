import { OmitType, PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class RecruitmentPostingQueryDto extends PaginationDto {
  @IsOptional() @IsString() @MaxLength(100) keyword?: string;
  @IsOptional() @IsUUID() demandId?: string;
}
export class CreateRecruitmentPostingDto {
  @IsUUID() requestId!: string;
  @IsUUID() demandId!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) channel!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @Transform(trim) @IsString() @MaxLength(2000) url!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) externalId?: string | null;
  @Type(() => Object) @IsBoolean() verifiedIdentity!: boolean;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) evidence?: string | null;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @Type(() => Object) @IsBoolean() active?: boolean;
}
export class UpdateRecruitmentPostingDto extends PartialType(OmitType(CreateRecruitmentPostingDto, ['requestId'] as const)) {
  @IsInt() @Min(1) @Max(2147483646) expectedRevision!: number;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(2000) reason!: string;
}
