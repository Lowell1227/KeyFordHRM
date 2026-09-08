import { Module } from '@nestjs/common';
import { TasksModule } from '@/tasks/tasks.module';
import { CalibrationController, CalibrationCyclesController } from './calibration.controller';
import { CalibrationService } from './calibration.service';

@Module({
  imports: [TasksModule],
  controllers: [CalibrationController, CalibrationCyclesController],
  providers: [CalibrationService],
  exports: [CalibrationService],
})
export class CalibrationModule {}
