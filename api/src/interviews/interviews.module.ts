import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { InterviewsController, TaskInterviewController } from './interviews.controller';
import { InterviewsService } from './interviews.service';

@Module({
  imports: [PrismaModule],
  controllers: [InterviewsController, TaskInterviewController],
  providers: [InterviewsService],
  exports: [InterviewsService],
})
export class InterviewsModule {}
