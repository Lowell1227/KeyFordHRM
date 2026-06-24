import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { VoteResult } from '@prisma/client';

export class CreateConfirmationDto {
  @IsUUID()
  employeeId!: string;

  @IsOptional()
  @IsUUID()
  probationReviewId?: string;

  @IsUUID()
  managerId!: string;

  @IsUUID()
  hrId!: string;

  @IsUUID()
  companyApproverId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  summary?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  salary?: number;

  @IsOptional()
  @IsEnum(VoteResult)
  voteResult?: VoteResult;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  voteParticipants?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  voteComment?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  voteMeetingTime?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  actualRegularDate?: Date;
}
