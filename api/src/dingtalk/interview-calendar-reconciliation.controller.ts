import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { IsInt, Min } from 'class-validator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { InterviewCalendarReconciliationService } from './interview-calendar-reconciliation.service';

export class ReconcileInterviewCalendarDto {
  @IsInt() @Min(1) version!: number;
}

@Controller('talent-interviews')
export class InterviewCalendarReconciliationController {
  constructor(private readonly reconciliation: InterviewCalendarReconciliationService) {}

  @Post(':id/reconcile-calendar')
  @HttpCode(200)
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('employee_archive_edit')
  reconcile(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: ReconcileInterviewCalendarDto,
    @CurrentUser() user: AuthUser) {
    return this.reconciliation.reconcile(id, input.version, user);
  }
}
