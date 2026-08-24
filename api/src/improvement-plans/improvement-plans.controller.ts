import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { ImprovementPlansService } from './improvement-plans.service';
import { ImprovementPlanQueryDto } from './dto/improvement-plan-query.dto';
import { FillImprovementPlanDto } from './dto/fill-improvement-plan.dto';
import { CompleteImprovementPlanDto } from './dto/complete-improvement-plan.dto';

/** 绩效改进计划接口。 */
@Controller('improvement-plans')
export class ImprovementPlansController {
  constructor(private readonly improvementPlansService: ImprovementPlansService) {}

  /** GET /improvement-plans — 列表。 */
  @Get()
  findAll(
    @Query() query: ImprovementPlanQueryDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.improvementPlansService.findAll(query, query, viewer);
  }

  /** GET /improvement-plans/:id — 详情。 */
  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.improvementPlansService.findOne(id, viewer);
  }

  /** POST /improvement-plans/:id/fill — 主管/HR 填写。 */
  @Post(':id/fill')
  @HttpCode(200)
  fill(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: FillImprovementPlanDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.improvementPlansService.fill(id, dto, viewer);
  }

  /** POST /improvement-plans/:id/complete — 主管/HR 录最终评分。 */
  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CompleteImprovementPlanDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.improvementPlansService.complete(id, dto, viewer);
  }

  /** GET /improvement-plans/employee/:employeeId/consecutive-d-warning */
  @Get('employee/:employeeId/consecutive-d-warning')
  getConsecutiveDWarning(
    @Param('employeeId', new ParseUUIDPipe({ version: '4' })) employeeId: string,
  ) {
    return this.improvementPlansService.detectConsecutiveD(employeeId);
  }
}
