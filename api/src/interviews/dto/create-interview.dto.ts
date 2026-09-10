import { IsDate, IsOptional, IsUUID } from 'class-validator';
import { OmitType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { UpdateInterviewDto } from './update-interview.dto';

export class CreateInterviewDto extends OmitType(UpdateInterviewDto, ['interviewTime'] as const) {
  @IsUUID('4')
  employeeId!: string;

  @Type(() => Date)
  @IsDate()
  interviewTime!: Date;

  @IsOptional()
  @IsUUID('4')
  cycleId?: string;

  @IsOptional()
  @IsUUID('4')
  interviewerId?: string;
}
