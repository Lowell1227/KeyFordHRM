import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CompanyCode, EmploymentType, UserStatus } from '@prisma/client';

export class ContractReferenceDto {
  @IsString() @MaxLength(100) kind!: string;
  @IsString() @MaxLength(500) reference!: string;
}

export class EmployeeReentryFieldsDto {
  @IsIn(Object.values(CompanyCode)) company!: CompanyCode;
  @IsOptional() @IsUUID('4') deptId?: string | null;
  @IsOptional() @IsUUID('4') positionId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) position?: string | null;
  @IsOptional() @IsUUID('4') rosterManagerId?: string | null;
  @IsOptional() @IsUUID('4') performanceManagerId?: string | null;
  @Type(() => Date) @IsDate() effectiveDate!: Date;
  @IsOptional() @Type(() => Date) @IsDate() effectiveTo?: Date | null;
  @IsIn([UserStatus.active, UserStatus.probation]) employeeStatus!: UserStatus;
  @IsIn(Object.values(EmploymentType)) employmentType!: EmploymentType;
  @IsOptional() @Type(() => Date) @IsDate() plannedRegularDate?: Date | null;
  @IsOptional() @IsInt() @Min(0) @Max(60) probationMonths?: number | null;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ContractReferenceDto)
  contractReferences?: ContractReferenceDto[];
}

export class CreateEmployeeReentryDto extends EmployeeReentryFieldsDto {
  @IsOptional() @IsString() @MaxLength(40) sourceSystem?: string;
  @IsOptional() @IsString() @MaxLength(100) sourceReference?: string;
}

export class ReviseEmployeeReentryDto extends EmployeeReentryFieldsDto {}

export class CancelEmployeeReentryDto {
  @IsString() @MaxLength(500) reason!: string;
}

export class IdentitySnapshotDto {
  @IsString() @MaxLength(50) name!: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(100) email?: string;
  @IsOptional() @IsString() @MaxLength(30) idNumber?: string;
}

export class EmployeeIdentityLookupDto {
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(30) idNumber?: string;
}

export type EmployeeIdentityCandidate = {
  id: string;
  maskedName: string;
  currentEmployeeNo: string | null;
  matchedHistoricalEmployeeNo: string | null;
  status: 'active' | 'probation' | 'pending_entry' | 'resigned';
  archived: boolean;
  departmentName: string | null;
  matchBasis: 'id_number' | 'phone';
  nextAction: 'reentry' | 'view_profile' | 'edit_profile' | 'view_onboarding' | 'confirm_phone';
};

export type EmployeeIdentityLookupResult = {
  outcome: 'none' | 'phone_candidates' | 'identity_match' | 'conflict';
  candidates: EmployeeIdentityCandidate[];
};

export class CreateOnboardingIntakeDto extends EmployeeReentryFieldsDto {
  @IsString() @MaxLength(40) sourceSystem!: string;
  @IsString() @MaxLength(100) sourceReference!: string;
  @IsIn(['new_hire', 'reentry']) intakeType!: 'new_hire' | 'reentry';
  @IsOptional() @IsUUID('4') existingEmployeeId?: string;
  @IsObject() @ValidateNested() @Type(() => IdentitySnapshotDto) identitySnapshot!: IdentitySnapshotDto;
}

export type OnboardingRequestView = {
  id: string;
  userId: string | null;
  employeeName: string;
  employeeNo: string | null;
  intakeType: 'new_hire' | 'reentry' | null;
  onboardingStatus: 'draft' | 'submitted' | 'pending_entry' | 'effective' | 'cancelled' | null;
  requestVersion: number;
  recordStatus: string;
  proposedValue: Record<string, unknown>;
  validationWarnings: Array<{ field: string; message: string }>;
  createdAt: Date;
  updatedAt: Date;
};

export type OnboardingIntakeResult = {
  intakeId: string;
  matchStatus: 'new' | 'matched_reentry' | 'needs_review' | 'conflict';
  matchedEmployeeId: string | null;
  recordStatus: string;
  nextAction: 'complete_new_hire_draft' | 'review_employee_match' | 'submit_hr_review';
};
