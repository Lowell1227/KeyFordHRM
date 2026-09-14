import { IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/** POST /appeals — HR 录入申诉记录。 */
export class CreateAppealDto {
  @IsUUID('4')
  employeeId!: string;

  @IsOptional()
  @IsUUID('4')
  cycleId?: string | null;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  receivedAt!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content!: string;

  @IsString()
  @IsOptional()
  @MaxLength(10000)
  handlingNote?: string;

  @IsString()
  @IsOptional()
  @MaxLength(10000)
  conclusion?: string;
}
