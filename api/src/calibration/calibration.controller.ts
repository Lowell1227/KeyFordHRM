import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { CalibrationService } from './calibration.service';
import { ConfirmCalibrationDto } from './dto/confirm-calibration.dto';
import { RejectCalibrationDto } from './dto/reject-calibration.dto';
import { CalibrationQueryDto } from './dto/calibration-query.dto';

/**
 * 绩效校准接口（审核制）。
 *
 * HR 在校准环节不修改绩效结果，仅执行 确认/驳回；
 * 每个接口由服务校验全局校准能力或该周期 hrOwnerId；不能仅按菜单放行。
 */
@Controller('cycles/:id')
export class CalibrationController {
  constructor(private readonly calibrationService: CalibrationService) {}

  /** GET /cycles/:id/calibration — 校准工作台。 */
  @Get('calibration')
  getWorkbench(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: CalibrationQueryDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.calibrationService.getWorkbench(id, viewer, query);
  }

  /** GET /cycles/:id/grade-distribution — 等级分布（供轮询/刷新）。 */
  @Get('grade-distribution')
  getGradeDistribution(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.calibrationService.getGradeDistribution(id, viewer);
  }

  /** GET /cycles/:id/calibration/tasks/:taskId — 个人详情（校准依据）。 */
  @Get('calibration/tasks/:taskId')
  getCandidateDetail(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.calibrationService.getCandidateDetail(id, taskId, viewer);
  }

  /** POST /cycles/:id/calibration/confirm — 确认（逐人即时流转到审批）。 */
  @Post('calibration/confirm')
  @HttpCode(200)
  confirm(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ConfirmCalibrationDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.calibrationService.confirm(id, dto, viewer);
  }

  /** POST /cycles/:id/calibration/reject — 驳回（退回直属上级重新评定）。 */
  @Post('calibration/reject')
  @HttpCode(200)
  reject(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: RejectCalibrationDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.calibrationService.reject(id, dto, viewer);
  }
}

@Controller('calibration')
export class CalibrationCyclesController {
  constructor(private readonly calibrationService: CalibrationService) {}

  @Get('cycles')
  listCycles(@CurrentUser() viewer: AuthUser) {
    return this.calibrationService.listCycles(viewer);
  }
}
