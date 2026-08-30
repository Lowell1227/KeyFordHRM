import { Module } from '@nestjs/common';
import { PeriodReviewsController } from './period-reviews.controller';
import { PeriodReviewsService } from './period-reviews.service';
import { PeriodAggregationService } from './period-aggregation.service';
import { TasksModule } from '@/tasks/tasks.module';

@Module({
  imports: [TasksModule],
  controllers: [PeriodReviewsController],
  providers: [PeriodReviewsService, PeriodAggregationService],
  exports: [PeriodReviewsService, PeriodAggregationService],
})
export class PeriodReviewsModule {}
