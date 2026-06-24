import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { ActionItemsService } from './action-items.service';
import { CreateActionItemDto } from './dto/create-action-item.dto';
import { UpdateActionItemDto } from './dto/update-action-item.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { ActionItemQueryDto } from './dto/action-item-query.dto';

/**
 * 行动计划接口。改为「管理者+」可见：读对所有非 employee 角色开放，
 * 写限 system_admin / hr / dept_head / manager。
 */
@Controller('action-items')
@Roles(
  SysRole.manager,
  SysRole.dept_head,
  SysRole.vp,
  SysRole.hr,
  SysRole.chairman,
  SysRole.system_admin,
)
export class ActionItemsController {
  constructor(private readonly service: ActionItemsService) {}

  /** GET /action-items — 分页列表。 */
  @Get()
  findAll(@Query() query: ActionItemQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.service.findAll(query, viewer);
  }

  /** GET /action-items/tree?objectiveId= — 目标下行动项树。 */
  @Get('tree')
  findTree(
    @Query('objectiveId', new ParseUUIDPipe({ version: '4' })) objectiveId: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.service.findTree(objectiveId, viewer);
  }

  /** GET /action-items/:id — 详情。 */
  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.service.findOne(id, viewer);
  }

  /** POST /action-items — 创建。 */
  @Post()
  @Roles(SysRole.system_admin, SysRole.hr, SysRole.dept_head, SysRole.manager)
  create(@Body() dto: CreateActionItemDto, @CurrentUser() viewer: AuthUser) {
    return this.service.create(dto, viewer);
  }

  /** PATCH /action-items/:id — 更新。 */
  @Patch(':id')
  @Roles(SysRole.system_admin, SysRole.hr, SysRole.dept_head, SysRole.manager)
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateActionItemDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.service.update(id, dto, viewer);
  }

  /** PATCH /action-items/:id/progress — 更新进度（同时汇总到目标进度）。 */
  @Patch(':id/progress')
  @HttpCode(200)
  @Roles(SysRole.system_admin, SysRole.hr, SysRole.dept_head, SysRole.manager)
  updateProgress(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateProgressDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.service.updateProgress(id, dto, viewer);
  }

  /** DELETE /action-items/:id — 删除。 */
  @Delete(':id')
  @Roles(SysRole.system_admin, SysRole.hr, SysRole.dept_head, SysRole.manager)
  remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.service.remove(id, viewer);
  }
}
