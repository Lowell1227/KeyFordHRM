import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsDateString,
  IsEnum,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  IsObject,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CompanyCode, EmploymentType, UserStatus } from '@prisma/client';
import { PartialType } from '@nestjs/mapped-types';

class EmployeeCreateDetailsDto {
  @IsOptional() @IsString() @MaxLength(100) position?: string | null;
  @IsOptional() @IsString() @MaxLength(50) jobGrade?: string | null;
  @IsOptional() @IsString() @MaxLength(100) jobFamily?: string | null;
  @IsOptional() @IsString() @MaxLength(100) workLocation?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(12) probationMonths?: number | null;
  @IsOptional() @IsDateString({ strict: true, strictSeparator: true }) @MaxLength(10) plannedRegularDate?: string | null;
  @IsOptional() @IsDateString({ strict: true, strictSeparator: true }) @MaxLength(10) actualRegularDate?: string | null;
  @IsOptional() @IsDateString({ strict: true, strictSeparator: true }) @MaxLength(10) leaveDate?: string | null;
}

class EmployeeCreateProfileDto {
  @IsOptional() @IsString() @MaxLength(20) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(30) gender?: string | null;
  @IsOptional() @IsDateString({ strict: true, strictSeparator: true }) @MaxLength(10) birthDate?: string | null;
  @IsOptional() @IsString() @MaxLength(50) ethnicity?: string | null;
  @IsOptional() @IsString() @MaxLength(50) education?: string | null;
  @IsOptional() @IsString() @MaxLength(100) professionalTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(200) school?: string | null;
  @IsOptional() @IsDateString({ strict: true, strictSeparator: true }) @MaxLength(10) graduationDate?: string | null;
  @IsOptional() @IsString() @MaxLength(100) major?: string | null;
  @IsOptional() @IsString() @MaxLength(30) maritalStatus?: string | null;
  @IsOptional() @IsString() @MaxLength(50) childrenStatus?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20) childrenCount?: number | null;
  @IsOptional() @IsString() @MaxLength(50) politicalStatus?: string | null;
  @IsOptional() @IsString() @MaxLength(100) nativePlace?: string | null;
  @IsOptional() @IsString() @MaxLength(50) householdType?: string | null;
  @IsOptional() @IsString() @MaxLength(500) idAddress?: string | null;
  @IsOptional() @IsString() @MaxLength(30) idNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(500) currentAddress?: string | null;
  @IsOptional() @IsString() @MaxLength(100) emergencyContactName?: string | null;
  @IsOptional() @IsString() @MaxLength(50) emergencyContactRelation?: string | null;
  @IsOptional() @IsString() @MaxLength(30) emergencyContactPhone?: string | null;
  @IsOptional() @IsString() @MaxLength(50) socialSecurityStatus?: string | null;
  @IsOptional() @IsDateString({ strict: true, strictSeparator: true }) @MaxLength(10) socialSecurityStartDate?: string | null;
  @IsOptional() @IsString() @MaxLength(50) housingFundStatus?: string | null;
  @IsOptional() @IsDateString({ strict: true, strictSeparator: true }) @MaxLength(10) housingFundStartDate?: string | null;
  @IsOptional() @IsString() @MaxLength(100) bankName?: string | null;
  @IsOptional() @IsString() @MaxLength(200) bankBranch?: string | null;
  @IsOptional() @IsString() @MaxLength(50) bankAccount?: string | null;
}

class EmployeeContractMaterialDto {
  @IsString() @IsNotEmpty() @MaxLength(255) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(2048) url!: string;
  @Type(() => Number) @IsNumber() @Min(0) size!: number;
  @IsString() @IsNotEmpty() @MaxLength(150) mimeType!: string;
}

class EmployeeCreateContractDto {
  @IsOptional() @IsString() @MaxLength(50) contractType?: string | null;
  @IsOptional() @IsString() @MaxLength(200) name?: string | null;
  @IsOptional() @IsString() @MaxLength(200) signingCompany?: string | null;
  @IsOptional() @IsDateString({ strict: true, strictSeparator: true }) @MaxLength(10) signedAt?: string | null;
  @IsOptional() @IsDateString({ strict: true, strictSeparator: true }) @MaxLength(10) effectiveFrom?: string | null;
  @IsOptional() @IsDateString({ strict: true, strictSeparator: true }) @MaxLength(10) expiresAt?: string | null;
  @IsOptional() @IsString() @MaxLength(100) termType?: string | null;
  @IsOptional() @IsString() @MaxLength(200) originalCompany?: string | null;
  @IsOptional() @IsString() @MaxLength(200) newCompany?: string | null;
  @IsOptional() @IsString() @MaxLength(200) confidentialityAgreement?: string | null;
  @IsOptional() @IsString() @MaxLength(200) nonCompeteAgreement?: string | null;
  @IsOptional() @IsString() @MaxLength(200) portraitAgreement?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) sequence?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => EmployeeContractMaterialDto)
  images?: EmployeeContractMaterialDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => EmployeeContractMaterialDto)
  attachments?: EmployeeContractMaterialDto[];
}

class EmployeeCreatePerformanceDto {
  @IsOptional()
  @IsUUID('4')
  managerId?: string | null;
}

export class CreateEmployeeDto {
  @IsOptional()
  @IsUUID('4')
  draftId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  idNumber?: string | null;

  @IsOptional()
  @IsBoolean()
  phoneDuplicateAcknowledged?: boolean = false;

  @IsEnum(CompanyCode)
  company!: CompanyCode;

  @IsUUID('4')
  deptId!: string;

  @IsOptional()
  @IsUUID('4')
  positionId?: string | null;

  @Type(() => Date)
  @IsDate()
  entryDate!: Date;

  @Type(() => Date)
  @IsDate()
  effectiveFrom!: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveTo?: Date | null;

  @IsEnum(EmploymentType)
  employmentType!: EmploymentType;

  @IsEnum(UserStatus)
  employeeStatus!: UserStatus;

  @IsOptional()
  @IsUUID('4')
  rosterManagerId?: string | null;

  @IsOptional()
  @IsUUID('4')
  performanceManagerId?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => EmployeeCreateDetailsDto)
  employee?: EmployeeCreateDetailsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EmployeeCreateProfileDto)
  profile?: EmployeeCreateProfileDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => EmployeeCreateContractDto)
  contracts?: EmployeeCreateContractDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => EmployeeCreatePerformanceDto)
  performance?: EmployeeCreatePerformanceDto;
}

export class UpdateEmployeeProfileDto {
  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  gender?: string | null;
}

export class SubmitEmployeeArchiveDraftDto {
  @IsOptional()
  @IsUUID('4')
  draftId?: string;

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

export class SaveEmployeeCreateDraftDto extends PartialType(CreateEmployeeDto) {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  draftStep?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  completedSteps?: number[];

  @IsOptional()
  @IsIn(['auto', 'manual'])
  saveMode?: 'auto' | 'manual';
}

export class EmployeeDraftQueryDto {
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
  @IsIn(['draft', 'archived'])
  state: 'draft' | 'archived' = 'draft';
}

export class ArchivePersonnelRecordsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ids!: string[];
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
  @IsUUID('4')
  positionId?: string | null;

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
