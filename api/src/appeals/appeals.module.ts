import { TasksModule } from '@/tasks/tasks.module';
import { Module } from '@nestjs/common';
import { CalibrationModule } from '@/calibration/calibration.module';
import { AppealsController } from './appeals.controller';
import { AppealsService } from './appeals.service';
import { EmployeeResultObjectionController } from './employee-result-objection.controller';

@Module({
  imports: [CalibrationModule, TasksModule],
  controllers: [AppealsController, EmployeeResultObjectionController],
  providers: [AppealsService],
  exports: [AppealsService],
})
export class AppealsModule {}
