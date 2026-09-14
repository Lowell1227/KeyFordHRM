import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class AssignConfirmationHandlersDto {
  @IsUUID()
  hrId!: string;

  @IsUUID()
  companyApproverId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
