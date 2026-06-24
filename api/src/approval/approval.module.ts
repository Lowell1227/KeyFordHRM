import { Module } from '@nestjs/common';
import { TasksModule } from '@/tasks/tasks.module';
import { ApprovalService } from './approval.service';
import { ApprovalController, ApprovalTaskController } from './approval.controller';

@Module({
  imports: [TasksModule],
  controllers: [ApprovalController, ApprovalTaskController],
  providers: [ApprovalService],
  exports: [ApprovalService],
})
export class ApprovalModule {}
