import { Module } from '@nestjs/common';
import { StorageModule } from '@/storage/storage.module';
import { TalentsController } from './talents.controller';
import { TalentSharesController } from './talent-shares.controller';
import { TalentsService } from './talents.service';
import { TalentFilesService } from './talent-files.service';
import { TalentFollowUpsService } from './talent-follow-ups.service';
import { TalentSharesService } from './talent-shares.service';
import { TalentInterviewsService } from './talent-interviews.service';
import { TalentInterviewsController } from './talent-interviews.controller';

/** 人才库（MVP）：候选人录入 / 检索 / 跟进 / 转员工 / 单条只读转发。 */
@Module({
  imports: [StorageModule],
  controllers: [TalentsController, TalentSharesController, TalentInterviewsController],
  providers: [TalentsService, TalentFilesService, TalentFollowUpsService, TalentSharesService, TalentInterviewsService],
  exports: [TalentsService, TalentInterviewsService],
})
export class TalentPoolModule {}
