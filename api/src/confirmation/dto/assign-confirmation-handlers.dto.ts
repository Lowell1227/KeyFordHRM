import { IsUUID } from 'class-validator';

export class AssignConfirmationHandlersDto {
  @IsUUID()
  hrId!: string;

  @IsUUID()
  companyApproverId!: string;
}
