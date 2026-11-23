import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { PayrollAccessService } from './payroll-access.service';
import { PayrollBatchesService } from './payroll-batches.service';
import { PayrollDataService } from './payroll-data.service';
import { PayrollExportService } from './payroll-export.service';
import { PayrollController } from './payroll.controller';
import { PayrollParameterReleasesService } from './payroll-parameter-releases.service';
import { PAYROLL_ITEM_CODES, PayrollCapture } from './payroll-contracts';
import { payrollHash } from './payroll-transaction';

jest.mock('../../prisma/preview-guard.cjs', () => ({ assertPreviewEnvironment: jest.fn() }));
const environmentGuard = require('../../prisma/preview-guard.cjs').assertPreviewEnvironment as jest.Mock;
const editor = { id: 'fictional-editor' };
const input = { expectedVersion: 7, payDate: '2035-12-10', mode: 'complete' as const };

function selected(value: any, fields: any): any {
  if (Array.isArray(value)) return value.map(row => selected(row, fields));
  if (value === null || value === undefined) return value;
  return Object.fromEntries(Object.entries(fields).map(([key, field]: [string, any]) =>
    [key, field === true ? value[key] : selected(value[key], field.select)]));
}

// Persistence and external configuration are doubled; locking flow, grants and A1 are real.
function setup() {
  const employees = ['a', 'b'].map((id, index) => ({ id: `employee-${id}`, name: `虚构员工${id}`,
    employeeNo: `PAY-DEMO-${index + 1}`, dingtalkId: null, dingtalkUnionId: null }));
  const lines = employees.flatMap((employee, index) => PAYROLL_ITEM_CODES.map(itemCode => ({
    id: `${employee.id}-${itemCode}`, employeeId: employee.id, attributionMonth: '2035-11', itemCode,
    entitlement: new Prisma.Decimal(itemCode === 'fixed' ? index === 0 ? '12000' : '7000' : '0'),
    paidBefore: new Prisma.Decimal(itemCode === 'fixed' ? '2000' : '0'),
    amount: new Prisma.Decimal(itemCode === 'fixed' ? index === 0 ? '10000' : '5000' : '0'),
    status: 'ready', evidence: { applicability: 'applicable' }, settlements: [], reservation: null,
  })));
  const frozen = { months: [{ month: '2035-11', sources: { subjectId: 'subject-a', month: '2035-11', domain: 'validation',
    employments: employees.map(row => ({ userId: row.id, contractSubjectId: 'subject-a' })), attendance: { payload: {
    days: [{ employeeId: employees[0].id, records: [{ sourceId: 'fictional-attendance' }] }],
  } } } }] };
  const sourceHash = payrollHash([{ month: '2035-11', sourceHash: 'a'.repeat(64) }]);
  const version: any = { id: 'calculation-3', version: 3, status: 'calculated', sourceHash,
    sources: frozen, issues: [], gross: new Prisma.Decimal('15000'), lines,
    reviewerCount: 1, approvalPath: ['fictional-reviewer', 'fictional-approver'], decisions: [], exports: [],
    approvalStep: 0, approvedAt: null, voidedAt: null };
  const batch: any = { id: 'batch-a', subjectId: 'subject-a', purpose: 'validation', status: 'calculated',
    version: 7, month: '2035-11', payMonth: '2035-12', additionalMonths: [], versions: [version] };
  const grants = [{ userId: editor.id, subjectId: batch.subjectId, capabilities: ['payroll_edit'], revokedAt: null }];
  const markers: Record<string, any> = {
    local_preview_fixture_v1: { fictional: true },
    payroll_preview_fixture_v1: { fictional: true, subjectIds: [batch.subjectId], employeeIds: employees.map(row => row.id) },
  };
  const subject = { id: batch.subjectId, name: '虚构薪酬主体甲' };
  const writes: jest.Mock[] = [];
  const model = () => Object.fromEntries(['create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert'].map(key => {
    const method = jest.fn(() => { throw new Error('Preview must never write'); }); writes.push(method); return [key, method];
  }));
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    payrollGrant: { ...model(), findMany: jest.fn(async ({ where }) => grants.filter(row =>
      row.userId === where.userId && row.subjectId === where.subjectId && row.revokedAt === where.revokedAt)) },
    payrollBatch: { ...model(), findUnique: jest.fn(async (args) => {
      if (args.where.id !== batch.id) return null;
      if (args.select) return selected(batch, args.select);
      return batch;
    }) },
    systemConfig: { ...model(), findUnique: jest.fn(async ({ where }) => markers[where.key] ? { value: markers[where.key] } : null) },
    contractSubject: { ...model(), findUnique: jest.fn(async ({ where }) => where.id === subject.id ? { ...subject } : null) },
    user: { ...model(), findMany: jest.fn(async ({ where }) => employees.filter(row => where.id.in.includes(row.id))) },
    payrollAttendanceSnapshot: { ...model(), findMany: jest.fn().mockResolvedValue([]) },
    ...Object.fromEntries(['payrollVersion', 'payrollLine', 'payrollDecision', 'payrollEvent', 'payrollExport',
      'payrollReservation', 'payrollSettlement', 'payrollOpeningBalance', 'payrollStandard', 'payrollPolicy', 'payrollAdjustment']
      .map(key => [key, model()])),
  };
  const prisma: any = { ...tx, $transaction: jest.fn(async work => work(tx)) };
  const flags = { PAYROLL_ENABLED: 'true', HRM_PREVIEW: 'true', PAYROLL_FORMAL_ENABLED: 'false' };
  const config = { get: (key: string) => flags[key] } as ConfigService;
  const access = new PayrollAccessService(prisma, config);
  const capture: PayrollCapture = { sourceHash: 'a'.repeat(64), sources: {}, issues: [], gross: '15000.00',
    reviewerCount: 1, approvalPath: [...version.approvalPath], lines: lines.map(line => ({ ...line,
      entitlement: line.entitlement.toFixed(2), paidBefore: line.paidBefore.toFixed(2), amount: line.amount.toFixed(2) })) };
  const sources = { capture: jest.fn(async () => capture) };
  const service = new PayrollBatchesService(prisma, access, sources);
  const preview = (value: any = input, actor: any = editor) => (service as any).deductionsPreview(batch.id, value, actor);
  const noSalaryReads = () => {
    expect(tx.payrollBatch.findUnique.mock.calls.filter(([args]) => args.include?.versions?.include?.lines)).toHaveLength(0);
    expect(sources.capture).not.toHaveBeenCalled();
  };
  const noWrites = () => writes.forEach(write => expect(write).not.toHaveBeenCalled());
  return { service, preview, prisma, tx, flags, access, batch, version, employees, subject, grants, markers, sources, capture, noSalaryReads, noWrites };
}

