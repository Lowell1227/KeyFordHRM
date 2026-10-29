import { Module } from "@nestjs/common";
import { GoalPlansController } from "./goal-plans.controller";
import { GoalPlansService } from "./goal-plans.service";

@Module({ controllers: [GoalPlansController], providers: [GoalPlansService] })
export class GoalPlansModule {}
