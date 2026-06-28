import { IsOptional, IsUUID } from 'class-validator';

export class UpdateLeaderDto {
  @IsOptional()
  @IsUUID()
  leaderId?: string;
}
