import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class PositionQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeInactive = false;
}

export class CreatePositionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  jobFamily?: string | null;
}

export class UpdatePositionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  jobFamily?: string | null;
}

export class PositionChangeReviewQueryDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'all'])
  status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class RejectPositionChangeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;
}

export class PositionIdDto {
  @IsUUID('4')
  id!: string;
}
