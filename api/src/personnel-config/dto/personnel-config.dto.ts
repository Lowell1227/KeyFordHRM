import { IsIn } from 'class-validator';

export class UpdateReviewModeDto {
  @IsIn(['relaxed', 'standard'])
  mode: 'relaxed' | 'standard';
}
