import { PartialType } from '@nestjs/mapped-types';
import { CreateTalentDto } from './create-talent.dto';
import { IsOptional, Matches } from 'class-validator';

export class UpdateTalentDto extends PartialType(CreateTalentDto) {
  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/, { message: '编辑基准无效，请重新加载资料' })
  editVersion?: string;
}
