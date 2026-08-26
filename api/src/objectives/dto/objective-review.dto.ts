import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveObjectiveDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class RequestObjectiveChangesDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  comment!: string;
}
