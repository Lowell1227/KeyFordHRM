import { BadRequestException, Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, UseFilters, UseInterceptors, ValidationPipe } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { PayrollAttendanceSyncService } from './payroll-attendance-sync.service';
import { PayrollAttendanceSyncListDto, PayrollAttendanceSyncStartDto, PayrollAttendanceSyncRetryDto } from './dto/payroll-attendance-sync.dto';
import { PayrollExceptionFilter } from './payroll-exception.filter';
import { PayrollResponseInterceptor } from './payroll-response.interceptor';

@Controller('payroll/attendance/dingtalk/jobs')
@UseFilters(PayrollExceptionFilter)
@UseInterceptors(PayrollResponseInterceptor)
export class PayrollAttendanceSyncController {
  constructor(private readonly sync: PayrollAttendanceSyncService) {}
  @Get() @Header('Cache-Control', 'no-store, private')
  list(@Query(new ValidationPipe({ expectedType: PayrollAttendanceSyncListDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) value: unknown,
    @CurrentUser() actor: AuthUser) { const input = value as PayrollAttendanceSyncListDto; return this.sync.list(input.subjectId, input.month, actor); }
  @Post() @Header('Cache-Control', 'no-store, private')
  start(@Body(new ValidationPipe({ expectedType: PayrollAttendanceSyncStartDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) input: unknown,
    @CurrentUser() actor: AuthUser) { return this.sync.start(input as PayrollAttendanceSyncStartDto, actor); }
  @Post(':id/cancel') @Header('Cache-Control', 'no-store, private')
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: unknown, @CurrentUser() actor: AuthUser) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new BadRequestException('停止同步不接受额外参数');
    return this.sync.cancel(id, actor);
  }
  @Post(':id/retry') @Header('Cache-Control', 'no-store, private')
  retry(@Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidationPipe({ expectedType: PayrollAttendanceSyncRetryDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) input: unknown,
    @CurrentUser() actor: AuthUser) { return this.sync.retry(id, input as PayrollAttendanceSyncRetryDto, actor); }
}
