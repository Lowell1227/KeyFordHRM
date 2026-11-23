import { BadRequestException, Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, UseFilters, UseInterceptors, ValidationPipe } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { PayrollExceptionFilter } from './payroll-exception.filter';
import { PayrollResponseInterceptor } from './payroll-response.interceptor';
import { PayrollGrantsService } from './payroll-grants.service';
import { PayrollGrantQueryDto, PayrollGrantRevokeDto, PayrollGrantSaveDto } from './dto/payroll-grants.dto';

@Controller('payroll/grants')
@Roles(SysRole.system_admin)
@UseFilters(PayrollExceptionFilter)
@UseInterceptors(PayrollResponseInterceptor)
export class PayrollGrantsController {
  constructor(private readonly grants: PayrollGrantsService) {}

  @Get() @Header('Cache-Control', 'no-store, private')
  list(@Query(new ValidationPipe({ expectedType: PayrollGrantQueryDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) query: unknown,
    @CurrentUser() actor: AuthUser) { return this.grants.list(query, actor); }

  @Get('options') @Header('Cache-Control', 'no-store, private')
  options(@Query() query: Record<string, unknown>, @CurrentUser() actor: AuthUser) {
    this.noQuery(query);
    return this.grants.options(actor);
  }

  @Post() @Header('Cache-Control', 'no-store, private')
  save(@Body(new ValidationPipe({ expectedType: PayrollGrantSaveDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) input: unknown,
    @CurrentUser() actor: AuthUser) { return this.grants.save(input, actor); }

  @Post(':id/revoke') @Header('Cache-Control', 'no-store, private')
  revoke(@Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidationPipe({ expectedType: PayrollGrantRevokeDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) input: unknown,
    @CurrentUser() actor: AuthUser) { return this.grants.revoke(id, input, actor); }

  @Get(':id/events') @Header('Cache-Control', 'no-store, private')
  events(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: Record<string, unknown>, @CurrentUser() actor: AuthUser) {
    this.noQuery(query);
    return this.grants.events(id, actor);
  }

  private noQuery(query: Record<string, unknown>) {
    if (Object.keys(query).length) throw new BadRequestException('此接口不接受查询参数');
  }
}
