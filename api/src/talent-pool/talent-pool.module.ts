import { Module } from '@nestjs/common';
import { StorageModule } from '@/storage/storage.module';
import { AiProgressModule } from '@/ai-progress/ai-progress.module';
import { TalentsController } from './talents.controller';
import { TalentSharesController } from './talent-shares.controller';
import { TalentsService } from './talents.service';
import { TalentFilesService } from './talent-files.service';
import { TalentFollowUpsService } from './talent-follow-ups.service';
import { TalentSharesService } from './talent-shares.service';
import { TalentInterviewsService } from './talent-interviews.service';
import { TalentInterviewsController } from './talent-interviews.controller';
import { TalentRecruitmentController } from './talent-recruitment.controller';
import { TalentRecruitmentService } from './talent-recruitment.service';
import { TalentResumeController } from './talent-resume.controller';
import { TalentResumeService } from './talent-resume.service';
import { TalentResumeClient } from './talent-resume-client';
import { TalentResumeTasksController } from './talent-resume-tasks.controller';
import { TalentResumeTasksService } from './talent-resume-tasks.service';

/** 人才库（MVP）：候选人录入 / 检索 / 跟进 / 转员工 / 单条只读转发。 */
@Module({
  imports: [StorageModule, AiProgressModule],
  controllers: [TalentsController, TalentSharesController, TalentInterviewsController, TalentRecruitmentController, TalentResumeController, TalentResumeTasksController],
  providers: [TalentsService, TalentFilesService, TalentFollowUpsService, TalentSharesService, TalentInterviewsService, TalentRecruitmentService, TalentResumeService, TalentResumeClient, TalentResumeTasksService],
  exports: [TalentsService, TalentInterviewsService],
})
export class TalentPoolModule {}
