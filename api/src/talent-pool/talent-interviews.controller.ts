import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { TalentInterviewsService } from './talent-interviews.service';
import { CreateTalentInterviewDto, InterviewVersionDto, TalentInterviewQueryDto, UpdateTalentInterviewDto } from './dto/talent-interview.dto';

@Controller('talent-interviews')
export class TalentInterviewsController {
  constructor(private readonly interviews: TalentInterviewsService) {}

  @Get()
  list(@Query() query: TalentInterviewQueryDto, @CurrentUser() user: AuthUser) { return this.interviews.list(query, user); }

  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) { return this.interviews.detail(id, user); }

  @Post() @Roles(SysRole.hr, SysRole.system_admin) @HrCapabilities('employee_archive_edit')
  create(@Body() input: CreateTalentInterviewDto, @CurrentUser() user: AuthUser) { return this.interviews.create(input, user); }

  @Patch(':id') @Roles(SysRole.hr, SysRole.system_admin) @HrCapabilities('employee_archive_edit')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: UpdateTalentInterviewDto, @CurrentUser() user: AuthUser) { return this.interviews.update(id, input, user); }

  @Post(':id/cancel') @Roles(SysRole.hr, SysRole.system_admin) @HrCapabilities('employee_archive_edit')
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: InterviewVersionDto, @CurrentUser() user: AuthUser) { return this.interviews.cancel(id, input, user); }

  @Post(':id/complete') @Roles(SysRole.hr, SysRole.system_admin) @HrCapabilities('employee_archive_edit')
  complete(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: InterviewVersionDto, @CurrentUser() user: AuthUser) { return this.interviews.complete(id, input, user); }

  @Post(':id/retry-sync') @Roles(SysRole.hr, SysRole.system_admin) @HrCapabilities('employee_archive_edit')
  retrySync(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: InterviewVersionDto, @CurrentUser() user: AuthUser) { return this.interviews.retrySync(id, input, user); }
}
