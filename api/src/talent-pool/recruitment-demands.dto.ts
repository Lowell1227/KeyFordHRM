import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';

export class RecruitmentDemandQueryDto extends PaginationDto {
  @IsOptional() @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MaxLength(100) keyword?: string;
  @IsOptional() @IsIn(['pending', 'approved', 'rejected', 'withdrawn', 'unknown']) status?: string;
}

export class RecruitmentDemandOptionsQueryDto extends PaginationDto {
  @IsUUID() applicationId!: string;
  @IsOptional() @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MaxLength(100) keyword?: string;
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
