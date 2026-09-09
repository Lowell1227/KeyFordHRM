import { TasksModule } from '@/tasks/tasks.module';
import { Module } from '@nestjs/common';
import { CalibrationModule } from '@/calibration/calibration.module';
import { AppealsController } from './appeals.controller';
import { AppealsService } from './appeals.service';

@Module({
  imports: [CalibrationModule, TasksModule],
  controllers: [AppealsController],
  providers: [AppealsService],
  exports: [AppealsService],
})
export class AppealsModule {}
