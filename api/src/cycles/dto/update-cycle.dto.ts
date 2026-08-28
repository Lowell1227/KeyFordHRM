import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { CreateCycleDto } from './create-cycle.dto';

export class UpdateCycleDto extends PartialType(CreateCycleDto) {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedPlanVersion!: number;
}
