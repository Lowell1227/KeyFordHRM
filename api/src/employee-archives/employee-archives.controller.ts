import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
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
  ArchivePersonnelRecordsDto,
  CreateEmployeeDto,
  CreateEmploymentRecordDto,
  EmployeeDraftQueryDto,
  PreviewEmployeeRosterDto,
  SaveEmployeeCreateDraftDto,
  SetDingtalkIdentityStateDto,
  UpdateEmployeeProfileDto,
  SubmitEmployeeArchiveDraftDto,
  SubmitDepartmentAssignmentsDto,
} from './dto/employee-archive.dto';
import { EmployeeArchivesService } from './employee-archives.service';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';
import { EmployeeRosterImportService } from './employee-roster-import.service';
import {
  ApproveEmployeeDataReviewsDto,
  EmployeeDataReviewQueryDto,
  ProposePerformanceManagerDto,
  SetPendingPerformanceManagerDto,
  RejectEmployeeDataReviewsDto,
} from './dto/employee-data-review.dto';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { buildEmployeeRosterTemplate } from './employee-roster.excel';
import { PersonnelDiagnosticsService } from './personnel-diagnostics.service';
import { EmployeeIdentityMatchService } from './employee-identity-match.service';
import { EmployeeOnboardingService } from './employee-onboarding.service';
import {
  CancelEmployeeReentryDto,
  CreateEmployeeReentryDto,
  CreateOnboardingIntakeDto,
  EmployeeIdentityLookupDto,
  ReviseEmployeeReentryDto,
} from './dto/employee-onboarding.dto';

@Controller('employee-archives')
@Roles(SysRole.hr, SysRole.system_admin)
export class EmployeeArchivesController {
  constructor(
    private readonly archives: EmployeeArchivesService,
    private readonly imports: EmployeeRosterImportService,
    private readonly reviews: EmployeeDataReviewsService,
    private readonly diagnostics: PersonnelDiagnosticsService,
    private readonly identityMatch: EmployeeIdentityMatchService,
    private readonly onboarding: EmployeeOnboardingService,
  ) {}

  @Get('diagnostics')
  @HrCapabilities('employee_archive_edit', 'employee_archive_review')
  inspectDiagnostics() {
    return this.diagnostics.inspect();
  }

  @Post('identity-lookup')
  @HrCapabilities('employee_archive_edit')
  lookupIdentity(@Body() input: EmployeeIdentityLookupDto) {
    return this.identityMatch.lookup(input);
  }

  @Post('onboarding-intakes')
  @HrCapabilities('employee_archive_edit')
  createOnboardingIntake(@Body() input: CreateOnboardingIntakeDto, @CurrentUser() operator: AuthUser) {
    return this.onboarding.createOnboardingIntake(input, operator.id);
  }

  @Post(':userId/reentry')
  @HrCapabilities('employee_archive_edit')
  createReentry(
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Body() input: CreateEmployeeReentryDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.onboarding.createReentry(userId, input, operator.id);
  }

  @Get(':userId/reentry/current')
  @HrCapabilities('employee_archive_edit')
  getCurrentReentry(@Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string) {
    return this.onboarding.getCurrentReentry(userId);
  }

  @Patch('reentry/:requestId')
  @HrCapabilities('employee_archive_edit')
  reviseReentry(
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
    @Body() input: ReviseEmployeeReentryDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.onboarding.reviseReentry(requestId, input, operator.id);
  }

  @Post('reentry/:requestId/cancel')
  @HrCapabilities('employee_archive_edit')
  cancelReentry(
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
    @Body() input: CancelEmployeeReentryDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.onboarding.cancelReentry(requestId, input, operator.id);
  }

  @Get('reviews/list')
  @HrCapabilities('employee_archive_review')
  findReviews(@Query() dto: EmployeeDataReviewQueryDto) {
    return this.reviews.findAll(dto);
  }

  @Post('reviews/approve')
  @HrCapabilities('employee_archive_review')
  approveReviews(
    @Body() dto: ApproveEmployeeDataReviewsDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.reviews.approveBatch(dto, operator);
  }

