import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';
import { TeamStageState, TeamTaskStage } from '../team-task-stage';

export class TeamTaskQueryDto extends PaginationDto {
  @IsIn(['goal-review', 'manager-eval'])
  stage!: TeamTaskStage;

  @IsOptional()
  @IsIn(['not_started', 'pending', 'completed', 'exempted'])
  stageState?: TeamStageState;

  @IsOptional()
  @IsUUID()
  cycleId?: string;

  @IsOptional()
  @IsUUID()
  deptId?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}
