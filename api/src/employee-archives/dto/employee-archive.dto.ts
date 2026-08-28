import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { CompanyCode, EmploymentType, UserStatus } from '@prisma/client';

export class UpdateEmployeeProfileDto {
  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  gender?: string | null;
}

export class SubmitEmployeeArchiveDraftDto {
  @IsObject()
  employee!: Record<string, unknown>;

  @IsObject()
  profile!: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  contracts?: Record<string, unknown>[];

  @IsOptional()
  @IsObject()
  performance?: Record<string, unknown>;
}

export class SubmitDepartmentAssignmentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  userIds!: string[];

  @IsUUID('4')
  departmentId!: string;
}

export class CreateEmploymentRecordDto {
  @Type(() => Date)
  @IsDate()
  effectiveFrom!: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveTo?: Date | null;

  @IsEnum(CompanyCode)
  company!: CompanyCode;

  @IsOptional()
  @IsUUID()
  deptId?: string | null;

  @IsOptional()
  @IsString()
  position?: string | null;

  @IsOptional()
  @IsString()
  jobGrade?: string | null;

  @IsOptional()
  @IsString()
  jobFamily?: string | null;

  @IsOptional()
  @IsUUID()
  directManagerId?: string | null;

  @IsOptional()
  @IsString()
  workLocation?: string | null;

  @IsEnum(EmploymentType)
  employmentType!: EmploymentType;

  @IsEnum(UserStatus)
  employeeStatus!: UserStatus;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  entryDate?: Date | null;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  plannedRegularDate?: Date | null;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  actualRegularDate?: Date | null;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  leaveDate?: Date | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(12)
  probationMonths?: number | null;

  @IsString()
  @IsNotEmpty()
  changeType!: string;

  @IsOptional()
  @IsString()
  reason?: string | null;

  @IsOptional()
  @IsString()
  sourceType?: string | null;

  @IsOptional()
  @IsUUID()
  sourceBatchId?: string | null;
}

export class BindDingtalkIdentityDto {
  @IsOptional()
  @IsString()
  externalUserId?: string | null;

  @IsString()
  @IsNotEmpty()
  externalUnionId!: string;
}

export class SetDingtalkIdentityStateDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  reason?: string | null;
}

export class PreviewEmployeeRosterDto {
  @IsEnum(['full', 'incremental'])
  mode!: 'full' | 'incremental';
}
