import { Module } from '@nestjs/common';
import { FinalGradeController } from './final-grade.controller';
import { FinalGradeService } from './final-grade.service';
import { TasksModule } from '@/tasks/tasks.module';
import { NotificationsModule } from '@/notifications/notifications.module';

@Module({
  imports: [TasksModule, NotificationsModule],
  controllers: [FinalGradeController],
  providers: [FinalGradeService],
  exports: [FinalGradeService],
})
export class FinalGradeModule {}
