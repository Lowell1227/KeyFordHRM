import { Module } from '@nestjs/common';
import { PeriodReviewsController } from './period-reviews.controller';
import { PeriodReviewsService } from './period-reviews.service';

@Module({
  controllers: [PeriodReviewsController],
  providers: [PeriodReviewsService],
  exports: [PeriodReviewsService],
})
export class PeriodReviewsModule {}
