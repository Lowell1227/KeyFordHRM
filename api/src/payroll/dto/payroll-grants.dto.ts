import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';
import { PAYROLL_CAPABILITIES, type PayrollCapability } from '../payroll-access';

export const PAYROLL_GRANT_CAPABILITIES = PAYROLL_CAPABILITIES.filter(
  (capability): capability is Exclude<PayrollCapability, 'payroll_parameter_review'> => capability !== 'payroll_parameter_review',
);

export class PayrollGrantQueryDto {
  @IsOptional() @IsUUID() subjectId?: string;
  @IsIn(['all', 'active', 'revoked']) status: 'all' | 'active' | 'revoked' = 'all';
}

export class PayrollGrantRevokeDto {
  @IsString() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  expectedUpdatedAt!: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 500) reason!: string;
}

export class PayrollGrantSaveDto {
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID() subjectId!: string;
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID() userId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(PAYROLL_GRANT_CAPABILITIES.length) @ArrayUnique() @IsIn(PAYROLL_GRANT_CAPABILITIES, { each: true })
  capabilities!: string[];
  @ValidateIf((_object, value) => value !== null)
  @IsString() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  expectedUpdatedAt!: string | null;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 500) reason!: string;
}
