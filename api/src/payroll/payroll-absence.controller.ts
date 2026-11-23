import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, UseFilters, UseInterceptors, ValidationPipe } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { PayrollExceptionFilter } from './payroll-exception.filter';
import { PayrollResponseInterceptor } from './payroll-response.interceptor';
import { PayrollAbsenceService } from './payroll-absence.service';
import { PayrollAbsenceDecisionDto, PayrollAbsenceProposeDto } from './dto/payroll-absence.dto';

const strict = (expectedType: new () => object) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });
@Controller('payroll/attendance')
@UseFilters(PayrollExceptionFilter)
@UseInterceptors(PayrollResponseInterceptor)
export class PayrollAbsenceController {
  constructor(private readonly absence: PayrollAbsenceService) {}
  @Get(':id/absence') @Header('Cache-Control', 'no-store, private')
  detail(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: AuthUser) { return this.absence.detail(id, actor); }
  @Post(':id/absence') @Header('Cache-Control', 'no-store, private')
  propose(@Param('id', new ParseUUIDPipe()) id: string, @Body(strict(PayrollAbsenceProposeDto)) input: PayrollAbsenceProposeDto, @CurrentUser() actor: AuthUser) {
    return this.absence.propose(id, input, actor);
  }
  @Post(':id/absence/:proposalId/decide') @Header('Cache-Control', 'no-store, private')
  decide(@Param('id', new ParseUUIDPipe()) id: string, @Param('proposalId', new ParseUUIDPipe()) proposalId: string,
    @Body(strict(PayrollAbsenceDecisionDto)) input: PayrollAbsenceDecisionDto, @CurrentUser() actor: AuthUser) {
    return this.absence.decide(id, proposalId, input, actor);
  }
}
