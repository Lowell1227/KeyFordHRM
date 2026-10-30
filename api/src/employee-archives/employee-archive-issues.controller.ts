import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { ConfirmArchiveIssueDto } from './employee-archive-issues.dto';
import { EmployeeArchiveIssuesService } from './employee-archive-issues.service';

@Controller('employee-archives/issues')
@Roles(SysRole.hr, SysRole.system_admin)
export class EmployeeArchiveIssuesController {
  constructor(private readonly issues: EmployeeArchiveIssuesService) {}

  @Get('employee/:userId')
  @HrCapabilities('employee_archive_edit', 'employee_archive_review')
  employee(@Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string, @CurrentUser() user: AuthUser) {
    return this.issues.listForEmployee(userId, user);
  }

  @Get('request/:requestId')
  @HrCapabilities('employee_archive_edit', 'employee_archive_review')
  request(@Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string, @CurrentUser() user: AuthUser) {
    return this.issues.listForRequest(requestId, user);
  }

  @Post(':requestId/:issueId/confirm-current')
  @HrCapabilities('employee_archive_edit')
  confirm(@Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
    @Param('issueId') issueId: string, @Body() body: ConfirmArchiveIssueDto, @CurrentUser() user: AuthUser) {
    return this.issues.confirmCurrent(requestId, issueId, body.fingerprint, user);
  }
}
