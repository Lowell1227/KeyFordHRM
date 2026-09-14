import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { ImprovementWorkflowService } from './improvement-workflow.service';
import { ImprovementPlanQueryDto } from './dto/improvement-plan-query.dto';
import { CreateImprovementPlanDto, UpdateImprovementPlanDto, ImprovementDecisionDto,
  ImprovementEvaluationDto, ImprovementEvaluationDraftDto } from './dto/improvement-workflow.dto';

@Controller('improvement-plans')
export class ImprovementPlansController {
  constructor(private readonly service: ImprovementWorkflowService) {}

  @Get()
  findAll(@Query() query: ImprovementPlanQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.service.findAll(query, query, viewer);
  }

  @Get('eligible-employees')
  eligibleEmployees(@CurrentUser() viewer: AuthUser) { return this.service.eligibleEmployees(viewer); }

  @Get('cycles')
  cycles() { return this.service.cycleOptions(); }

  @Get('my-pending')
  myPending(@CurrentUser() viewer: AuthUser) { return this.service.myPending(viewer); }

  @Post()
  create(@Body() dto: CreateImprovementPlanDto, @CurrentUser() viewer: AuthUser) {
    return this.service.create(dto, viewer);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() viewer: AuthUser) {
    return this.service.findOne(id, viewer);
  }

  @Patch(':id')
  update(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateImprovementPlanDto, @CurrentUser() viewer: AuthUser) {
    return this.service.updateDraft(id, dto, viewer);
  }

  @Post(':id/submit-goals') @HttpCode(200)
  submitGoals(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() viewer: AuthUser) {
    return this.service.submitGoals(id, viewer);
  }

  @Post(':id/decide-goals') @HttpCode(200)
  decideGoals(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ImprovementDecisionDto, @CurrentUser() viewer: AuthUser) {
    return this.service.decideGoals(id, dto, viewer);
  }

  @Post(':id/evaluate') @HttpCode(200)
  evaluate(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ImprovementEvaluationDto, @CurrentUser() viewer: AuthUser) {
    return this.service.evaluate(id, dto, viewer);
  }

  @Post(':id/save-evaluation') @HttpCode(200)
  saveEvaluation(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ImprovementEvaluationDraftDto, @CurrentUser() viewer: AuthUser) {
    return this.service.saveEvaluation(id, dto, viewer);
  }

  @Post(':id/decide-final') @HttpCode(200)
  decideFinal(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ImprovementDecisionDto, @CurrentUser() viewer: AuthUser) {
    return this.service.decideFinal(id, dto, viewer);
  }
}
