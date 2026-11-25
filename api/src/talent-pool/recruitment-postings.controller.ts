import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { TalentManagementGuard } from './talent-management.guard';
import type { AuthUser } from '@/common/types/auth.types';
import { CreateRecruitmentPostingDto, RecruitmentPostingQueryDto, UpdateRecruitmentPostingDto } from './recruitment-postings.dto';
import { RecruitmentPostingsService } from './recruitment-postings.service';
@Controller('recruitment-postings')
@Roles(SysRole.hr,SysRole.system_admin)
@HrCapabilities('recruitment_edit','employee_archive_edit')
@UseGuards(TalentManagementGuard)
export class RecruitmentPostingsController {
  constructor(private readonly postings: RecruitmentPostingsService) {}
  @Get() @Header('Cache-Control','no-store, private') list(@Query() query: RecruitmentPostingQueryDto, @CurrentUser() user: AuthUser) { return this.postings.list(query,user); }
  @Post() create(@Body() input: CreateRecruitmentPostingDto, @CurrentUser() user: AuthUser) { return this.postings.create(input,user); }
  @Get(':id') @Header('Cache-Control','no-store, private') detail(@Param('id',new ParseUUIDPipe()) id: string,@CurrentUser() user: AuthUser) { return this.postings.detail(id,user); }
  @Patch(':id') update(@Param('id',new ParseUUIDPipe()) id: string,@Body() input: UpdateRecruitmentPostingDto,@CurrentUser() user: AuthUser) { return this.postings.update(id,input,user); }
}
