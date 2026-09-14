import { Type } from 'class-transformer';
import { VoteResult } from '@prisma/client';
import { IsBoolean, IsDate, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveConfirmationDto {
  @IsOptional()
  @IsBoolean()
  recommendation?: boolean;

  @IsOptional()
  @IsEnum(VoteResult)
  voteResult?: VoteResult;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  voteComment?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  meetingDate?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  proposedRegularDate?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  confirmedRegularDate?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
