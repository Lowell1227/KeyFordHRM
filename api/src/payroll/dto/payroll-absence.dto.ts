import { IsIn, IsInt, IsString, IsUUID, Length, Matches, MaxLength, Min } from 'class-validator';

export class PayrollAbsenceProposeDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsUUID() employeeId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) workDate!: string;
  @IsString() @Length(1, 500) reference!: string;
  @IsUUID() requestId!: string;
}
export class PayrollAbsenceDecisionDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(['approve', 'return', 'revoke']) decision!: 'approve' | 'return' | 'revoke';
  @IsString() @MaxLength(500) note!: string;
}
