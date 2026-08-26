import {
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ApproveObjectiveDto {
  @IsNotEmpty()
  @IsISO8601()
  expectedUpdatedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class RequestObjectiveChangesDto {
  @IsNotEmpty()
  @IsISO8601()
  expectedUpdatedAt!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  comment!: string;
}
