import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { BooleanQuery } from '@/common/dto/boolean-query';
import type { PayrollAttendanceInput, PayrollAttendanceType, PayrollOvertimeKind } from '../payroll-attendance-normalizer';

export class PayrollSubjectDto { @IsUUID() subjectId!: string; }
export class PayrollBatchQueryDto extends PayrollSubjectDto {
  @IsOptional() @Matches(/^[2-9]\d{3}-(0[1-9]|1[0-2])$/) month?: string;
}
export class PayrollMonthDto extends PayrollSubjectDto { @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month!: string; }
export class PayrollFixtureDto extends PayrollMonthDto { @IsOptional() @BooleanQuery() @IsBoolean() corrected = false; }
export class PayrollVersionDto { @IsInt() @Min(0) expectedVersion!: number; }
export class PayrollDeductionsPreviewDto extends PayrollVersionDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) payDate!: string;
  @IsIn(['complete', 'missing']) mode!: 'complete' | 'missing';
}
export class PayrollNoteDto extends PayrollVersionDto { @IsString() @Length(1, 500) note!: string; }
export class PayrollDecisionDto extends PayrollVersionDto {
  @IsIn(['approve', 'return']) decision!: 'approve' | 'return';
  @IsString() @MaxLength(500) note!: string;
}
export class PayrollVoidDto extends PayrollNoteDto { @BooleanQuery() @IsBoolean() confirmedUnpaid!: boolean; }
export class PayrollCreateDto extends PayrollMonthDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) payMonth!: string;
  @IsIn(['trial', 'validation', 'formal']) purpose!: 'trial' | 'validation' | 'formal';
  @IsOptional() @IsUUID() correctionOfId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(11) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { each: true }) additionalMonths?: string[];
}
export class PayrollSettlementDto extends PayrollVersionDto {
  @IsUUID() lineId!: string;
  @IsString() @Matches(/^-?\d{1,12}(\.\d{1,2})?$/) amount!: string;
  @IsString() @Length(1, 200) reference!: string;
  @IsUUID() requestId!: string;
}
export class PayrollRemainderDto extends PayrollVersionDto { @IsUUID() lineId!: string; @IsString() @Length(1, 200) reference!: string; }
export class PayrollExportDto extends PayrollVersionDto { @IsString() @Length(4, 64) filePassword!: string; }
export class PayrollStandardDto extends PayrollSubjectDto {
  @IsUUID() employeeId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom!: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveTo?: string;
  @IsOptional() @IsString() @MaxLength(18) fixedMonthly!: string | null;
  @IsOptional() @IsString() @MaxLength(18) performanceBase!: string | null;
  @IsOptional() @IsIn(['included', 'additional', 'none']) performanceMode!: 'included' | 'additional' | 'none' | null;
  @IsString() @Length(1, 500) evidence!: string;
}
export class PayrollRuleDto extends PayrollSubjectDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom!: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveTo?: string;
  @IsObject() config!: object;
}
export class PayrollOpeningDto extends PayrollMonthDto {
  @IsUUID() employeeId!: string;
  @IsIn(['fixed', 'absence', 'overtime', 'performance', 'adjustment']) itemCode!: string;
  @IsString() @Matches(/^-?\d{1,12}(\.\d{1,2})?$/) amount!: string;
  @IsString() @Length(1, 200) reference!: string;
}
export class PayrollAdjustmentDto extends PayrollOpeningDto { @IsString() @Length(1, 500) reason!: string; }
class AttendanceExpectedDto {
  @IsUUID() employeeId!: string;
  @IsString() @MaxLength(10) workDate!: string;
  @IsString() @MaxLength(30) units!: string;
  @BooleanQuery() @IsBoolean() required!: boolean;
}
class AttendanceRecordDto {
  @IsString() @Length(1, 150) sourceId!: string;
  @IsInt() @Min(0) sourceVersion!: number;
  @IsUUID() employeeId!: string;
  @IsString() @MaxLength(10) workDate!: string;
  @IsString() @MaxLength(40) startsAt!: string;
  @IsString() @MaxLength(40) endsAt!: string;
  @IsIn(['normal', 'paid_leave', 'unpaid_leave', 'sick_leave', 'business_trip', 'outing', 'makeup', 'overtime', 'missing_punch', 'absence', 'not_required']) type!: PayrollAttendanceType;
  @IsIn(['effective', 'pending', 'revoked']) state!: 'effective' | 'pending' | 'revoked';
  @IsString() @MaxLength(30) hours!: string;
  @IsIn(['hour', 'day', 'unknown']) unit!: 'hour' | 'day' | 'unknown';
  @IsOptional() @IsIn(['weekday', 'restday', 'holiday']) overtimeKind?: PayrollOvertimeKind;
}
class AttendanceInputDto implements PayrollAttendanceInput {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month!: string;
  @IsArray() @ArrayMaxSize(10000) @ValidateNested({ each: true }) @Type(() => AttendanceExpectedDto) expected!: AttendanceExpectedDto[];
  @IsArray() @ArrayMaxSize(20000) @ValidateNested({ each: true }) @Type(() => AttendanceRecordDto) records!: AttendanceRecordDto[];
}
class AttendanceScopeDto {
  @IsArray() @ArrayMaxSize(1000) @IsUUID(undefined, { each: true }) employeeIds!: string[];
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to!: string;
}
export class PayrollAttendanceSyncDto extends PayrollMonthDto {
  @IsString() @Length(1, 100) sourceKey!: string;
  @ValidateNested() @Type(() => AttendanceInputDto) @IsObject() input!: AttendanceInputDto;
  @IsOptional() @BooleanQuery() @IsBoolean() complete?: boolean;
  @IsOptional() @ValidateNested() @Type(() => AttendanceScopeDto) @IsObject() scope?: AttendanceScopeDto;
}
export class PayrollAttendanceReviewDto {
  @IsString() @Length(1, 500) note!: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) workDate?: string;
}
