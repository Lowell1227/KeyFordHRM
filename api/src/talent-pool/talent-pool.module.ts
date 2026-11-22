import { Module } from '@nestjs/common';
import { AuthModule } from '@/auth/auth.module';
import { StorageModule } from '@/storage/storage.module';
import { AiProgressModule } from '@/ai-progress/ai-progress.module';
import { TalentsController } from './talents.controller';
import { TalentSharesController } from './talent-shares.controller';
import { TalentsService } from './talents.service';
import { TalentFilesService } from './talent-files.service';
import { TalentFollowUpsService } from './talent-follow-ups.service';
import { TalentSharesService } from './talent-shares.service';
import { TalentShareSessionGuard } from './talent-share-session.guard';
import { TalentInterviewsService } from './talent-interviews.service';
import { TalentInterviewsController } from './talent-interviews.controller';
import { TalentRecruitmentController } from './talent-recruitment.controller';
import { TalentRecruitmentService } from './talent-recruitment.service';
import { TalentResumeController } from './talent-resume.controller';
import { TalentResumeService } from './talent-resume.service';
import { TalentResumeClient } from './talent-resume-client';
import { TalentResumeTasksController } from './talent-resume-tasks.controller';
import { TalentResumeTasksService } from './talent-resume-tasks.service';
import { TalentWorkbenchController } from './talent-workbench.controller';
import { TalentWorkbenchService } from './talent-workbench.service';

/** 人才库（MVP）：候选人录入 / 检索 / 跟进 / 转员工 / 单条只读转发。 */
@Module({
  imports: [StorageModule, AiProgressModule, AuthModule],
  controllers: [TalentsController, TalentSharesController, TalentInterviewsController, TalentRecruitmentController, TalentResumeController, TalentResumeTasksController, TalentWorkbenchController],
  providers: [TalentsService, TalentFilesService, TalentFollowUpsService, TalentSharesService, TalentShareSessionGuard, TalentInterviewsService, TalentRecruitmentService, TalentResumeService, TalentResumeClient, TalentResumeTasksService, TalentWorkbenchService],
  exports: [TalentsService, TalentInterviewsService],
})
export class TalentPoolModule {}
