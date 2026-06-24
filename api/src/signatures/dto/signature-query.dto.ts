import { IsEnum, IsUUID } from 'class-validator';
import { SignatureBusinessType } from '@prisma/client';

/** GET /signatures 查询参数。 */
export class SignatureQueryDto {
  @IsEnum(SignatureBusinessType)
  businessType!: SignatureBusinessType;

  @IsUUID()
  businessRecordId!: string;
}
