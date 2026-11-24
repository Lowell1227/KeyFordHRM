import {
  Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { TalentsService } from './talents.service';
import { TalentFilesService } from './talent-files.service';
import { TalentFollowUpsService } from './talent-follow-ups.service';
import { TalentSharesService } from './talent-shares.service';
import { TalentQueryDto } from './dto/talent-query.dto';
import { CreateTalentDto } from './dto/create-talent.dto';
import { UpdateTalentDto } from './dto/update-talent.dto';
import { BindTalentFileDto } from './dto/bind-talent-file.dto';
import { ConvertTalentDto, CreateFollowUpDto } from './dto/create-follow-up.dto';
import { CreateShareDto } from './dto/create-share.dto';
import { ShareRecipientQueryDto } from './dto/share-recipient-query.dto';
import { DeleteTalentDto } from './dto/talent-interview.dto';
import { TalentManagementGuard } from './talent-management.guard';

/**
 * 人才库（需求 v2）。候选人不是员工：不写 users、不产生工号、不触发绩效。
 * 读取支持独立招聘查看能力；维护仍由档案编辑能力与服务层当前资格约束。
 */
@Controller('talents')
@Roles(SysRole.hr, SysRole.system_admin)
@UseGuards(TalentManagementGuard)
export class TalentsController {
  constructor(
    private readonly talents: TalentsService,
    private readonly files: TalentFilesService,
    private readonly followUps: TalentFollowUpsService,
    private readonly shares: TalentSharesService,
  ) {}

  @Get()
  @HrCapabilities('recruitment_view', 'employee_archive_edit', 'employee_archive_review')
  list(@Query() query: TalentQueryDto, @CurrentUser() user: AuthUser) {
    return this.talents.list(query, user);
  }

  @Get('export')
  @Header('Cache-Control', 'no-store, private')
  @HrCapabilities('employee_archive_edit', 'employee_archive_review')
  exportApplications(@Query() query: TalentQueryDto, @CurrentUser() user: AuthUser) {
    return this.talents.exportApplications(query, user);
  }

  @Get('application-positions')
  @HrCapabilities('recruitment_view', 'employee_archive_edit', 'employee_archive_review')
  applicationPositions(@CurrentUser() user: AuthUser) {
    return this.talents.applicationPositions(user);
  }

  @Get('check-phone')
  @HrCapabilities('recruitment_view', 'employee_archive_edit', 'employee_archive_review')
  checkPhone(@Query('phone') phone: string, @CurrentUser() user: AuthUser) {
    return this.talents.checkPhone(phone ?? '', user);
  }

  @Get('share-recipients')
  @HrCapabilities('employee_archive_edit')
  shareRecipients(@Query() query: ShareRecipientQueryDto) {
    return this.shares.searchRecipients(query);
  }

  @Post()
  @HrCapabilities('employee_archive_edit')
  create(@Body() input: CreateTalentDto, @CurrentUser() user: AuthUser) {
    return this.talents.create(input, user);
  }

  @Get(':id')
  @HrCapabilities('recruitment_view', 'employee_archive_edit', 'employee_archive_review')
  detail(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.talents.detail(id, user);
  }

  @Patch(':id')
  @HrCapabilities('employee_archive_edit')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateTalentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.talents.update(id, input, user);
  }

  @Delete(':id')
  @HrCapabilities('employee_archive_edit')
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser, @Body() input: DeleteTalentDto) {
    return this.talents.remove(id, user, input);
  }

  @Get(':id/delete-impact')
  @HrCapabilities('employee_archive_edit')
  deleteImpact(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.talents.deleteImpact(id);
  }

  @Post(':id/files')
  @HrCapabilities('employee_archive_edit')
  bindFile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: BindTalentFileDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.files.bind(id, input, user);
  }

  @Delete(':id/files/:fileId')
  @HrCapabilities('employee_archive_edit')
  unbindFile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.files.unbind(id, fileId, user);
  }

  @Post(':id/follow-ups')
  @HrCapabilities('employee_archive_edit')
  addFollowUp(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: CreateFollowUpDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.followUps.create(id, input, user);
  }

  @Post(':id/follow-ups/:followUpId/cancel')
  @HrCapabilities('employee_archive_edit')
  cancelFollowUpPlan(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('followUpId', new ParseUUIDPipe()) followUpId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.followUps.cancel(id, followUpId, user);
  }

  @Get(':id/follow-ups')
  @HrCapabilities('recruitment_view', 'employee_archive_edit', 'employee_archive_review')
  async listFollowUps(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    await this.talents.assertRead(user);
    return this.followUps.list(id);
  }

  @Post(':id/convert')
  @HrCapabilities('employee_archive_edit')
  convert(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: ConvertTalentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.talents.convert(id, input.userId, user);
  }

  @Post(':id/shares')
  @HrCapabilities('employee_archive_edit')
  createShare(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: CreateShareDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.shares.create(id, input, user);
  }

  @Delete('shares/:shareId')
  @HrCapabilities('employee_archive_edit')
  revokeShare(@Param('shareId', new ParseUUIDPipe()) shareId: string, @CurrentUser() user: AuthUser) {
    return this.shares.revoke(shareId, user);
  }
}
