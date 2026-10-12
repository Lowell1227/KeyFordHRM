import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth.types';
import { AiProgressService } from './ai-progress.service';
import { SaveProgressDraftDto } from './dto/save-progress-draft.dto';

@Controller('ai-progress/drafts')
export class AiProgressController {
  constructor(private readonly progress: AiProgressService) {}

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() viewer: AuthUser) {
    return this.progress.getDraft(id, viewer.id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() changes: SaveProgressDraftDto, @CurrentUser() viewer: AuthUser) {
    return this.progress.updateDraft(id, viewer.id, changes);
  }

  @Post(':id/save')
  save(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() viewer: AuthUser) {
    return this.progress.saveDraft(id, viewer.id);
  }
}
