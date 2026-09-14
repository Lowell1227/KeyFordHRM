import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { DataScopeModule } from '@/common/services/data-scope.module';
import { ImprovementPlansController } from './improvement-plans.controller';
import { ImprovementWorkflowService } from './improvement-workflow.service';

@Module({
  imports: [PrismaModule, DataScopeModule],
  controllers: [ImprovementPlansController],
  providers: [ImprovementWorkflowService],
})
export class ImprovementPlansModule {}
