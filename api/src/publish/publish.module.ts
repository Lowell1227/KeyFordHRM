import { Module } from '@nestjs/common';
import { TasksModule } from '@/tasks/tasks.module';
import { PublishService } from './publish.service';
import { PublishController } from './publish.controller';

@Module({
  imports: [TasksModule],
  controllers: [PublishController],
  providers: [PublishService],
  exports: [PublishService],
})
export class PublishModule {}
