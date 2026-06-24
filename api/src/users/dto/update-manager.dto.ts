import { IsOptional, IsUUID } from 'class-validator';

export class UpdateManagerDto {
  @IsOptional()
  @IsUUID()
  directManagerId?: string | null;
}
