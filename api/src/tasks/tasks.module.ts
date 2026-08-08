import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { FlowService } from './flow.service';
import { ScoringService } from './scoring.service';
import { TeamTasksService } from './team-tasks.service';

@Module({
  imports: [],
  controllers: [TasksController],
  providers: [TasksService, FlowService, ScoringService, TeamTasksService],
  exports: [TasksService, FlowService, ScoringService, TeamTasksService],
})
export class TasksModule {}
