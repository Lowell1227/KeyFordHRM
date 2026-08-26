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
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { ObjectivesService } from './objectives.service';
import { CreateObjectiveDto } from './dto/create-objective.dto';
import { UpdateObjectiveDto } from './dto/update-objective.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { ObjectiveQueryDto } from './dto/objective-query.dto';
import { GoalTrackingQueryDto } from './dto/goal-tracking-query.dto';
import { UpdateIndicatorProgressDto } from './dto/update-indicator-progress.dto';
import {
  ApproveObjectiveDto,
  RequestObjectiveChangesDto,
} from './dto/objective-review.dto';
import { ObjectiveReviewStatus } from '@prisma/client';

export const TRACKING_INDICATOR_UUID_PIPE = new ParseUUIDPipe();

/**
 * 目标地图接口。改为「管理者+」可见：读对所有非 employee 角色开放，
 * 写权限由服务按实际业务关系校验，不再由遗留系统角色决定。
 */
@Controller('objectives')
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
  @Get('tracking')
  findTracking(
    @Query() query: GoalTrackingQueryDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.objectivesService.findTracking(query, viewer);
  }

  @Get('tracking/indicators/:id')
  findTrackingIndicator(
    @Param('id', TRACKING_INDICATOR_UUID_PIPE) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.objectivesService.findTrackingIndicator(id, viewer);
  }

  @Patch('tracking/indicators/:id/progress')
  @HttpCode(200)
  updateTrackingIndicatorProgress(
    @Param('id', TRACKING_INDICATOR_UUID_PIPE) id: string,
    @Body() dto: UpdateIndicatorProgressDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.objectivesService.updateIndicatorProgress(
      id,
      { ...dto, attachments: dto.attachments ?? [] },
      viewer,
    );
  }

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
  create(@Body() dto: CreateObjectiveDto, @CurrentUser() viewer: AuthUser) {
    return this.objectivesService.create(dto, viewer);
  }

  /** PATCH /objectives/:id — 更新。 */
  @Patch(':id')
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

  @Post(':id/review/approve')
  @HttpCode(200)
  approveObjective(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ApproveObjectiveDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.objectivesService.reviewObjective(
      id,
      ObjectiveReviewStatus.approved,
      dto.comment,
      viewer,
      dto.expectedUpdatedAt,
    );
  }

  @Post(':id/review/request-changes')
  @HttpCode(200)
  requestObjectiveChanges(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: RequestObjectiveChangesDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.objectivesService.reviewObjective(
      id,
      ObjectiveReviewStatus.changes_requested,
      dto.comment,
      viewer,
      dto.expectedUpdatedAt,
    );
  }

  /** DELETE /objectives/:id — 删除。 */
  @Delete(':id')
  remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.objectivesService.remove(id, viewer);
  }
}
