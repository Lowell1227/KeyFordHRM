import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { FlowService } from './flow.service';
import { ScoringService } from './scoring.service';

@Module({
  imports: [],
  controllers: [TasksController],
  providers: [TasksService, FlowService, ScoringService],
  exports: [TasksService, FlowService, ScoringService],
})
export class TasksModule {}
