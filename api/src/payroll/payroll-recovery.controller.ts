import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, UseFilters, UseInterceptors, ValidationPipe } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { PayrollExceptionFilter } from './payroll-exception.filter';
import { PayrollResponseInterceptor } from './payroll-response.interceptor';
import { PayrollRecoveryService } from './payroll-recovery.service';
import { PayrollCorrectOpeningDto, PayrollRecoverScopeDto } from './dto/payroll-recovery.dto';

@Controller('payroll')
@UseFilters(PayrollExceptionFilter)
@UseInterceptors(PayrollResponseInterceptor)
export class PayrollRecoveryController {
  constructor(private readonly recovery: PayrollRecoveryService) {}
  @Get('attendance/:id/scope-diff') @Header('Cache-Control', 'no-store, private')
  scopeDiff(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: AuthUser) { return this.recovery.scopeDiff(id, actor); }
  @Post('attendance/:id/recover-scope')
  recoverScope(@Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidationPipe({ expectedType: PayrollRecoverScopeDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) input: unknown,
    @CurrentUser() actor: AuthUser) { return this.recovery.recoverScope(id, input as PayrollRecoverScopeDto, actor); }
  @Get('openings/:id/history') @Header('Cache-Control', 'no-store, private')
  openingHistory(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: AuthUser) { return this.recovery.openingHistory(id, actor); }
  @Post('openings/:id/correct')
  correctOpening(@Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidationPipe({ expectedType: PayrollCorrectOpeningDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) input: unknown,
    @CurrentUser() actor: AuthUser) { return this.recovery.correctOpening(id, input as PayrollCorrectOpeningDto, actor); }
}
