import { Module } from '@nestjs/common';
import { PeriodReviewsController } from './period-reviews.controller';
import { PeriodReviewsService } from './period-reviews.service';
import { PeriodAggregationService } from './period-aggregation.service';
import { TasksModule } from '@/tasks/tasks.module';
import { PeriodMonitoringService } from './period-monitoring.service';

@Module({
  imports: [TasksModule],
  controllers: [PeriodReviewsController],
  providers: [PeriodReviewsService, PeriodAggregationService, PeriodMonitoringService],
  exports: [PeriodReviewsService, PeriodAggregationService, PeriodMonitoringService],
})
export class PeriodReviewsModule {}
