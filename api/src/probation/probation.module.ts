import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { ProbationController } from './probation.controller';
import { ProbationService } from './probation.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProbationController],
  providers: [ProbationService],
  exports: [ProbationService],
})
export class ProbationModule {}
