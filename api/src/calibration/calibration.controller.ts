import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { CalibrationService } from './calibration.service';
import { ConfirmCalibrationDto } from './dto/confirm-calibration.dto';
import { RejectCalibrationDto } from './dto/reject-calibration.dto';

/**
 * 绩效校准接口（审核制）。
 *
 * HR 在校准环节不修改绩效结果，仅执行 确认/驳回；
 * 权限通过 performance_calibration 能力点控制
 * （hr / system_admin 默认具备，hr_user 需显式授权）。
 */
@Controller('cycles/:id')
@HrCapabilities('performance_calibration')
export class CalibrationController {
  constructor(private readonly calibrationService: CalibrationService) {}

  /** GET /cycles/:id/calibration — 校准工作台。 */
  @Get('calibration')
  getWorkbench(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.calibrationService.getWorkbench(id, viewer);
  }

  /** GET /cycles/:id/grade-distribution — 等级分布（供轮询/刷新）。 */
  @Get('grade-distribution')
  getGradeDistribution(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.calibrationService.getGradeDistribution(id);
  }

  /** GET /cycles/:id/calibration/tasks/:taskId — 个人详情（校准依据）。 */
  @Get('calibration/tasks/:taskId')
  getCandidateDetail(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
  ) {
    return this.calibrationService.getCandidateDetail(id, taskId);
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
