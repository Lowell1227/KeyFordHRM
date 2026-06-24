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
import { ObjectivesService } from './objectives.service';
import { CreateObjectiveDto } from './dto/create-objective.dto';
import { UpdateObjectiveDto } from './dto/update-objective.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { ObjectiveQueryDto } from './dto/objective-query.dto';

/**
 * 目标地图接口。改为「管理者+」可见：读对所有非 employee 角色开放，
 * 写仍由各方法限定 system_admin / hr / dept_head / manager。
 */
@Controller('objectives')
@Roles(
  SysRole.manager,
  SysRole.dept_head,
  SysRole.vp,
  SysRole.hr,
  SysRole.chairman,
  SysRole.system_admin,
)
export class ObjectivesController {
  constructor(private readonly objectivesService: ObjectivesService) {}

  /** GET /objectives — 列表或树（默认树）。 */
  @Get()
  findAll(@Query() query: ObjectiveQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.objectivesService.findAll(query, viewer);
  }

  /** GET /objectives/tree — 目标地图树。 */
  @Get('tree')
  findTree(
    @CurrentUser() viewer: AuthUser,
    @Query('cycleId') cycleId?: string,
  ) {
    return this.objectivesService.findTree(viewer, cycleId);
  }

  /** GET /objectives/:id — 详情。 */
  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.objectivesService.findOne(id, viewer);
  }

  /** POST /objectives — 创建。 */
  @Post()
  @HttpCode(200)
  @Roles(SysRole.system_admin, SysRole.hr, SysRole.dept_head, SysRole.manager)
  create(@Body() dto: CreateObjectiveDto, @CurrentUser() viewer: AuthUser) {
    return this.objectivesService.create(dto, viewer);
  }

  /** PATCH /objectives/:id — 更新。 */
  @Patch(':id')
  @Roles(SysRole.system_admin, SysRole.hr, SysRole.dept_head, SysRole.manager)
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateObjectiveDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.objectivesService.update(id, dto, viewer);
  }

  /** PATCH /objectives/:id/progress — 更新进度。 */
  @Patch(':id/progress')
  @HttpCode(200)
  updateProgress(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateProgressDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.objectivesService.updateProgress(id, dto, viewer);
  }

  /** DELETE /objectives/:id — 删除。 */
  @Delete(':id')
  @Roles(SysRole.system_admin, SysRole.hr, SysRole.dept_head, SysRole.manager)
  remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.objectivesService.remove(id, viewer);
  }
}
