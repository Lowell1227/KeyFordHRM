import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SysRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { AuthUser } from '@/common/types/auth.types';
import {
  BindDingtalkIdentityDto,
  CreateEmploymentRecordDto,
  PreviewEmployeeRosterDto,
  SetDingtalkIdentityStateDto,
  UpdateEmployeeProfileDto,
} from './dto/employee-archive.dto';
import { EmployeeArchivesService } from './employee-archives.service';
import { EmployeeRosterImportService } from './employee-roster-import.service';

@Controller('employee-archives')
@Roles(SysRole.hr, SysRole.system_admin)
export class EmployeeArchivesController {
  constructor(
    private readonly archives: EmployeeArchivesService,
    private readonly imports: EmployeeRosterImportService,
  ) {}

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.archives.findOne(id);
  }

  @Patch(':id/profile')
  updateProfile(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateEmployeeProfileDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.archives.upsertProfile(id, dto, operator);
  }

  @Post(':id/employments')
  createEmployment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CreateEmploymentRecordDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.archives.createEmploymentRecord(id, dto, operator);
  }

  @Post(':id/dingtalk-binding')
  bindDingtalk(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: BindDingtalkIdentityDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.archives.bindDingtalkIdentity(id, dto, operator);
  }

  @Patch(':id/dingtalk-binding')
  setDingtalkState(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SetDingtalkIdentityStateDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.archives.setDingtalkIdentityEnabled(id, dto.enabled, dto.reason ?? null, operator);
  }

  @Post('imports/preview')
  @UseInterceptors(FileInterceptor('file'))
  previewImport(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: PreviewEmployeeRosterDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.imports.preview(file, dto.mode, operator);
  }

  @Post('imports/:batchId/confirm')
  @UseInterceptors(FileInterceptor('file'))
  confirmImport(
    @Param('batchId', new ParseUUIDPipe({ version: '4' })) batchId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.imports.confirm(batchId, file, operator);
  }

  @Get('imports/:batchId')
  getImportBatch(@Param('batchId', new ParseUUIDPipe({ version: '4' })) batchId: string) {
    return this.imports.findBatch(batchId);
  }
}
