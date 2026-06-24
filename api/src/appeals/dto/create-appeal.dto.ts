import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

/** POST /appeals — HR 录入申诉记录。 */
export class CreateAppealDto {
  @IsUUID('4')
  taskId!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  attachments?: Record<string, unknown>[];
}
