import {
  Body,
  Controller,
  Get,
  GoneException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { ProbationService } from './probation.service';
import { CreateProbationReviewDto } from './dto/create-probation-review.dto';
import { ProbationReviewQueryDto } from './dto/probation-review-query.dto';
import { UpdateProbationReviewDto } from './dto/update-probation-review.dto';
import { SubmitSelfEvalDto } from './dto/submit-self-eval.dto';
import { SubmitManagerScoreDto } from './dto/submit-manager-score.dto';

@Controller('probation-reviews')
export class ProbationController {
  constructor(private readonly probationService: ProbationService) {}

  @Post()
  @Roles(SysRole.hr, SysRole.system_admin)
  create(@Body() dto: CreateProbationReviewDto, @CurrentUser() viewer: AuthUser) {
    return this.retired();
  }

  @Get()
  @Roles(SysRole.hr, SysRole.system_admin)
  findAll(@Query() dto: ProbationReviewQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.probationService.findAll(dto, viewer);
  }

  @Get('managed')
  findManaged(@Query() dto: ProbationReviewQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.probationService.findManaged(dto, viewer);
  }

  @Get('mine')
  findMine(@Query() dto: ProbationReviewQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.probationService.findMine(dto, viewer);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() viewer: AuthUser) {
    return this.probationService.findOne(id, viewer);
  }

  @Put(':id')
  @Roles(SysRole.hr, SysRole.system_admin)
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateProbationReviewDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.retired();
  }

  @Post(':id/self-eval')
  submitSelfEval(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SubmitSelfEvalDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.retired();
  }

  @Post(':id/manager-score')
  submitManagerScore(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SubmitManagerScoreDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.retired();
  }

  @Post(':id/close')
  @Roles(SysRole.hr, SysRole.system_admin)
  close(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() viewer: AuthUser) {
    return this.retired();
  }

  private retired(): never {
    throw new GoneException('独立试用期评分已停用。绩效考核请进入周期与计划；转正请由员工本人发起申请。');
  }
}
