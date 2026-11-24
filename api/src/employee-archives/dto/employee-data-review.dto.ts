import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { EmployeeReviewScope } from '../employee-data-reviews.service';

export class EmployeeDataReviewQueryDto {
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

  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'all'])
  status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending';

  @IsOptional()
  @IsString()
  keyword?: string;
}

export class ApproveEmployeeDataReviewsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  requestIds!: string[];

  // Legacy clients must reach the service's refresh-required version conflict.
  @ValidateIf((_, value) => value !== undefined)
  @IsObject()
  requestVersions!: Record<string, number>;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(['profile', 'performance'], { each: true })
  scopes!: EmployeeReviewScope[];
}

export class RejectEmployeeDataReviewsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  requestIds!: string[];

  @ValidateIf((_, value) => value !== undefined)
  @IsObject()
  requestVersions!: Record<string, number>;

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;
}

export class ProposePerformanceManagerDto {
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  managerId!: string | null;
}

export class SetPendingPerformanceManagerDto {
  @IsUUID()
  managerId!: string;
}
