import { IsDateString } from "class-validator";

export class WithdrawManagerScoreDto {
  @IsDateString()
  expectedUpdatedAt!: string;
}
