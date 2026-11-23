import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { CreateTalentApplicationDto, ReturnTalentInterviewFeedbackDto, SaveTalentInterviewFeedbackDto, TalentApplicationActionDto, TalentOwnerQueryDto, TalentApplicationQueueQueryDto, UpdateTalentApplicationDto } from './dto/talent-recruitment.dto';
import { TalentRecruitmentService } from './talent-recruitment.service';

// Per-action authorization is checked against the current database user inside the service.
@Controller('talent-recruitment')
export class TalentRecruitmentController {
  constructor(private readonly recruitment: TalentRecruitmentService) {}

  @Get('owners')
  owners(@Query() query: TalentOwnerQueryDto, @CurrentUser() user: AuthUser) { return this.recruitment.owners(query, user); }

  @Get('applications')
  queue(@Query() query: TalentApplicationQueueQueryDto, @CurrentUser() user: AuthUser) { return this.recruitment.queue(query, user); }

  @Get('hiring-reviews')
  hiringReviews(@CurrentUser() user: AuthUser) { return this.recruitment.hiringReviews(user); }

  @Get('candidates/:candidateId/applications')
  list(@Param('candidateId', new ParseUUIDPipe()) candidateId: string, @CurrentUser() user: AuthUser) { return this.recruitment.list(candidateId, user); }

  @Post('candidates/:candidateId/applications')
  create(@Param('candidateId', new ParseUUIDPipe()) candidateId: string, @Body() input: CreateTalentApplicationDto, @CurrentUser() user: AuthUser) { return this.recruitment.create(candidateId, input, user); }

  @Get('applications/:id')
  detail(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) { return this.recruitment.detail(id, user); }

  @Patch('applications/:id')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: UpdateTalentApplicationDto, @CurrentUser() user: AuthUser) { return this.recruitment.update(id, input, user); }

  @Post('applications/:id/actions')
  act(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: TalentApplicationActionDto, @CurrentUser() user: AuthUser) { return this.recruitment.act(id, input, user); }

  @Get('interviews/:id/feedback')
  feedback(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) { return this.recruitment.feedback(id, user); }

  @Put('interviews/:id/feedback')
  saveFeedback(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: SaveTalentInterviewFeedbackDto, @CurrentUser() user: AuthUser) { return this.recruitment.saveFeedback(id, input, user); }

  @Post('interviews/:id/feedback/:userId/return')
  returnFeedback(@Param('id', new ParseUUIDPipe()) id: string, @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() input: ReturnTalentInterviewFeedbackDto, @CurrentUser() user: AuthUser) { return this.recruitment.returnFeedback(id, userId, input, user); }
}
