import { Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsDate,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { InterviewMethod } from '@prisma/client';

/** 填写/更新绩效面谈记录请求体。 */
export class UpdateInterviewDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  interviewTime?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsEnum(InterviewMethod)
  method?: InterviewMethod;

  @IsOptional()
  @IsBoolean()
  scoreInformed?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  achievements?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  weaknesses?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  nextGoals?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  remediation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  supportNeeded?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  otherMatters?: string;
}
