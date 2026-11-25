import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { RecruitmentLifecycleService } from './recruitment-lifecycle.service';
import { RecruitmentAnalyticsService } from './recruitment-analytics.service';
import { ChangeRecruitmentLifecycleDto, RecruitmentAnalyticsQueryDto } from './recruitment-lifecycle.dto';

@Controller('recruitment-demands')
export class RecruitmentLifecycleController {
  constructor(private readonly lifecycle: RecruitmentLifecycleService) {}
  @Get(':id/lifecycle') detail(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.lifecycle.detail(id, user);
  }
  @Patch(':id/lifecycle') change(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: ChangeRecruitmentLifecycleDto, @CurrentUser() user: AuthUser) {
    return this.lifecycle.change(id, body, user);
  }
}

@Controller('recruitment-analytics')
export class RecruitmentAnalyticsController {
  constructor(private readonly analytics: RecruitmentAnalyticsService) {}
  @Get('channels') channels(@Query() query: RecruitmentAnalyticsQueryDto, @CurrentUser() user: AuthUser) { return this.analytics.channels(query, user); }
  @Get('applications') applications(@Query() query: RecruitmentAnalyticsQueryDto, @CurrentUser() user: AuthUser) { return this.analytics.applications(query, user); }
}
