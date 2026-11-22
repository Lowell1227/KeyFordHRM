import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, UseFilters, UseInterceptors } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { PayrollAccessService } from './payroll-access.service';
import { PayrollDataService } from './payroll-data.service';
import { PayrollBatchesService } from './payroll-batches.service';
import { PayrollExportService } from './payroll-export.service';
import { PayrollExceptionFilter } from './payroll-exception.filter';
import { PayrollResponseInterceptor } from './payroll-response.interceptor';
import { PayrollAdjustmentDto, PayrollAttendanceReviewDto, PayrollAttendanceSyncDto, PayrollCreateDto, PayrollDecisionDto, PayrollExportDto,
  PayrollFixtureDto, PayrollMonthDto, PayrollNoteDto, PayrollOpeningDto, PayrollRemainderDto, PayrollRuleDto,
  PayrollSettlementDto, PayrollStandardDto, PayrollSubjectDto, PayrollVersionDto, PayrollVoidDto } from './dto/payroll.dto';

@Controller('payroll')
@UseFilters(PayrollExceptionFilter)
@UseInterceptors(PayrollResponseInterceptor)
export class PayrollController {
  constructor(private readonly access: PayrollAccessService, private readonly data: PayrollDataService,
    private readonly batches: PayrollBatchesService, private readonly files: PayrollExportService) {}
  @Get('access') @Header('Cache-Control', 'no-store, private')
  accessForUser(@CurrentUser() actor: AuthUser) { return this.access.getAccess(actor); }
  @Get('employees') @Header('Cache-Control', 'no-store, private')
  employees(@Query() query: PayrollMonthDto, @CurrentUser() actor: AuthUser) { return this.data.employees(query.subjectId, query.month, actor); }
  @Get('operators') @Header('Cache-Control', 'no-store, private')
  operators(@Query() query: PayrollSubjectDto, @CurrentUser() actor: AuthUser) { return this.data.operators(query.subjectId, actor); }
  @Get('performance-cycles') @Header('Cache-Control', 'no-store, private')
  cycles(@Query() query: PayrollSubjectDto, @CurrentUser() actor: AuthUser) { return this.data.performanceCycles(query.subjectId, actor); }
  @Get('attendance') @Header('Cache-Control', 'no-store, private')
  attendance(@Query() query: PayrollMonthDto, @CurrentUser() actor: AuthUser) { return this.data.attendance(query.subjectId, query.month, actor); }
  @Get('attendance/fixture-response') @Header('Cache-Control', 'no-store, private')
  fixture(@Query() query: PayrollFixtureDto, @CurrentUser() actor: AuthUser) { return this.data.fixtureResponse(query.subjectId, query.month, query.corrected, actor); }
  @Post('attendance/sync') sync(@Body() input: PayrollAttendanceSyncDto, @CurrentUser() actor: AuthUser) { return this.data.sync(input, actor); }
  @Post('attendance/:id/review') review(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: PayrollAttendanceReviewDto, @CurrentUser() actor: AuthUser) { return this.data.review(id, input, actor); }
  @Post('attendance/:id/seal') seal(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: PayrollVersionDto, @CurrentUser() actor: AuthUser) { return this.data.seal(id, input.expectedVersion, actor); }
  @Get('standards') @Header('Cache-Control', 'no-store, private')
  standards(@Query() query: PayrollSubjectDto, @CurrentUser() actor: AuthUser) { return this.data.standards(query.subjectId, actor); }
  @Post('standards') standard(@Body() input: PayrollStandardDto, @CurrentUser() actor: AuthUser) { return this.data.saveStandard(input, actor); }
  @Post('standards/:id/activate') activateStandard(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: AuthUser) { return this.data.activate('standard', id, actor); }
  @Post('standards/:id/clone') cloneStandard(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: AuthUser) { return this.data.clone('standard', id, actor); }
  @Post('standards/:id/disable') disableStandard(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: AuthUser) { return this.data.disable('standard', id, actor); }
  @Get('rules') @Header('Cache-Control', 'no-store, private')
  rules(@Query() query: PayrollSubjectDto, @CurrentUser() actor: AuthUser) { return this.data.rules(query.subjectId, actor); }
  @Post('rules') rule(@Body() input: PayrollRuleDto, @CurrentUser() actor: AuthUser) { return this.data.saveRule(input, actor); }
  @Post('rules/:id/activate') activateRule(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: AuthUser) { return this.data.activate('rule', id, actor); }
  @Post('rules/:id/clone') cloneRule(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: AuthUser) { return this.data.clone('rule', id, actor); }
  @Post('rules/:id/disable') disableRule(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: AuthUser) { return this.data.disable('rule', id, actor); }
  @Get('adjustments') @Header('Cache-Control', 'no-store, private')
  adjustments(@Query() query: PayrollMonthDto, @CurrentUser() actor: AuthUser) { return this.data.adjustments(query.subjectId, query.month, actor); }
  @Post('adjustments') adjustment(@Body() input: PayrollAdjustmentDto, @CurrentUser() actor: AuthUser) { return this.data.addAdjustment(input, actor); }
  @Get('opening-balances') @Header('Cache-Control', 'no-store, private')
  openings(@Query() query: PayrollMonthDto, @CurrentUser() actor: AuthUser) { return this.data.openings(query.subjectId, query.month, actor); }
  @Post('opening-balances') opening(@Body() input: PayrollOpeningDto, @CurrentUser() actor: AuthUser) { return this.data.confirmOpening(input, actor); }
  @Get('batches') @Header('Cache-Control', 'no-store, private')
  list(@Query() query: PayrollSubjectDto, @CurrentUser() actor: AuthUser) { return this.batches.list(query.subjectId, actor); }
  @Get('batches/:id') @Header('Cache-Control', 'no-store, private')
  detail(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: AuthUser) { return this.batches.detail(id, actor); }
  @Post('batches') async create(@Body() input: PayrollCreateDto, @CurrentUser() actor: AuthUser) {
    const result = await this.batches.create(input, actor); return this.batches.detail(result.id, actor);
  }
  @Post('batches/:id/calculate') async calculate(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: PayrollVersionDto, @CurrentUser() actor: AuthUser) {
    await this.batches.calculate(id, input, actor); return this.batches.detail(id, actor);
  }
  @Post('batches/:id/submit') async submit(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: PayrollVersionDto, @CurrentUser() actor: AuthUser) {
    await this.batches.submit(id, input, actor); return this.batches.detail(id, actor);
  }
  @Post('batches/:id/decide') async decide(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: PayrollDecisionDto, @CurrentUser() actor: AuthUser) {
    await this.batches.decide(id, input, actor); return this.batches.detail(id, actor);
  }
  @Post('batches/:id/withdraw') async withdraw(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: PayrollNoteDto, @CurrentUser() actor: AuthUser) {
    await this.batches.withdraw(id, input, actor); return this.batches.detail(id, actor);
  }
  @Post('batches/:id/void') async voidApproved(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: PayrollVoidDto, @CurrentUser() actor: AuthUser) {
    return this.batches.voidApproved(id, input, actor);
  }
  @Post('batches/:id/settlements') async settle(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: PayrollSettlementDto, @CurrentUser() actor: AuthUser) {
    await this.batches.settle(id, input, actor); return this.batches.detail(id, actor);
  }
  @Post('batches/:id/cancel-remainder') async cancelRemainder(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: PayrollRemainderDto, @CurrentUser() actor: AuthUser) {
    await this.batches.cancelRemainder(id, input, actor); return this.batches.detail(id, actor);
  }
  @Post('batches/:id/export') @Header('Cache-Control', 'no-store, private')
  download(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: PayrollExportDto, @CurrentUser() actor: AuthUser) { return this.files.download(id, input, actor); }
}
