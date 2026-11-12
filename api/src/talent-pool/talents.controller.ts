import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query,
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
import { DeleteTalentDto } from './dto/talent-interview.dto';

/**
 * 人才库（需求 v2）。候选人不是员工：不写 users、不产生工号、不触发绩效。
 * 权限：hr / system_admin，或具备档案权限的 hr_user；服务层由 RolesGuard 二次校验。
 */
@Controller('talents')
@Roles(SysRole.hr, SysRole.system_admin)
export class TalentsController {
  constructor(
    private readonly talents: TalentsService,
    private readonly files: TalentFilesService,
    private readonly followUps: TalentFollowUpsService,
    private readonly shares: TalentSharesService,
  ) {}

  @Get()
  @HrCapabilities('employee_archive_edit', 'employee_archive_review')
  list(@Query() query: TalentQueryDto) {
    return this.talents.list(query);
  }

  @Get('check-phone')
  @HrCapabilities('employee_archive_edit', 'employee_archive_review')
  checkPhone(@Query('phone') phone: string) {
    return this.talents.checkPhone(phone ?? '');
  }

  @Post()
  @HrCapabilities('employee_archive_edit')
  create(@Body() input: CreateTalentDto, @CurrentUser() user: AuthUser) {
    return this.talents.create(input, user);
  }

  @Get(':id')
  @HrCapabilities('employee_archive_edit', 'employee_archive_review')
  detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.talents.detail(id);
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

  @Get(':id/follow-ups')
  @HrCapabilities('employee_archive_edit', 'employee_archive_review')
  listFollowUps(@Param('id', new ParseUUIDPipe()) id: string) {
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
