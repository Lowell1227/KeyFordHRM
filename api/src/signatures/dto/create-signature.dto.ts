import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { SignatureBusinessType, SignatureMethod, SignatureRole } from '@prisma/client';

/** POST /signatures 请求体。 */
export class CreateSignatureDto {
  @IsEnum(SignatureBusinessType)
  businessType!: SignatureBusinessType;

  @IsUUID()
  businessRecordId!: string;

  @IsEnum(SignatureRole)
  role!: SignatureRole;

  @IsOptional()
  @IsEnum(SignatureMethod)
  method?: SignatureMethod;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
