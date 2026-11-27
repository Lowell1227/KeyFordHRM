import { UseFilters } from '@nestjs/common';
import { PerformanceLifecycleExceptionFilter } from '@/performance-lifecycle/lifecycle-exception.filter';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { ChangeDecisionDto, ChangeDraftDto, ChangeGrantDto, ChangeRevisionDto, ChangeSubmitDto, ChangeTaskDto } from './goal-changes.dto';
import { GoalChangesService } from './goal-changes.service';
import { GoalChangeListQueryDto } from './dto/goal-change-list-query.dto';

@UseFilters(PerformanceLifecycleExceptionFilter)
@Controller('goal-changes')
export class GoalChangesController {
  constructor(private readonly service: GoalChangesService) {}
  @Get('context') context(@CurrentUser() viewer: AuthUser) { return this.service.context(viewer); }
  @Get('entry') entry(@CurrentUser() viewer: AuthUser) { return this.service.entry(viewer); }
  @Get('my-pending') myPending(@CurrentUser() viewer: AuthUser) { return this.service.myPending(viewer); }
  @Get('page') page(@Query() query: GoalChangeListQueryDto, @CurrentUser() viewer: AuthUser) { return this.service.findPage(query, viewer); }
  @Post('grants') @HttpCode(200)
  open(@Body() input: ChangeGrantDto, @CurrentUser() viewer: AuthUser) { return this.service.openGrant(input, viewer); }
  @Post('grants/:taskId/revoke') @HttpCode(200)
  revokeGrant(@Param('taskId', ParseUUIDPipe) id: string, @Body() input: ChangeRevisionDto, @CurrentUser() viewer: AuthUser) {
    return this.service.revokeGrant(id, input, viewer);
  }
  @Get() list(@CurrentUser() viewer: AuthUser) { return this.service.findAll(viewer); }
  @Post() create(@Body() input: ChangeTaskDto, @CurrentUser() viewer: AuthUser) { return this.service.create(input, viewer); }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() viewer: AuthUser) { return this.service.findOne(id, viewer); }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() input: ChangeDraftDto, @CurrentUser() viewer: AuthUser) {
    return this.service.update(id, input, viewer);
  }
  @Post(':id/submit') @HttpCode(200)
  submit(@Param('id', ParseUUIDPipe) id: string, @Body() input: ChangeSubmitDto, @CurrentUser() viewer: AuthUser) {
    return this.service.submit(id, input, viewer);
  }
  @Post(':id/decide') @HttpCode(200)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() input: ChangeDecisionDto, @CurrentUser() viewer: AuthUser) {
    return this.service.decide(id, input, viewer);
  }
  @Post(':id/revoke') @HttpCode(200)
  revoke(@Param('id', ParseUUIDPipe) id: string, @Body() input: ChangeRevisionDto, @CurrentUser() viewer: AuthUser) {
    return this.service.revoke(id, input, viewer);
  }
}
