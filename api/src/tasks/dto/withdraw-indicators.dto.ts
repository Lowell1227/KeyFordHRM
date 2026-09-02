import { IsDateString } from 'class-validator';

export class WithdrawIndicatorsDto {
  @IsDateString()
  expectedUpdatedAt!: string;
}
