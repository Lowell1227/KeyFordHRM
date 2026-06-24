import {
  Body,
  Controller,
  Get,
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
    return this.probationService.create(dto, viewer);
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
    return this.probationService.update(id, dto, viewer);
  }

  @Post(':id/self-eval')
  submitSelfEval(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SubmitSelfEvalDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.probationService.submitSelfEval(id, dto, viewer);
  }

  @Post(':id/manager-score')
  submitManagerScore(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SubmitManagerScoreDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.probationService.submitManagerScore(id, dto, viewer);
  }

  @Post(':id/close')
  @Roles(SysRole.hr, SysRole.system_admin)
  close(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() viewer: AuthUser) {
    return this.probationService.close(id, viewer);
  }
}