  @Post('reviews/reject')
  @HrCapabilities('employee_archive_review')
  rejectReviews(
    @Body() dto: RejectEmployeeDataReviewsDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.reviews.rejectBatch(dto.requestIds, dto.reason, operator);
  }

  @Patch('reviews/:requestId/performance-manager')
  @HrCapabilities('employee_archive_review')
  setPendingPerformanceManager(
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
    @Body() dto: SetPendingPerformanceManagerDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.reviews.setPendingPerformanceManager(requestId, dto.managerId, operator);
  }

  @Post(':id/performance-manager-review')
  @HrCapabilities('employee_archive_edit')
  proposePerformanceManager(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ProposePerformanceManagerDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.reviews.proposePerformanceManager(id, dto, operator);
  }

  @Get('imports/template')
  @HrCapabilities('employee_archive_edit')
  async downloadImportTemplate() {
    const buffer = await buildEmployeeRosterTemplate();
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="employee-roster-template.xlsx"',
    });
  }

  @Post()
  @HrCapabilities('employee_archive_edit')
  createEmployee(
    @Body() dto: CreateEmployeeDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.archives.createEmployee(dto, operator);
  }

  @Post('drafts')
  @HrCapabilities('employee_archive_edit')
  saveEmployeeCreateDraft(
    @Body() dto: SaveEmployeeCreateDraftDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.archives.saveEmployeeCreateDraft(dto, operator);
  }

  @Get('drafts/list')
  @HrCapabilities('employee_archive_edit')
  listDrafts(@Query() dto: EmployeeDraftQueryDto) {
    return this.archives.listDrafts(dto);
  }

  @Post('drafts/archive')
  @HrCapabilities('employee_archive_edit')
  archiveDrafts(
    @Body() dto: ArchivePersonnelRecordsDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.archives.archiveDrafts(dto.ids, operator);
  }

  @Post('archive')
  @HrCapabilities('employee_archive_edit')
  archiveEmployees(
    @Body() dto: ArchivePersonnelRecordsDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.archives.archiveEmployees(dto.ids, operator);
  }

  @Get(':id')
  @HrCapabilities('employee_archive_edit', 'employee_archive_review')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.archives.findOne(id);
  }

  @Patch(':id/profile')
  @HrCapabilities('employee_archive_edit')
  updateProfile(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateEmployeeProfileDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.archives.upsertProfile(id, dto, operator);
  }

  @Patch(':id/draft')
  @HrCapabilities('employee_archive_edit')
  submitDraft(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SubmitEmployeeArchiveDraftDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.archives.submitDraft(id, dto, operator);
  }

  @Patch(':id/draft/save')
  @HrCapabilities('employee_archive_edit')
  saveArchiveDraft(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SubmitEmployeeArchiveDraftDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.archives.saveArchiveDraft(id, dto, operator);
  }

  @Post('department-assignments')
  @HrCapabilities('employee_archive_edit')
  submitDepartmentAssignments(
    @Body() dto: SubmitDepartmentAssignmentsDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.archives.submitDepartmentAssignments(dto.userIds, dto.departmentId, operator);
  }

  @Post(':id/employments')
  @HrCapabilities('employee_archive_edit')
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
  @HrCapabilities('employee_archive_edit')
  @UseInterceptors(FileInterceptor('file'))
  previewImport(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: PreviewEmployeeRosterDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.imports.preview(file, dto.mode, operator);
  }

  @Post('imports/:batchId/confirm')
  @HrCapabilities('employee_archive_edit')
  @UseInterceptors(FileInterceptor('file'))
  confirmImport(
    @Param('batchId', new ParseUUIDPipe({ version: '4' })) batchId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.imports.confirm(batchId, file, operator);
  }

  @Get('imports/:batchId')
  @HrCapabilities('employee_archive_edit')
  getImportBatch(@Param('batchId', new ParseUUIDPipe({ version: '4' })) batchId: string) {
    return this.imports.findBatch(batchId);
  }
}
