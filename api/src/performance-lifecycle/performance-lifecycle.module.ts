import { Module } from '@nestjs/common';
import { TasksModule } from '@/tasks/tasks.module';
import { GoalPlansModule } from '@/goal-plans/goal-plans.module';
import { GoalChangesModule } from '@/goal-changes/goal-changes.module';
import { ImprovementPlansModule } from '@/improvement-plans/improvement-plans.module';
import { ConfirmationModule } from '@/confirmation/confirmation.module';
import { PerformanceLifecycleController } from './performance-lifecycle.controller';
import { PerformanceLifecycleService } from './performance-lifecycle.service';

@Module({ imports: [TasksModule, GoalPlansModule, GoalChangesModule, ImprovementPlansModule, ConfirmationModule],
  controllers: [PerformanceLifecycleController], providers: [PerformanceLifecycleService], exports: [PerformanceLifecycleService] })
export class PerformanceLifecycleModule {}
