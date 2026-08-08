import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { TaskQueryDto } from './dto/task-query.dto';
import { UpdateActualValueDto } from './dto/update-actual-value.dto';
import { SubmitSelfEvalDto } from './dto/submit-self-eval.dto';
import { SubmitManagerScoreDto } from './dto/submit-manager-score.dto';
import { DeptReviewDto } from './dto/dept-review.dto';
import { RejectIndicatorsDto } from './dto/reject-indicators.dto';
import { SubmitIndicatorProposalDto } from './dto/submit-indicator-proposal.dto';
import { SetIndicatorsDto } from './dto/set-indicators.dto';
import { TeamTaskQueryDto } from './dto/team-task-query.dto';
import { TeamTasksService } from './team-tasks.service';
import { ReferenceIndicatorQueryDto } from './dto/reference-indicator-query.dto';
import {
  BatchIndicatorReviewDto,
  BatchRejectIndicatorReviewDto,
} from './dto/batch-indicator-review.dto';

@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly teamTasksService: TeamTasksService,
  ) {}

  /** GET /tasks — 列表查询。 */
  @Get()
  findAll(@Query() dto: TaskQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.tasksService.findAll(dto, viewer);
  }

  /** GET /tasks/mine — 当前登录用户的任务列表。 */
  @Get('mine')
  findMine(@Query() dto: TaskQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.tasksService.findMine(dto, viewer);
  }

  @Get('team')
  findTeam(@Query() dto: TeamTaskQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.teamTasksService.findAll(dto, viewer);
  }

  @Post('team/indicator-review/batch-approve')
  @HttpCode(200)
  batchApproveIndicatorReview(
    @Body() dto: BatchIndicatorReviewDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.teamTasksService.batchApprove(dto, viewer);
  }

  @Post('team/indicator-review/batch-reject')
  @HttpCode(200)
  batchRejectIndicatorReview(
    @Body() dto: BatchRejectIndicatorReviewDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.teamTasksService.batchReject(dto, viewer);
  }

  /** GET /tasks/:id — 详情。 */
  @Get('reference-indicators')
  findReferenceIndicators(
    @Query() dto: ReferenceIndicatorQueryDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.tasksService.findReferenceIndicators(dto, viewer);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.tasksService.findOne(id, viewer);
  }

  /** POST /tasks/:id/indicators/confirm — 员工确认指标。 */
  @Post(':id/indicators/confirm')
  @HttpCode(200)
  confirmIndicators(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.tasksService.confirmIndicators(id, viewer);
  }

  /** POST /tasks/:id/indicators/reject — 员工驳回指标。 */
  @Post(':id/indicators/reject')
  @HttpCode(200)
  rejectIndicators(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: RejectIndicatorsDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.tasksService.rejectIndicators(id, dto.comment, viewer);
  }

  /** POST /tasks/:id/indicator-proposal — 员工在指标制定阶段提交指标建议。 */
  @Post(':id/indicator-proposal')
  @HttpCode(200)
  submitIndicatorProposal(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SubmitIndicatorProposalDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.tasksService.submitIndicatorProposal(id, dto, viewer);
  }


  @Put(':id/indicators')
  setIndicators(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SetIndicatorsDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.tasksService.setIndicators(id, dto, viewer);
  }

  /** PUT /tasks/:id/actual-value — 更新实际完成值。 */
  @Put(':id/actual-value')
  updateActualValues(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateActualValueDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.tasksService.updateActualValues(id, dto, viewer);
  }

  /** POST /tasks/:id/self-eval — 员工提交自评。 */
  @Post(':id/self-eval')
  @HttpCode(200)
  submitSelfEval(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SubmitSelfEvalDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.tasksService.submitSelfEval(id, dto, viewer);
  }

  /** POST /tasks/:id/manager-score — 主管评分。 */
  @Post(':id/manager-score')
  @HttpCode(200)
  submitManagerScore(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SubmitManagerScoreDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.tasksService.submitManagerScore(id, dto, viewer);
  }

  /** POST /tasks/:id/dept-review — 部门负责人复核。 */
  @Post(':id/dept-review')
  @HttpCode(200)
  deptReview(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: DeptReviewDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.tasksService.deptReview(id, dto, viewer);
  }

  /** POST /tasks/:id/employee-confirm — 员工确认结果。 */
  @Post(':id/employee-confirm')
  @HttpCode(200)
  employeeConfirm(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.tasksService.employeeConfirm(id, viewer);
  }
}
