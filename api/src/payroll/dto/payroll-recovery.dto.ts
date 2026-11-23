import { Transform } from 'class-transformer';
import { IsInt, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class PayrollRecoverScopeDto {
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) snapshotVersion!: number;
  @Matches(/^[a-f0-9]{64}$/) snapshotHash!: string;
  @Matches(/^[a-f0-9]{64}$/) scopeHash!: string;
  @Transform(trim) @IsString() @Length(1, 500) reason!: string;
  @IsUUID() requestId!: string;
}
export class PayrollCorrectOpeningDto {
  @Matches(/^[a-f0-9]{64}$/) expectedHash!: string;
  @Matches(/^-?\d{1,12}(\.\d{1,2})?$/) amount!: string;
  @Transform(trim) @IsString() @Length(1, 200) reference!: string;
  @Transform(trim) @IsString() @Length(1, 500) reason!: string;
  @IsUUID() requestId!: string;
}
