import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";
import { TaskStatus } from "@prisma/client";
import { PaginationDto } from "@/common/dto/pagination.dto";

export enum GoalPlanScope {
  mine = "mine",
  review = "review",
  monitor = "monitor",
}

export class GoalPlanQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(GoalPlanScope)
  scope: GoalPlanScope = GoalPlanScope.mine;

  @IsOptional()
  @IsUUID()
  cycleId?: string;

  @IsOptional()
  @IsUUID()
  deptId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  employeeName?: string;

  @IsOptional()
  @IsIn([
    "pending",
    "indicator_drafting",
    "indicator_setting",
    "indicator_reviewing",
    "indicator_dept_reviewing",
    "indicator_confirming",
    "indicator_approving",
    "goal_confirmed",
    "exempted",
  ])
  status?: TaskStatus;
}
