import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { FlowService } from './flow.service';
import { ScoringService } from './scoring.service';
import { TeamTasksService } from './team-tasks.service';
import { ObjectivesModule } from '@/objectives/objectives.module';
import { IndicatorVisibilityService } from './indicator-visibility.service';
import { IndicatorVersionService } from './indicator-version.service';

@Module({
  imports: [ObjectivesModule],
  controllers: [TasksController],
  providers: [TasksService, FlowService, ScoringService, TeamTasksService, IndicatorVisibilityService, IndicatorVersionService],
  exports: [TasksService, FlowService, ScoringService, TeamTasksService, IndicatorVisibilityService, IndicatorVersionService],
})
export class TasksModule {}
