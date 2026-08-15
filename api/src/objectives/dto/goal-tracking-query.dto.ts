import { IsOptional, IsUUID } from 'class-validator';

export class GoalTrackingQueryDto {
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsUUID()
  cycleId?: string;

  @IsOptional()
  @IsUUID()
  objectiveId?: string;
}
