import { Module } from '@nestjs/common';
import { TasksModule } from '@/tasks/tasks.module';
import { NotificationsModule } from '@/notifications/notifications.module';
import { ApprovalService } from './approval.service';
import { ApprovalController, ApprovalTaskController } from './approval.controller';

@Module({
  imports: [TasksModule, NotificationsModule],
  controllers: [ApprovalController, ApprovalTaskController],
  providers: [ApprovalService],
  exports: [ApprovalService],
})
export class ApprovalModule {}