describe('PayrollBatchesService deductions preview boundary', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => { environmentGuard.mockReset(); s = setup(); });
  afterEach(() => s.noWrites());

  it('saved mode leaves every missing employee pending instead of substituting the demonstration settings', async () => {
    s.tx.payrollDeductionProfile = {findFirst: jest.fn(async () => null)};
    const result = await s.preview({...input,mode:'saved'});
    expect(result.totals).toBeNull();expect(result.rows).toHaveLength(2);
    expect(result.rows.every(row => row.status==='needs_configuration'&&row.net===null)).toBe(true);
    expect(s.tx.payrollDeductionProfile.findFirst.mock.calls).toHaveLength(2);
    for(const [query] of s.tx.payrollDeductionProfile.findFirst.mock.calls)expect(query.where).toMatchObject({subjectId:s.batch.subjectId,payDate:new Date(input.payDate),status:'active'});
  });

  it('aggregates every employee from the latest line.amount without changing the approved pipeline', async () => {
    const before = JSON.stringify(s.batch);
    const result = await s.preview();
    expect(Object.keys(result).sort()).toEqual(['batchId', 'batchVersion', 'calculationVersion', 'calculationVersionId',
      'subjectId', 'sourceHash', 'payDate', 'payMonth', 'mode', 'basis', 'approvalStatus', 'rows', 'totals'].sort());
    expect(result).toMatchObject({ batchId: 'batch-a', batchVersion: 7, calculationVersion: 3, calculationVersionId: 'calculation-3',
      subjectId: 'subject-a', sourceHash: s.version.sourceHash, payDate: input.payDate, payMonth: '2035-12', mode: 'complete',
      basis: 'fictional', approvalStatus: 'not_submitted', totals: { gross: '15000.00', socialInsurance: '200.00',
        housingFund: '200.00', incomeTax: '1460.00', net: '13140.00' } });
    expect(result.rows).toEqual([expect.objectContaining({ employeeId: 'employee-a', employeeName: '虚构员工a', status: 'ready',
      gross: '10000.00', incomeTax: '980.00', net: '8820.00' }), expect.objectContaining({ employeeId: 'employee-b',
      employeeName: '虚构员工b', status: 'ready', gross: '5000.00', incomeTax: '480.00', net: '4320.00' })]);
    expect(JSON.stringify(s.batch)).toBe(before);
    expect(s.prisma.$transaction.mock.calls[0][1].isolationLevel).toBe('ReadCommitted');
    expect(s.tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it('accepts only a ready, explicitly owned monthly fictional fixture, not arbitrary preview employees', async () => {
    s.markers.payroll_preview_fixture_v1.subjectIds = [];
    s.markers.payroll_monthly_rules_preview_v1 = { fictional: true, state: 'ready', subjectIds: [s.batch.subjectId], employeeIds: s.employees.map(row => row.id) };
    s.employees.forEach((row, i) => { row.employeeNo = `PAY-MONTH-${i}`; });
    expect((await s.preview()).totals.gross).toBe('15000.00');
    s.markers.payroll_monthly_rules_preview_v1.state = 'preparing';
    await expect(s.preview()).rejects.toThrow(ForbiddenException);
    s.markers.payroll_monthly_rules_preview_v1.state = 'ready';
    s.employees[0].dingtalkId = 'external-bound' as any;
    await expect(s.preview()).rejects.toThrow(ForbiddenException);
  });

  it('omits exactly one current tax fact for the first employee and never reports partial totals', async () => {
    const result = await s.preview({ ...input, mode: 'missing' });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ employeeId: 'employee-a', status: 'needs_configuration', gross: null,
      socialInsurance: null, housingFund: null, incomeTax: null, net: null });
    expect(result.rows[0].issues).toHaveLength(1);
    expect(result.rows[0].issues[0]).toContain('tax.current.specialDeduction');
    expect(result.rows[1]).toMatchObject({ status: 'ready', gross: '5000.00', net: '4320.00' });
    expect(result.totals).toBeNull();
    expect((await s.preview()).rows[0].status).toBe('ready');
  });

  it('retains a needs_review employee instead of dropping the person or adding ready-only totals', async () => {
    Object.assign(s.version.lines[0], { entitlement: new Prisma.Decimal('2000'), amount: new Prisma.Decimal('0') });
    s.version.gross = new Prisma.Decimal('5000'); s.capture.gross = '5000.00';
    Object.assign(s.capture.lines[0], { entitlement: '2000.00', amount: '0.00' });
    const result = await s.preview();
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ employeeId: 'employee-a', status: 'needs_review', net: null });
    expect(result.totals).toBeNull();
  });

  it.each(['outsider', 'view-only', 'cross-subject', 'assessor', 'disabled', 'revoked'])('rejects %s before reading salary', async kind => {
    let actor: any = editor;
    if (kind === 'outsider') actor = { id: 'outsider', sysRole: 'system_admin', canViewAll: true };
    if (kind === 'view-only') s.grants[0].capabilities = ['payroll_view'];
    if (kind === 'cross-subject') s.grants[0].subjectId = 'subject-b';
    if (kind === 'assessor') actor = { ...editor, isAssessorOnly: true };
    if (kind === 'disabled') s.flags.PAYROLL_ENABLED = 'false';
    if (kind === 'revoked') (s.grants[0] as any).revokedAt = new Date();
    await expect(s.preview(input, actor)).rejects.toBeInstanceOf(ForbiddenException);
    s.noSalaryReads();
  });

  it('rechecks a grant revoked during subject-lock wait before reading salary', async () => {
    s.tx.$queryRaw.mockImplementation(async () => { (s.grants[0] as any).revokedAt = new Date(); return []; });
    await expect(s.preview()).rejects.toBeInstanceOf(ForbiddenException);
    s.noSalaryReads();
  });

  it.each(['subject', 'purpose'])('rereads and rejects changed %s after lock wait', async field => {
    s.tx.$queryRaw.mockImplementation(async () => {
      if (field === 'subject') s.batch.subjectId = 'subject-b'; else s.batch.purpose = 'formal';
      return [];
    });
    await expect(s.preview()).rejects.toBeInstanceOf(ConflictException);
    s.noSalaryReads();
  });

  it('rejects formal batches even if formal payroll itself is enabled', async () => {
    s.batch.purpose = 'formal'; s.flags.HRM_PREVIEW = 'false'; s.flags.PAYROLL_FORMAL_ENABLED = 'true';
    await expect(s.preview()).rejects.toBeInstanceOf(ForbiddenException);
    s.noSalaryReads();
  });

  it('runs the existing environment guard before salary reads', async () => {
    environmentGuard.mockImplementation(() => { throw new ForbiddenException('Not an isolated preview'); });
    await expect(s.preview()).rejects.toBeInstanceOf(ForbiddenException);
    s.noSalaryReads();
  });

  it.each(['local-missing', 'local-real', 'payroll-missing', 'payroll-real', 'unregistered-subject', 'unregistered-employee',
    'real-subject-name', 'real-employee-name', 'real-employee-number', 'dingtalk-id', 'dingtalk-union', 'missing-employee']) (
    'rejects %s without reading salary or guessing fictional identity', async kind => {
      if (kind === 'local-missing') delete s.markers.local_preview_fixture_v1;
      if (kind === 'local-real') s.markers.local_preview_fixture_v1.fictional = false;
      if (kind === 'payroll-missing') delete s.markers.payroll_preview_fixture_v1;
      if (kind === 'payroll-real') s.markers.payroll_preview_fixture_v1.fictional = false;
      if (kind === 'unregistered-subject') s.markers.payroll_preview_fixture_v1.subjectIds = ['other'];
      if (kind === 'unregistered-employee') s.markers.payroll_preview_fixture_v1.employeeIds = ['employee-a'];
      if (kind === 'real-subject-name') s.subject.name = 'Ordinary company';
      if (kind === 'real-employee-name') s.employees[1].name = 'Ordinary employee';
      if (kind === 'real-employee-number') s.employees[1].employeeNo = 'EMP001';
      if (kind === 'dingtalk-id') (s.employees[1] as any).dingtalkId = 'bound';
      if (kind === 'dingtalk-union') (s.employees[1] as any).dingtalkUnionId = 'bound';
      if (kind === 'missing-employee') s.employees.pop();
      await expect(s.preview()).rejects.toBeInstanceOf(ForbiddenException);
      s.noSalaryReads();
    });

  it('accepts only a ready dedicated fixture with every identity explicitly registered', async () => {
    s.markers.payroll_preview_fixture_v1.subjectIds = ['base-subject'];
    s.markers.payroll_preview_fixture_v1.employeeIds = ['base-employee'];
    s.markers.payroll_deductions_preview_fixture_v1 = { fictional: true, state: 'ready',
      subjectIds: [s.batch.subjectId], employeeIds: s.employees.map(row => row.id) };
    s.employees.forEach(row => { row.employeeNo = row.employeeNo.replace('PAY-DEMO-', 'PAY-DEDUCT-'); });
    expect((await s.preview()).rows).toHaveLength(2);
  });

  it.each(['not-fictional', 'preparing', 'missing-person', 'missing-subject'])('rejects dedicated fixture %s', async kind => {
    s.markers.payroll_preview_fixture_v1.subjectIds = [];
    const dedicated: any = { fictional: true, state: 'ready', subjectIds: [s.batch.subjectId], employeeIds: ['employee-a', 'employee-b'] };
    s.markers.payroll_deductions_preview_fixture_v1 = dedicated;
    if (kind === 'not-fictional') dedicated.fictional = false;
    if (kind === 'preparing') dedicated.state = 'preparing';
    if (kind === 'missing-person') dedicated.employeeIds.pop();
    if (kind === 'missing-subject') dedicated.subjectIds = [];
    await expect(s.preview()).rejects.toBeInstanceOf(ForbiddenException);
    s.noSalaryReads();
  });

  it.each(['', '2035-02-30', '2035-12-32', '2035-11-30', '2036-01-01', '2035-12-1', null, undefined])(
    'rejects missing, noncalendar or wrong-month pay date %j', async payDate => {
      await expect(s.preview({ ...input, payDate })).rejects.toBeInstanceOf(BadRequestException);
    });

  it.each([0, 6, 8, '7', null])('rejects stale/invalid batch token %j', async expectedVersion => {
    await expect(s.preview({ ...input, expectedVersion })).rejects.toBeInstanceOf(ConflictException);
  });

  it('rereads an advanced token after lock wait', async () => {
    s.tx.$queryRaw.mockImplementation(async () => { s.batch.version++; return []; });
    await expect(s.preview()).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['gross', 'employeeId', 'employeeIds', 'subjectId', 'tax', 'socialInsurance', 'housingFund']) (
    'rejects client-controlled %s instead of overriding stored facts', async key => {
      await expect(s.preview({ ...input, [key]: 'client-value' })).rejects.toBeInstanceOf(BadRequestException);
    });

  it.each([null, 'other', undefined])('requires explicit complete/missing mode %j', async mode => {
    await expect(s.preview({ ...input, mode })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['draft', 'returned', 'withdrawn', 'voided'])('rejects batch status %s', async status => {
    s.batch.status = status;
    await expect(s.preview()).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['missing-version', 'wrong-version-status', 'missing-item', 'duplicate-item', 'null-amount', 'null-entitlement',
    'null-paid', 'issues', 'not-ready', 'wrong-gross', 'wrong-equation'])('rejects incomplete latest result %s', async kind => {
    if (kind === 'missing-version') s.batch.versions = [];
    if (kind === 'wrong-version-status') s.version.status = 'pending';
    if (kind === 'missing-item') s.version.lines.splice(1, 1);
    if (kind === 'duplicate-item') s.version.lines.push(s.version.lines[0]);
    if (kind === 'null-amount') s.version.lines[0].amount = null;
    if (kind === 'null-entitlement') s.version.lines[0].entitlement = null;
    if (kind === 'null-paid') s.version.lines[0].paidBefore = null;
    if (kind === 'issues') s.version.issues = ['Configuration unresolved'];
    if (kind === 'not-ready') s.version.lines[0].status = 'needs_configuration';
    if (kind === 'wrong-gross') s.version.gross = new Prisma.Decimal('14999');
    if (kind === 'wrong-equation') s.version.lines[0].entitlement = new Prisma.Decimal('9999');
    await expect(s.preview()).rejects.toBeInstanceOf(ConflictException);
  });

  it('permits explicitly evidenced not-applicable zero items but never missing ones', async () => {
    Object.assign(s.version.lines[1], { status: 'not_applicable', evidence: { applicability: 'not_applicable' } });
    expect((await s.preview()).rows[0].status).toBe('ready');
    s.version.lines[1].evidence = {};
    await expect(s.preview()).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['calculated', 'pending'])('reuses freshness checks for %s', async status => {
    s.batch.status = s.version.status = status;
    expect((await s.preview()).rows).toHaveLength(2);
    s.capture.sourceHash = 'b'.repeat(64);
    await expect(s.preview()).rejects.toBeInstanceOf(ConflictException);
  });

  it('checks approved frozen attendance without recapturing ordinary settlement changes', async () => {
    s.batch.status = s.version.status = 'approved';
    s.version.approvedAt = new Date();
    s.capture.sourceHash = 'changed-by-settlement';
    expect((await s.preview()).rows[0].gross).toBe('10000.00');
    expect(s.sources.capture).not.toHaveBeenCalled();
    s.tx.payrollAttendanceSnapshot.findMany.mockResolvedValue([{ month: '2035-10', version: 2, sourceHash: 'conflict',
      payload: { days: [{ records: [{ sourceId: 'fictional-attendance' }] }] } }]);
    await expect(s.preview()).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an approved version missing an entire frozen employee even when gross matches the remaining five lines', async () => {
    s.batch.status = s.version.status = 'approved';
    s.version.lines = s.version.lines.filter(line => line.employeeId !== 'employee-b');
    s.version.gross = new Prisma.Decimal('10000');
    await expect(s.preview()).rejects.toBeInstanceOf(ConflictException);
    expect(s.sources.capture).not.toHaveBeenCalled();
  });

  it.each(['missing-month', 'duplicate-month', 'missing-employments', 'foreign-subject', 'extra-line-month']) (
    'rejects frozen scope %s instead of inferring scope from remaining lines', async kind => {
      s.batch.status = s.version.status = 'approved';
      if (kind === 'missing-month') s.version.sources.months = [];
      if (kind === 'duplicate-month') s.version.sources.months.push(s.version.sources.months[0]);
      if (kind === 'missing-employments') delete s.version.sources.months[0].sources.employments;
      if (kind === 'foreign-subject') s.version.sources.months[0].sources.subjectId = 'subject-b';
      if (kind === 'extra-line-month') s.version.lines[0].attributionMonth = '2035-10';
      await expect(s.preview()).rejects.toBeInstanceOf(ConflictException);
    });

  it('also supports a registered trial without submitting it to any approval/export', async () => {
    s.batch.purpose = 'trial';
    expect((await s.preview()).approvalStatus).toBe('not_submitted');
  });
});

describe('deductions preview HTTP contract', () => {
  it('rejects injected facts even when the global validation pipe normally strips unknown fields', async () => {
    const s = setup(); environmentGuard.mockReset();
    const data = {saveDeductions: jest.fn(async input => input)};
    const module = await Test.createTestingModule({ controllers: [PayrollController], providers: [
      { provide: PayrollAccessService, useValue: s.access }, { provide: PayrollDataService, useValue: data },
      { provide: PayrollBatchesService, useValue: s.service }, { provide: PayrollExportService, useValue: {} },
      { provide: PayrollParameterReleasesService, useValue: {} },
    ] }).compile();
    const app = module.createNestApplication();
    app.use((req, _res, next) => { req.user = editor; next(); });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    try {
      // The route requires a UUID even though the isolated persistence fixture uses readable IDs.
      s.batch.id = '00000000-0000-4000-8000-000000000001';
      const url = `/payroll/batches/${s.batch.id}/deductions-preview`;
      const success = await request(app.getHttpServer()).post(url).send(input).expect(201);
      expect(success.headers['cache-control']).toBe('no-store, private');
      expect(success.body.rows).toHaveLength(2);
      s.tx.payrollBatch.findUnique.mockClear(); s.sources.capture.mockClear();
      await request(app.getHttpServer()).post(url).send({ ...input, gross: '1' }).expect(400);
      await request(app.getHttpServer()).post(url).send({ ...input, payDate: '2035-02-30' }).expect(400);
      const profile = {subjectId:s.batch.id,employeeId:s.batch.id,payDate:input.payDate,settings:{}};
      await request(app.getHttpServer()).post('/payroll/deduction-profiles').send({...profile,gross:'1'}).expect(400);
      expect(data.saveDeductions).not.toHaveBeenCalled();
      await request(app.getHttpServer()).post('/payroll/deduction-profiles').send(profile).expect(201);
      expect(data.saveDeductions).toHaveBeenCalledWith(expect.objectContaining(profile),editor);
      s.noSalaryReads(); s.noWrites();
    } finally { await app.close(); }
  });
});
