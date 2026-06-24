import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { CalibrationService } from './calibration.service';
import { CalibrateGradesDto } from './dto/calibrate-grades.dto';

@Controller('cycles/:id')
@Roles(SysRole.hr, SysRole.system_admin)
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

  /** POST /cycles/:id/calibration — 批量提交校准。 */
  @Post('calibration')
  @HttpCode(200)
  calibrateGrades(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CalibrateGradesDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.calibrationService.calibrateGrades(id, dto, viewer);
  }
}
