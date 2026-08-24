import { Controller, Get, Param, ParseUUIDPipe, Query, StreamableFile } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { ReportsService } from './reports.service';
import { ReportQueryDto } from './dto/report-query.dto';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /** GET /reports/cycle/:id/summary — 周期汇总报表（JSON/Excel）。 */
  @Get('cycle/:id/summary')
  getCycleSummary(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() dto: ReportQueryDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.reportsService.getCycleSummary(id, dto, viewer);
  }

  /** GET /reports/cycle/:id/progress — 周期进度统计。 */
  @Get('cycle/:id/progress')
  @Roles(SysRole.hr, SysRole.system_admin)
  getCycleProgress(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.reportsService.getCycleProgress(id);
  }

  /** GET /reports/cycle/:id/grade-list — 当期 A/D 级名单。 */
  @Get('cycle/:id/grade-list')
  @Roles(SysRole.hr, SysRole.system_admin)
  getCycleGradeList(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.reportsService.getCycleGradeList(id);
  }

  /** GET /reports/employee/:id/archive — 员工历史绩效趋势。 */
  @Get('employee/:id/archive')
  getEmployeeArchive(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.reportsService.getEmployeeArchive(id, viewer);
  }

  /** GET /reports/consecutive-d-warning — 连续 D 等级末尾淘汰预警名单。 */
  @Get('consecutive-d-warning')
  @Roles(SysRole.hr, SysRole.system_admin)
  getConsecutiveDWarningList(@CurrentUser() viewer: AuthUser) {
    return this.reportsService.getConsecutiveDWarningList(viewer);
  }

  /** GET /reports/cycle/:id/export — 当期全量 Excel 导出。 */
  @Get('cycle/:id/export')
  @Roles(SysRole.hr, SysRole.system_admin)
  async exportCycle(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<StreamableFile> {
    return this.reportsService.exportCycle(id);
  }
}
