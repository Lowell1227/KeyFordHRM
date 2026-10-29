import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { CurrentUser } from "@/common/decorators/current-user.decorator";
import { AuthUser } from "@/common/types/auth.types";
import { GoalPlanQueryDto } from "./goal-plans.dto";
import { GoalPlansService } from "./goal-plans.service";

@Controller("goal-plans")
export class GoalPlansController {
  constructor(private readonly service: GoalPlansService) {}

  @Get()
  findAll(@Query() query: GoalPlanQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.service.findAll(query, viewer);
  }

  @Get("options")
  options(@Query() query: GoalPlanQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.service.options(query, viewer);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.service.findOne(id, viewer);
  }
}
