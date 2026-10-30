import { EmployeeArchivesModule } from '../employee-archives/employee-archives.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '@/auth/auth.module';
import { ObjectivesModule } from '@/objectives/objectives.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { AiConfigController } from './ai-config.controller';
import { AiConfigService } from './ai-config.service';
import { ProviderClient } from './provider-client';
import { AiProgressController } from './ai-progress.controller';
import { AiProgressService } from './ai-progress.service';
import { ProgressDraftStore } from './progress-draft.store';
import { BotEligibilityService } from './bot-eligibility.service';
import { DingtalkBotGateway } from '../dingtalk/dingtalk-bot.gateway';
import { DingtalkCardPresenter } from '../dingtalk/dingtalk-card.presenter';
import { PerformanceCardService } from '../dingtalk/performance-card.service';
import { TasksModule } from '../tasks/tasks.module';
import { PeriodReviewsModule } from '../period-reviews/period-reviews.module';
import { ImprovementPlansModule } from '../improvement-plans/improvement-plans.module';

@Module({
  imports: [EmployeeArchivesModule, PrismaModule, AuthModule, ObjectivesModule, TasksModule, PeriodReviewsModule, ImprovementPlansModule],
  controllers: [AiConfigController, AiProgressController],
  providers: [
    AiConfigService,
    ProviderClient,
    AiProgressService,
    ProgressDraftStore,
    BotEligibilityService,
    DingtalkBotGateway,
    DingtalkCardPresenter,
    PerformanceCardService,
  ],
  exports: [AiConfigService, ProviderClient, AiProgressService, BotEligibilityService],
})
export class AiProgressModule {}
