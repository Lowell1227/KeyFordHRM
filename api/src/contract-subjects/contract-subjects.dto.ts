import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { CompanyCode } from '@prisma/client';

export class ContractSubjectQueryDto {
  @IsOptional()
  @Transform(({ obj, key }) => obj[key] === 'true' ? true : obj[key] === 'false' ? false : obj[key])
  @IsBoolean()
  includeInactive?: boolean;
}
export class CreateContractSubjectDto {
  @IsOptional() @IsEnum(CompanyCode)
  internalCompany?: CompanyCode | null;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @IsNotEmpty() @MaxLength(150)
  name!: string;
}
export class UpdateContractSubjectDto {
  @IsOptional() @IsEnum(CompanyCode)
  internalCompany?: CompanyCode | null;
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @IsNotEmpty() @MaxLength(150)
  name?: string;
  @IsOptional()
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  isActive?: boolean;
}
