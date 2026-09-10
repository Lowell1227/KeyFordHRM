import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { InterviewsService } from './interviews.service';
import { UpdateInterviewDto } from './dto/update-interview.dto';
import { CreateInterviewDto } from './dto/create-interview.dto';
import { InterviewQueryDto } from './dto/interview-query.dto';

@Controller('interviews')
@Roles(SysRole.hr_user, SysRole.hr, SysRole.system_admin)
export class InterviewsController {
  constructor(private readonly interviewsService: InterviewsService) {}

  @Get()
  findAll(@Query() dto: InterviewQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.interviewsService.findAll(dto, viewer);
  }

  @Get('people')
  people(@Query() dto: InterviewQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.interviewsService.people(dto, viewer);
  }

  @Get('cycles')
  cycles(@CurrentUser() viewer: AuthUser) {
    return this.interviewsService.cycles(viewer);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() viewer: AuthUser) {
    return this.interviewsService.findOne(id, viewer);
  }

  @Post()
  create(@Body() dto: CreateInterviewDto, @CurrentUser() viewer: AuthUser) {
    return this.interviewsService.create(dto, viewer);
  }

  @Put(':id')
  update(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: UpdateInterviewDto, @CurrentUser() viewer: AuthUser) {
    return this.interviewsService.update(id, dto, viewer);
  }
}
