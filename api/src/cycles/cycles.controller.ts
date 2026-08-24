import { Controller, Delete, Get, Post, Patch, Param, Body, Query, ParseUUIDPipe } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { CyclesService } from './cycles.service';
import { LaunchService } from './launch.service';
import { CreateCycleDto } from './dto/create-cycle.dto';
import { UpdateDeadlinesDto } from './dto/update-deadlines.dto';
import { CycleQueryDto } from './dto/cycle-query.dto';
import { LaunchCycleDto, ScheduleCycleDto } from './dto/launch-cycle.dto';
import { UpdateCycleNotificationModeDto } from './dto/update-cycle-notification-mode.dto';

// 管理员可以查看全量周期；其他角色只能读取已开放周期，避免草稿和预约信息泄露。
@Controller('cycles')
export class CyclesController {
  constructor(
    private readonly cyclesService: CyclesService,
    private readonly launchService: LaunchService,
  ) {}

  @Post()
  @Roles(SysRole.hr, SysRole.system_admin)
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

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.cyclesService.findOne(id, user);
  }

  @Delete(':id')
  @Roles(SysRole.hr, SysRole.system_admin)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.cyclesService.remove(id, user);
  }

  @Patch(':id/deadlines')
  @Roles(SysRole.hr, SysRole.system_admin)
  updateDeadlines(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeadlinesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.cyclesService.updateDeadlines(id, dto, user);
  }

  @Patch(':id/notification-mode')
  @Roles(SysRole.hr, SysRole.system_admin)
  updateNotificationMode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCycleNotificationModeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.cyclesService.updateNotificationMode(id, dto.notificationMode, user);
  }

  @Get(':id/preflight')
  @Roles(SysRole.hr, SysRole.system_admin)
  preflight(@Param('id', ParseUUIDPipe) id: string) {
    return this.launchService.preflight(id);
  }

  @Post(':id/schedule')
  @Roles(SysRole.hr, SysRole.system_admin)
  schedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScheduleCycleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.launchService.schedule(id, user, dto.expectedPlanHash);
  }

  @Post(':id/schedule/cancel')
  @Roles(SysRole.hr, SysRole.system_admin)
  cancelSchedule(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.launchService.cancelSchedule(id, user);
  }

  @Post(':id/launch')
  @Roles(SysRole.hr, SysRole.system_admin)
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
}
