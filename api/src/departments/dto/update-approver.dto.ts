import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateApproverDto {
  @IsOptional()
  @IsString()
  @IsUUID()
  approverId?: string;
}
