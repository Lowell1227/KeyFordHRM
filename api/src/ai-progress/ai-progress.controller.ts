import { Body, Controller, Get, Logger, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { DingtalkCardPresenter } from '../dingtalk/dingtalk-card.presenter';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth.types';
import { AiProgressService } from './ai-progress.service';
import { SaveProgressDraftDto } from './dto/save-progress-draft.dto';

@Controller('ai-progress/drafts')
export class AiProgressController {
  private readonly logger = new Logger(AiProgressController.name);
  constructor(private readonly progress: AiProgressService, private readonly cards: DingtalkCardPresenter) {}

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() viewer: AuthUser) {
    return this.progress.getDraft(id, viewer.id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() changes: SaveProgressDraftDto, @CurrentUser() viewer: AuthUser) {
    return this.progress.updateDraft(id, viewer.id, changes);
  }

  @Post(':id/save')
  async save(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() viewer: AuthUser) {
    const saved = await this.progress.saveDraft(id, viewer.id);
    try { await this.cards.markSaved(id, saved); }
    catch { this.logger.warn('进展已保存，钉钉卡片刷新暂未完成'); }
    return saved;
  }
}
