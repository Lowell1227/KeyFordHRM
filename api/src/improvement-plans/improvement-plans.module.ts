import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { DataScopeModule } from '@/common/services/data-scope.module';
import { ImprovementPlansController } from './improvement-plans.controller';
import { ImprovementPlansService } from './improvement-plans.service';

@Module({
  imports: [PrismaModule, DataScopeModule],
  controllers: [ImprovementPlansController],
  providers: [ImprovementPlansService],
})
export class ImprovementPlansModule {}
