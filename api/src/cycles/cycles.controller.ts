import { Controller, Delete, Get, Post, Patch, Param, Body, Query, ParseUUIDPipe, HttpCode } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { CyclesService } from './cycles.service';
import { LaunchService } from './launch.service';
import { CreateCycleDto } from './dto/create-cycle.dto';
import { UpdateCycleDto } from './dto/update-cycle.dto';
import { UpdateDeadlinesDto } from './dto/update-deadlines.dto';
import { CycleQueryDto } from './dto/cycle-query.dto';
import { LaunchCycleDto, ScheduleCycleDto } from './dto/launch-cycle.dto';
import { UpdateCycleNotificationModeDto } from './dto/update-cycle-notification-mode.dto';
import { ReviewCycleDto } from './dto/review-cycle.dto';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { CycleScheduleService } from './cycle-schedule.service';
import { PreviewCycleScheduleDto } from './dto/preview-cycle-schedule.dto';

// 管理员可以查看全量周期；其他角色只能读取已开放周期，避免草稿和预约信息泄露。
@Controller('cycles')
export class CyclesController {
  constructor(
    private readonly cyclesService: CyclesService,
    private readonly launchService: LaunchService,
    private readonly cycleScheduleService: CycleScheduleService,
  ) {}

  @Post()
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('cycle_plan_edit')
  create(@Body() dto: CreateCycleDto, @CurrentUser() user: AuthUser) {
    return this.cyclesService.create(dto, user);
  }

  @Get()
  findAll(@Query() query: CycleQueryDto, @CurrentUser() user: AuthUser) {
    return this.cyclesService.findAll(query, user);
  }

  @Get('mine')
  findMine(@CurrentUser() user: AuthUser) {
    return this.cyclesService.findMine(user);
  }

  @Post('schedule-preview')
  @HttpCode(200)
  previewSchedule(@Body() dto: PreviewCycleScheduleDto) {
    return this.cycleScheduleService.preview(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.cyclesService.findOne(id, user);
  }

  @Delete(':id')
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('cycle_plan_edit')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.cyclesService.remove(id, user);
  }

  @Patch(':id')
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('cycle_plan_edit')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCycleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.cyclesService.updateDraft(id, dto, user);
  }

  @Patch(':id/deadlines')
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('cycle_plan_edit')
  updateDeadlines(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeadlinesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.cyclesService.updateDeadlines(id, dto, user);
  }

  @Patch(':id/notification-mode')
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('cycle_plan_edit')
  updateNotificationMode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCycleNotificationModeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.cyclesService.updateNotificationMode(id, dto.notificationMode, user);
  }

  @Get(':id/preflight')
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('cycle_plan_edit', 'cycle_plan_review')
  preflight(@Param('id', ParseUUIDPipe) id: string) {
    return this.launchService.preflight(id);
  }

  @Post(':id/schedule')
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('cycle_plan_edit')
  schedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScheduleCycleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.launchService.schedule(id, user, dto.expectedPlanHash);
  }

  @Post(':id/schedule/cancel')
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('cycle_plan_edit')
  cancelSchedule(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.launchService.cancelSchedule(id, user);
  }

  @Post(':id/launch')
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('cycle_plan_edit')
  launch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LaunchCycleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.launchService.launch(id, user, {
      expectedPlanHash: dto.expectedPlanHash,
      overrideReason: dto.overrideReason,
    });
  }

  @Post(':id/review')
  @Roles(SysRole.hr)
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewCycleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.cyclesService.review(id, dto, user);
  }
}
