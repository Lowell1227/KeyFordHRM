import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, UseFilters, UseInterceptors, ValidationPipe } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { PayrollExceptionFilter } from './payroll-exception.filter';
import { PayrollResponseInterceptor } from './payroll-response.interceptor';
import { PayrollReadinessService } from './payroll-readiness.service';
import { PayrollReadinessDecisionDto, PayrollReadinessNoteDto, PayrollReadinessQueryDto, PayrollReadinessSubmitDto } from './dto/payroll-readiness.dto';

const strict = (expectedType: new () => object) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });

@Controller('payroll/readiness/requests')
@UseFilters(PayrollExceptionFilter)
@UseInterceptors(PayrollResponseInterceptor)
export class PayrollReadinessController {
  constructor(private readonly readiness: PayrollReadinessService) {}

  @Get() @Header('Cache-Control', 'no-store, private')
  list(@Query(strict(PayrollReadinessQueryDto)) query: unknown, @CurrentUser() actor: AuthUser) {
    return this.readiness.list((query as PayrollReadinessQueryDto).subjectId, actor);
  }
  @Post() @Header('Cache-Control', 'no-store, private')
  submit(@Body(strict(PayrollReadinessSubmitDto)) input: unknown, @CurrentUser() actor: AuthUser) {
    return this.readiness.submit(input as PayrollReadinessSubmitDto, actor);
  }
  @Get(':id') @Header('Cache-Control', 'no-store, private')
  detail(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: AuthUser) {
    return this.readiness.detail(id, actor);
  }
  @Post(':id/decide') @Header('Cache-Control', 'no-store, private')
  decide(@Param('id', new ParseUUIDPipe()) id: string, @Body(strict(PayrollReadinessDecisionDto)) input: unknown, @CurrentUser() actor: AuthUser) {
    return this.readiness.decide(id, input as PayrollReadinessDecisionDto, actor);
  }
  @Post(':id/withdraw') @Header('Cache-Control', 'no-store, private')
  withdraw(@Param('id', new ParseUUIDPipe()) id: string, @Body(strict(PayrollReadinessNoteDto)) input: unknown, @CurrentUser() actor: AuthUser) {
    return this.readiness.withdraw(id, input as PayrollReadinessNoteDto, actor);
  }
  @Post(':id/revoke') @Header('Cache-Control', 'no-store, private')
  revoke(@Param('id', new ParseUUIDPipe()) id: string, @Body(strict(PayrollReadinessNoteDto)) input: unknown, @CurrentUser() actor: AuthUser) {
    return this.readiness.revoke(id, input as PayrollReadinessNoteDto, actor);
  }
}
