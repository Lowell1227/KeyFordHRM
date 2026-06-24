import { Controller, Get, Post, Patch, Param, Body, Query, ParseUUIDPipe } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { CyclesService } from './cycles.service';
import { LaunchService } from './launch.service';
import { CreateCycleDto } from './dto/create-cycle.dto';
import { UpdateDeadlinesDto } from './dto/update-deadlines.dto';
import { CycleQueryDto } from './dto/cycle-query.dto';

// 读接口（GET 列表 / 详情）对所有已登录用户开放：周期名称、起止日、等级上限属于
// 非敏感的参考数据，员工/主管的「我的绩效」「目标地图」等页面都需要它来做周期筛选。
// 写接口（创建 / 改截止日 / 发起）逐一限制 hr/system_admin。
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
  findAll(@Query() query: CycleQueryDto) {
    return this.cyclesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.cyclesService.findOne(id);
  }

  @Patch(':id/deadlines')
  @Roles(SysRole.hr, SysRole.system_admin)
  updateDeadlines(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeadlinesDto,
  ) {
    return this.cyclesService.updateDeadlines(id, dto);
  }

  @Post(':id/launch')
  @Roles(SysRole.hr, SysRole.system_admin)
  launch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.launchService.launch(id, user);
  }
}
