import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { ApprovalService } from './approval.service';
import { BulkApprovalDto } from './dto/bulk-approval.dto';
import { ApprovalRejectDto } from './dto/approval-reject.dto';

/** 周期级审批接口。 */
@Controller('cycles/:id')
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  /** GET /cycles/:id/approval — 审批人待审批列表。 */
  @Get('approval')
  getApprovalList(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.approvalService.getApprovalList(id, viewer);
  }

  /** GET /cycles/:id/approval/overview — 审批概览（全校准分布只读 + 退回记录）。 */
  @Get('approval/overview')
  getOverview(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.approvalService.getOverview(id, viewer);
  }

  /** POST /cycles/:id/approval — 批量审批。 */
  @Post('approval')
  @HttpCode(200)
  approveTasks(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: BulkApprovalDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.approvalService.approveTasks(id, dto, viewer);
  }
}

/** 任务级审批接口。 */
@Controller('tasks/:id')
export class ApprovalTaskController {
  constructor(private readonly approvalService: ApprovalService) {}

  /** POST /tasks/:id/approval/reject — 退回绩效校准。 */
  @Post('approval/reject')
  @HttpCode(200)
  rejectTask(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ApprovalRejectDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.approvalService.rejectTask(id, dto, viewer);
  }
}
