import { IsUUID } from 'class-validator';

export class IndicatorMapQueryDto {
  @IsUUID('4')
  cycleId!: string;
}
