import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { PeriodReviewsService } from './period-reviews.service';
import { SaveEmployeePeriodReviewDraftDto } from './dto/save-employee-period-review-draft.dto';
import { SubmitEmployeePeriodReviewDto } from './dto/submit-employee-period-review.dto';
import { SaveManagerPeriodReviewDraftDto } from './dto/save-manager-period-review-draft.dto';
import { ReturnManagerPeriodReviewDto } from './dto/return-manager-period-review.dto';
import { SubmitManagerPeriodReviewDto } from './dto/submit-manager-period-review.dto';
import { ReopenPeriodReviewDto } from './dto/reopen-period-review.dto';
import { QueryPeriodMonitoringDto } from './dto/query-period-monitoring.dto';
import { PeriodMonitoringService } from './period-monitoring.service';

@Controller('assessment-periods')
export class PeriodReviewsController {
  constructor(
    private readonly service: PeriodReviewsService,
    private readonly monitoring: PeriodMonitoringService,
  ) {}

  @Get('cycle/:cycleId/monitoring')
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('cycle_plan_edit', 'cycle_plan_review')
  findCycleMonitoring(
    @Param('cycleId', new ParseUUIDPipe({ version: '4' })) cycleId: string,
    @Query() query: QueryPeriodMonitoringDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.monitoring.findCycleMonitoring(cycleId, query, viewer);
  }

  @Get(':id/review')
  getReview(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.service.getReview(id, viewer);
  }

  @Put(':id/employee-draft')
  saveEmployeeDraft(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SaveEmployeePeriodReviewDraftDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.service.saveEmployeeDraft(id, dto, viewer);
  }

  @Post(':id/employee-submit')
  @HttpCode(200)
  submitEmployeeReview(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SubmitEmployeePeriodReviewDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.service.submitEmployeeReview(id, dto, viewer);
  }

  @Put(':id/manager-draft')
  saveManagerDraft(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SaveManagerPeriodReviewDraftDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.service.saveManagerDraft(id, dto, viewer);
  }

  @Post(':id/manager-return')
  @HttpCode(200)
  returnManagerReview(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ReturnManagerPeriodReviewDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.service.returnManagerReview(id, dto, viewer);
  }

  @Post(':id/manager-submit')
  @HttpCode(200)
  submitManagerReview(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SubmitManagerPeriodReviewDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.service.submitManagerReview(id, dto, viewer);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('cycle_plan_edit')
  reopenPeriodReview(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ReopenPeriodReviewDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.service.reopenPeriodReview(id, dto, viewer);
  }
}
