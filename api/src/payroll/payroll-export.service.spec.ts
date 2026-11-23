import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import * as officeCrypto from 'officecrypto-tool';
import { randomBytes } from 'node:crypto';
import { PayrollExportService } from './payroll-export.service';
import { RosterSensitiveExportService } from '@/users/roster-sensitive-export.service';
import { capturePayrollNet, netSnapshotHash } from './payroll-net';
import { fictionalDeductionsInput } from './payroll-deductions-preview.fixture';
import { payrollHash } from './payroll-transaction';
import { payrollParameterDefinition } from './payroll-parameter-definition';
import { PayrollAccessService } from './payroll-access.service';
import { readPayrollPerformance } from './payroll-performance-source';

describe('locked payroll export', () => {
  function fixture() {
    const batch = { id: 'batch', subjectId: 'subject', purpose: 'validation', status: 'approved', version: 4, month: '2026-11', payMonth: '2026-12' };
    const version = { id: 'calculation', version: 1, status: 'approved', gross: new Prisma.Decimal('17500'), approvedAt: new Date('2026-11-01T00:00:00Z'), voidedAt: null, issues: [],
      sourceHash: 'a'.repeat(64), payDate: null as Date | null, netSnapshot: null as any,
      approvalStep: 2, approvalPath: ['reviewer', 'approver'], reviewerCount: 1,
      decisions: [{ step: 0, actorId: 'reviewer', action: 'approve' }, { step: 1, actorId: 'approver', action: 'approve' }],
      lines: ['fixed', 'absence', 'overtime', 'performance', 'adjustment'].map((itemCode, index) => ({ id: itemCode, employeeId: 'employee', attributionMonth: '2026-11', itemCode,
        amount: new Prisma.Decimal(['17400', '-200', '300', '0', '0'][index]), status: itemCode === 'performance' ? 'not_applicable' : 'ready',
        evidence: { employeeName: '虚构核算甲', employeeNo: 'PAY_TEST', ...(itemCode === 'performance' ? {
          applicability: 'not_applicable', calculated: null, adjustment: '0.00', adjustmentIds: [],
        } : {}) } })) };
    const tx = { payrollBatch: { findUnique: jest.fn(async () => batch) }, payrollVersion: { findFirst: jest.fn(async () => version) },
      payrollEvent: { create: jest.fn(async () => ({})), findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      payrollExportRecord: { create: jest.fn(async () => ({})) }, contractSubject: { findUniqueOrThrow: jest.fn(async () => ({ name: '虚构薪酬主体' })) },
      $queryRaw: jest.fn(async () => []), payrollSettlement: { create: jest.fn() } };
    const prisma = { $transaction: async (work: (tx: any) => any) => work(tx) };
    const access = { assert: jest.fn(async () => undefined), assertDomain: jest.fn(async () => 'validation') };
    const crypto = { encryptWorkbook: jest.fn<Promise<Buffer>, [Buffer, string]>(async plain => Buffer.from(plain)) };
    return { batch, version, tx, access, crypto, service: new PayrollExportService(prisma as any, access as any, crypto as any) };
  }
  const actor = { id: 'exporter', sysRole: 'employee' } as any;
  function sealNet(snapshot: any) {
    const { sourceHash, ...body } = snapshot;
    snapshot.sourceHash = netSnapshotHash(body);
  }
  function netFixture() {
    const setup = fixture();
    setup.version.payDate = new Date('2026-12-10T00:00:00.000Z');
    setup.version.netSnapshot = { schema: 1, subjectId: 'subject', domain: 'validation', payDate: '2026-12-10', sourceHash: '',
      rows: [{ employeeId: 'employee', employeeName: '虚构核算甲', employeeNo: 'PAY_TEST', result: {
        status: 'ready', issues: [], gross: '17500.00', socialInsurance: '1000.00', housingFund: '500.00', incomeTax: '200.00', net: '15800.00',
        evidence: { sourceHash: 'fictional-input-hash', input: { privateConfiguration: 'DO_NOT_EXPORT' },
          parameter: { id: 'profile', version: 1, releaseId: 'release', snapshotHash: 'fictional-parameter-hash' } },
      }, ledger: { openingDate: '2026-11-01', openingHash: 'fictional-opening', factIds: [], socialMonth: '2026-11', housingMonth: '2026-11',
        sourceHash: 'fictional-ledger', taxDeductions: { exemptIncome: '0', standardDeduction: '14000', specialDeduction: '0', additionalDeduction: '0', otherDeduction: '0', taxRelief: '0' } },
      }], totals: { gross: '17500.00', socialInsurance: '1000.00', housingFund: '500.00', incomeTax: '200.00', net: '15800.00' } };
    const payments = { findFirst: jest.fn(async ({ where }: any) => {
      const row = setup.version.netSnapshot.rows.find((entry: any) => entry.employeeId === where.employeeId);
      return row ? { snapshot: structuredClone(row), payDate: setup.version.payDate,
        ...Object.fromEntries(['gross', 'socialInsurance', 'housingFund', 'incomeTax', 'net'].map(key => [key, new Prisma.Decimal(row.result[key])])) } : null;
    }), findMany: jest.fn(async () => []), create: jest.fn() };
    const profiles = { findFirst: jest.fn<Promise<any>, [any]>(async () => null) };
    Object.assign(setup.tx, { payrollNetPayment: payments, payrollDeductionProfile: profiles });
    sealNet(setup.version.netSnapshot);
    return { ...setup, payments, profiles };
  }
  async function unpaidNetFixture() {
    const setup = netFixture(); setup.payments.findFirst.mockResolvedValue(null);
    const facts = fictionalDeductionsInput({ subjectId: 'subject', employeeId: 'employee', month: '2026-11', payDate: '2026-12-10', gross: '17500' });
    const { gross, payDate, subjectId, employeeId, ...settings } = facts;
    const { subjectId: s, employeeId: e, year, ...opening } = settings.tax.opening;
    settings.socialInsurance.items[0].base = '10000'; settings.housingFund.items[0].base = '5000';
    settings.tax.current.standardDeduction = '14000'; settings.tax.current.specialDeduction = '0';
    const profile: any = { id: 'profile', subjectId, employeeId, domain: 'validation', payDate: new Date(payDate),
      effectiveFrom: new Date(payDate), effectiveTo: new Date(payDate), version: 1, status: 'active', settings: {
        ...settings, tax: { ...settings.tax, opening }, ledger: {
          startDate: '2026-11-01', priorInPayMonth: { exemptIncome: '0', standardDeduction: '0', specialDeduction: '0', additionalDeduction: '0', otherDeduction: '0', taxRelief: '0' },
          priorSocialInsurance: '0', priorHousingFund: '0',
        },
      } };
    profile.releases = [{ id: 'release', submittedById: 'hr', reviewerId: 'manager', parameterVersion: 1,
      snapshotHash: payrollHash(payrollParameterDefinition('deduction', profile)) }];
    setup.profiles.findFirst.mockResolvedValue(profile);
    setup.version.netSnapshot = await capturePayrollNet(setup.tx as any, setup.batch, 'validation', payDate,
      setup.version.lines.map(line => ({ ...line, amount: line.amount.toFixed(2) })));
    return { ...setup, profile };
  }
  async function readWorkbook(file: Awaited<ReturnType<PayrollExportService['download']>>, password?: string) {
    const chunks: Buffer[] = []; for await (const chunk of file.getStream()) chunks.push(Buffer.from(chunk));
    let data: Buffer = Buffer.concat(chunks);
    if (password) {
      expect(data.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1');
      data = await officeCrypto.decrypt(data, { password }) as Buffer;
    }
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(data as any); return workbook;
  }
  it.each([false, true])('blocks approved unpaid automatic performance changes before returning an export, late=%s', async late => {
    const setup = await unpaidNetFixture();
    const task: any = { id: 'fictional-task', employeeId: 'employee', cycleId: 'monthly-cycle', status: 'published', isExempt: false, participantDisposition: 'active',
      publishedAt: new Date('2026-11-30'), cycle: { type: 'monthly', startDate: new Date('2026-11-01'), endDate: new Date('2026-11-30') },
      gradeResult: { id: 'grade', calibratedGrade: 'A', rawGrade: 'B', isPublished: true, publishedAt: new Date('2026-11-30'), hrCalibratedAt: null, approvedAt: null }, appeals: [] };
    Object.assign(setup.tx, { assessmentTask: { findUnique: jest.fn(async () => task) } });
    const result = await readPayrollPerformance(setup.tx as any, { employeeId: 'employee', cycleId: task.cycleId, registeredCycleIds: [task.cycleId], requiredMonth: '2026-11' });
    setup.version.lines[3].status = 'ready'; Object.assign(setup.version.lines[3].evidence, { applicability: 'applicable', calculated: { code: 'performance', amount: '0.00' } });
    const policy: any = { id: 'policy', subjectId: 'subject', domain: 'validation', status: 'active', version: 1, effectiveFrom: new Date('2026-11-01'), effectiveTo: null,
      config: { fixedSalaryBasis: 'monthly_workdays', performance: { '2026-11': { sourceKind: 'fictional', cycleIds: [task.cycleId], coefficients: { A: '1' }, coefficientVersion: 'v1', evidenceRef: 'fictional' } } } };
    const release = { ruleId: policy.id, previousParameterId: null, parameterVersion: 1, snapshotHash: payrollHash(payrollParameterDefinition('rule', policy)) };
    Object.assign(setup.tx, { payrollPolicy: { findMany: jest.fn(async () => [policy]) }, payrollParameterRelease: { findMany: jest.fn(async () => [release]) } });
    (setup.version as any).sources = JSON.parse(JSON.stringify({ months: [{ month: '2026-11', sources: { performance: [{ employeeId: 'employee', cycleId: task.cycleId, result }],
      policies: [policy], parameterReleases: [release], attendance: { payload: { days: [{ employeeId: 'employee', workDate: '2026-11-10' }] } } } }] }));
    let encrypted: Buffer | undefined;
    if (late) setup.crypto.encryptWorkbook.mockImplementation(async buffer => { encrypted = Buffer.from(buffer); task.gradeResult.isPublished = false; return encrypted; });
    else task.gradeResult.isPublished = false;
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: 'fictional-password' }, actor)).rejects.toThrow(ConflictException);
    expect(setup.crypto.encryptWorkbook).toHaveBeenCalledTimes(late ? 1 : 0); expect(setup.tx.payrollExportRecord.create).not.toHaveBeenCalled();
    if (late) expect(encrypted!.every(byte => byte === 0)).toBe(true);
  });
  it.each([false, true])('blocks approved unpaid manual performance changes before returning an export, late=%s', async late => {
    const setup = await unpaidNetFixture(); setup.version.lines[0].amount = new Prisma.Decimal('16900'); setup.version.lines[3].amount = new Prisma.Decimal('500');
    setup.version.lines[3].status = 'ready'; Object.assign(setup.version.lines[3].evidence, { applicability: 'applicable', manualPerformance: { amount: '500.00' } });
    const policy: any = { id: 'policy', subjectId: 'subject', domain: 'validation', version: 1, status: 'active', effectiveFrom: new Date('2026-11-01'), effectiveTo: null,
      config: { performance: { '2026-11': { sourceKind: 'manual', manualAmounts: { employee: '500.00' }, evidenceRef: 'fictional-approved-input', cycleIds: [], coefficients: {} } } } };
    const release = { ruleId: policy.id, previousParameterId: null, parameterVersion: 1, snapshotHash: payrollHash(payrollParameterDefinition('rule', policy)) };
    const assessmentTask = { findUnique: jest.fn(async () => { throw new Error('Manual performance must not read HRM results'); }) };
    Object.assign(setup.tx, { assessmentTask, payrollPolicy: { findMany: jest.fn(async () => [policy]) }, payrollParameterRelease: { findMany: jest.fn(async () => [release]) } });
    (setup.version as any).sources = { months: [{ month: '2026-11', sources: { manualPerformance: [{ employeeId: 'employee', month: '2026-11',
      workDates: ['2026-11-10', '2026-11-20'], entries: [{ policyId: policy.id, amount: '500.00', evidenceRef: 'fictional-approved-input' }] }] } }] };
    const change = () => { policy.config.performance['2026-11'].manualAmounts.employee = '600.00'; release.snapshotHash = payrollHash(payrollParameterDefinition('rule', policy)); };
    let encrypted: Buffer | undefined;
    if (late) setup.crypto.encryptWorkbook.mockImplementation(async buffer => { encrypted = Buffer.from(buffer); change(); return encrypted; });
    else change();
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: 'fictional-password' }, actor)).rejects.toThrow(ConflictException);
    expect(assessmentTask.findUnique).not.toHaveBeenCalled(); expect(setup.tx.payrollExportRecord.create).not.toHaveBeenCalled();
    expect(setup.crypto.encryptWorkbook).toHaveBeenCalledTimes(late ? 1 : 0);
    if (late) expect(encrypted!.every(byte => byte === 0)).toBe(true);
  });
  it('exports one net row per employee, all attribution months, exact totals and minimal approval evidence', async () => {
    const setup = netFixture();
    setup.version.lines.push(...setup.version.lines.map(line => ({ ...line, id: `${line.id}-prior`, attributionMonth: '2026-10',
      amount: new Prisma.Decimal(line.itemCode === 'adjustment' ? '100' : '0') })));
    setup.version.gross = new Prisma.Decimal('17600');
    setup.version.netSnapshot.rows[0].result.gross = '17600.00'; setup.version.netSnapshot.rows[0].result.net = '15900.00';
    setup.version.netSnapshot.totals.gross = '17600.00'; setup.version.netSnapshot.totals.net = '15900.00';
    sealNet(setup.version.netSnapshot);
    const password = randomBytes(12).toString('hex'), cipher = new RosterSensitiveExportService({} as any, {} as any);
    setup.crypto.encryptWorkbook.mockImplementation((plain, filePassword) => cipher.encryptWorkbook(plain, filePassword));
    const file = await setup.service.download('batch', { expectedVersion: 4, filePassword: password }, actor);
    const workbook = await readWorkbook(file, password), sheet = workbook.getWorksheet('工资实发')!;
    expect(workbook.worksheets.map(row => row.name)).toEqual(['工资实发', '工资明细', '审批依据']);
    expect(sheet.rowCount).toBe(4);
    expect(['F3', 'G3', 'H3', 'I3', 'J3'].map(cell => sheet.getCell(cell).value)).toEqual([17600, 1000, 500, 200, 15900]);
    expect(['F4', 'G4', 'H4', 'I4', 'J4'].map(cell => sheet.getCell(cell).value)).toEqual([17600, 1000, 500, 200, 15900]);
    const details = workbook.getWorksheet('工资明细')!;
    expect(details.rowCount).toBe(4);
    expect([details.getCell('D3').value, details.getCell('D4').value].sort()).toEqual(['2026-10', '2026-11']);
    expect(['F4', 'G4', 'H4', 'I4', 'J4', 'K4'].map(cell => details.getCell(cell).value)).toEqual([0, 0, 0, 0, 100, 100]);
    const basis = JSON.stringify(workbook.getWorksheet('审批依据')!.model);
    for (const value of ['batch', 'a'.repeat(64), setup.version.netSnapshot.sourceHash, '2026-12-10', '2026-11-01T00:00:00.000Z']) expect(basis).toContain(value);
    expect(JSON.stringify(workbook.model)).not.toContain('DO_NOT_EXPORT');
    for (const worksheet of workbook.worksheets) expect(worksheet.getCell('A1').value).toBe('测试环境');
    expect(file.getHeaders().disposition).toContain('payroll-validation-net-2026-11-v1.xlsx');
    expect(setup.tx.payrollSettlement.create).not.toHaveBeenCalled();
    expect(setup.payments.create).not.toHaveBeenCalled();
  });
  it('permits formal net export only through the explicit formal server-domain gate', async () => {
    const setup = netFixture(); setup.batch.purpose = 'formal';
    setup.version.netSnapshot.domain = 'formal'; sealNet(setup.version.netSnapshot);
    const file = await setup.service.download('batch', { expectedVersion: 4, filePassword: 'fictional-file-password' }, actor);
    const workbook = await readWorkbook(file);
    expect(workbook.getWorksheet('工资实发')!.getCell('A1').value).toBe('正式工资');
    expect(file.getHeaders().disposition).toContain('payroll-formal-net-2026-11-v1.xlsx');
    expect(setup.access.assertDomain).toHaveBeenCalledWith(setup.tx, 'formal');
    expect(setup.access.assertDomain.mock.calls.every(call => (call as any[])[1] === 'formal')).toBe(true);
  });
  it('denies formal net export when the server formal flag is off', async () => {
    const setup = netFixture(); setup.batch.purpose = 'formal';
    setup.access.assertDomain.mockRejectedValue(new ForbiddenException('正式薪酬尚未开放'));
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: 'fictional-file-password' }, actor)).rejects.toThrow(ForbiddenException);
    expect(setup.crypto.encryptWorkbook).not.toHaveBeenCalled();
  });
  it.each([
    { PAYROLL_ENABLED: 'true', PAYROLL_FORMAL_ENABLED: 'false', HRM_PREVIEW: 'true' },
    { PAYROLL_ENABLED: 'true', PAYROLL_FORMAL_ENABLED: 'true', HRM_PREVIEW: 'true' },
    { PAYROLL_ENABLED: 'false', PAYROLL_FORMAL_ENABLED: 'true', HRM_PREVIEW: 'false' },
  ])('keeps the real server formal/preview gates closed with %j', async flags => {
    const setup = netFixture(); setup.batch.purpose = 'formal';
    Object.assign(setup.tx, { payrollGrant: { findMany: async () => [{ userId: actor.id, subjectId: 'subject', capabilities: ['payroll_export'], revokedAt: null }] } });
    const access = new PayrollAccessService({} as any, { get: (key: string) => flags[key] } as any);
    const service = new PayrollExportService({ $transaction: (work: any) => work(setup.tx) } as any, access, setup.crypto as any);
    await expect(service.download('batch', { expectedVersion: 4, filePassword: 'fictional-file-password' }, actor)).rejects.toThrow(ForbiddenException);
    expect(setup.crypto.encryptWorkbook).not.toHaveBeenCalled();
  });
  it('retains the validation-domain environment guard for net exports', async () => {
    const setup = netFixture(); setup.access.assertDomain.mockRejectedValue(new ForbiddenException('仅允许虚构预览'));
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: 'fictional-file-password' }, actor)).rejects.toThrow(ForbiddenException);
    expect(setup.crypto.encryptWorkbook).not.toHaveBeenCalled();
  });
  it('never allows a trial to export even with a complete net snapshot', async () => {
    const setup = netFixture(); setup.batch.purpose = 'trial';
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: 'fictional-file-password' }, actor)).rejects.toThrow(ForbiddenException);
    expect(setup.crypto.encryptWorkbook).not.toHaveBeenCalled();
  });
  it.each([
    ['row net', (snapshot: any) => { snapshot.rows[0].result.net = '15800.01'; }],
    ['row gross', (snapshot: any) => { snapshot.rows[0].result.gross = '17501.00'; snapshot.rows[0].result.net = '15801.00'; snapshot.totals.gross = '17501.00'; snapshot.totals.net = '15801.00'; }],
    ['total', (snapshot: any) => { snapshot.totals.socialInsurance = '999.00'; }],
    ['missing row', (snapshot: any) => { snapshot.rows = []; }],
    ['extra employee', (snapshot: any) => { snapshot.rows[0].employeeId = 'outsider'; }],
    ['duplicate row', (snapshot: any) => { snapshot.rows.push(snapshot.rows[0]); }],
    ['missing amount', (snapshot: any) => { snapshot.rows[0].result.housingFund = null; }],
    ['not ready', (snapshot: any) => { snapshot.rows[0].result.status = 'needs_review'; }],
    ['unresolved issue', (snapshot: any) => { snapshot.rows[0].result.issues = ['pending']; }],
    ['pay date', (snapshot: any) => { snapshot.payDate = '2026-12-11'; }],
    ['missing hash', (snapshot: any) => { delete snapshot.sourceHash; }],
    ['invalid hash', (snapshot: any) => { snapshot.sourceHash = 'c'.repeat(64); }],
    ['wrong subject', (snapshot: any) => { snapshot.subjectId = 'other-subject'; }],
    ['wrong domain', (snapshot: any) => { snapshot.domain = 'formal'; }],
    ['null totals', (snapshot: any) => { snapshot.totals = null; }],
    ['subcent amount', (snapshot: any) => { snapshot.rows[0].result.net = '15800.001'; }],
  ])('blocks invalid approved net snapshot: %s', async (_name, change) => {
    const setup = netFixture(); (change as (snapshot: any) => void)(setup.version.netSnapshot);
    if (_name !== 'missing hash' && _name !== 'invalid hash') sealNet(setup.version.netSnapshot);
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: 'fictional-file-password' }, actor)).rejects.toThrow(ConflictException);
    expect(setup.crypto.encryptWorkbook).not.toHaveBeenCalled();
    expect(setup.tx.payrollExportRecord.create).not.toHaveBeenCalled();
  });
  it('exports an unpaid approved net snapshot against live reviewed parameters without writing payment facts', async () => {
    const setup = await unpaidNetFixture();
    const workbook = await readWorkbook(await setup.service.download('batch', { expectedVersion: 4, filePassword: 'fictional-file-password' }, actor));
    expect(['F3', 'G3', 'H3', 'I3', 'J3'].map(cell => workbook.getWorksheet('工资实发')!.getCell(cell).value)).toEqual([17500, 1000, 500, 350, 15650]);
    expect(setup.payments.create).not.toHaveBeenCalled(); expect(setup.tx.payrollSettlement.create).not.toHaveBeenCalled();
  });
  it.each([false, true])('blocks stale unpaid reviewed parameters before returning a file, late=%s', async late => {
    const setup = await unpaidNetFixture(); let encrypted: Buffer | undefined, plain: Buffer | undefined;
    const invalidate = () => { setup.profile.version++; };
    if (late) setup.crypto.encryptWorkbook.mockImplementation(async buffer => { plain = buffer; encrypted = Buffer.from(buffer); invalidate(); return encrypted; });
    else invalidate();
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: 'fictional-file-password' }, actor)).rejects.toThrow(ConflictException);
    expect(setup.crypto.encryptWorkbook).toHaveBeenCalledTimes(late ? 1 : 0);
    expect(setup.tx.payrollExportRecord.create).not.toHaveBeenCalled();
    expect(setup.payments.create).not.toHaveBeenCalled();
    if (late) { expect(plain!.every(byte => byte === 0)).toBe(true); expect(encrypted!.every(byte => byte === 0)).toBe(true); }
  });
  it.each([
    ['grant revocation', (setup: ReturnType<typeof netFixture>) => setup.access.assert.mockRejectedValueOnce(new ForbiddenException())],
    ['formal flag revocation', (setup: ReturnType<typeof netFixture>) => setup.access.assertDomain.mockRejectedValueOnce(new ForbiddenException())],
    ['optimistic version', (setup: ReturnType<typeof netFixture>) => { setup.batch.version++; }],
    ['approved version replacement', (setup: ReturnType<typeof netFixture>) => { setup.version.id = 'replacement'; }],
    ['source hash', (setup: ReturnType<typeof netFixture>) => { setup.version.sourceHash = 'c'.repeat(64); }],
    ['net snapshot hash', (setup: ReturnType<typeof netFixture>) => { setup.version.netSnapshot.sourceHash = 'c'.repeat(64); }],
    ['rehashed snapshot replacement', (setup: ReturnType<typeof netFixture>) => { setup.version.netSnapshot.rows[0].employeeName = '另一虚构姓名'; sealNet(setup.version.netSnapshot); }],
    ['changed actual ledger', (setup: ReturnType<typeof netFixture>) => setup.payments.findFirst.mockImplementation(async () => ({
      snapshot: setup.version.netSnapshot.rows[0], payDate: setup.version.payDate, gross: new Prisma.Decimal('17501'), socialInsurance: new Prisma.Decimal('1000'),
      housingFund: new Prisma.Decimal('500'), incomeTax: new Prisma.Decimal('200'), net: new Prisma.Decimal('15800'),
    }))],
  ])('revalidates and clears both buffers after encryption: %s', async (_name, change) => {
    const setup = netFixture(); let encrypted: Buffer | undefined, plain: Buffer | undefined;
    if (_name === 'formal flag revocation') { setup.batch.purpose = 'formal'; setup.version.netSnapshot.domain = 'formal'; sealNet(setup.version.netSnapshot); }
    setup.crypto.encryptWorkbook.mockImplementation(async buffer => { plain = buffer; encrypted = Buffer.from(buffer); (change as (setup: ReturnType<typeof netFixture>) => void)(setup); return encrypted; });
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: 'fictional-file-password' }, actor)).rejects.toThrow(
      ['grant revocation', 'formal flag revocation'].includes(_name as string) ? ForbiddenException : ConflictException);
    expect(plain!.every(byte => byte === 0)).toBe(true); expect(encrypted!.every(byte => byte === 0)).toBe(true);
    expect(setup.tx.payrollExportRecord.create).not.toHaveBeenCalled(); expect(setup.tx.payrollEvent.create).not.toHaveBeenCalled();
    expect(setup.payments.create).not.toHaveBeenCalled(); expect(setup.tx.payrollSettlement.create).not.toHaveBeenCalled();
  });
  it('clears the plaintext buffer even if encryption fails', async () => {
    const setup = netFixture(); let plain: Buffer | undefined;
    setup.crypto.encryptWorkbook.mockImplementation(async buffer => { plain = buffer; throw new Error('encryption failed'); });
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: 'fictional-file-password' }, actor)).rejects.toThrow('encryption failed');
    expect(plain!.every(byte => byte === 0)).toBe(true); expect(setup.tx.payrollExportRecord.create).not.toHaveBeenCalled();
  });
  it.each([false, true])('keeps employee-level net/gross allocation consistent even when global totals match, swap=%s', async swap => {
    const setup = netFixture(), snapshot = setup.version.netSnapshot;
    setup.version.lines.push(...setup.version.lines.map(line => ({ ...line, id: `${line.id}-second`, employeeId: 'second',
      evidence: { ...line.evidence, employeeName: '虚构核算乙', employeeNo: 'PAY_SECOND' }, amount: new Prisma.Decimal(line.itemCode === 'fixed' ? '10000' : '0') })));
    setup.version.gross = new Prisma.Decimal('27500');
    snapshot.rows.push({ ...structuredClone(snapshot.rows[0]), employeeId: 'second', employeeName: '虚构核算乙', employeeNo: 'PAY_SECOND', result: {
      ...snapshot.rows[0].result, gross: '10000.00', socialInsurance: '500.00', housingFund: '250.00', incomeTax: '100.00', net: '9150.00',
    } });
    snapshot.totals = { gross: '27500.00', socialInsurance: '1500.00', housingFund: '750.00', incomeTax: '300.00', net: '24950.00' };
    if (swap) {
      snapshot.rows[0].result.gross = '17499.00'; snapshot.rows[0].result.net = '15799.00';
      snapshot.rows[1].result.gross = '10001.00'; snapshot.rows[1].result.net = '9151.00';
    }
    sealNet(snapshot);
    const download = setup.service.download('batch', { expectedVersion: 4, filePassword: 'fictional-file-password' }, actor);
    if (swap) { await expect(download).rejects.toThrow(ConflictException); expect(setup.crypto.encryptWorkbook).not.toHaveBeenCalled(); }
    else {
      const sheet = (await readWorkbook(await download)).getWorksheet('工资实发')!;
      expect([sheet.getCell('C3').value, sheet.getCell('C4').value]).toEqual(['虚构核算甲', '虚构核算乙']);
      expect(['F5', 'G5', 'H5', 'I5', 'J5'].map(cell => sheet.getCell(cell).value)).toEqual([27500, 1500, 750, 300, 24950]);
    }
  });
  it.each(['missing', 'duplicate'])('requires all five items per attribution month even for zero-value %s items', async change => {
    const setup = netFixture();
    if (change === 'missing') setup.version.lines.pop();
    else setup.version.lines[4].itemCode = 'performance';
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: 'fictional-file-password' }, actor)).rejects.toThrow(ConflictException);
    expect(setup.crypto.encryptWorkbook).not.toHaveBeenCalled();
  });
  it('applies the Excel exact-numeric guard to approved net amounts too', async () => {
    const setup = netFixture(), snapshot = setup.version.netSnapshot;
    setup.version.lines.forEach(line => { line.amount = new Prisma.Decimal(line.itemCode === 'fixed' ? '70368744177664.01' : '0'); });
    setup.version.gross = new Prisma.Decimal('70368744177664.01');
    const amounts = { gross: '70368744177664.01', socialInsurance: '0.00', housingFund: '0.00', incomeTax: '0.00', net: '70368744177664.01' };
    Object.assign(snapshot.rows[0].result, amounts); snapshot.totals = { ...amounts }; sealNet(snapshot);
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: 'fictional-file-password' }, actor)).rejects.toThrow('Excel');
    expect(setup.crypto.encryptWorkbook).not.toHaveBeenCalled();
  });
  it('uses calculation version1 with optimistic token4 and encrypts an independently checked final workbook', async () => {
    const setup = fixture(), password = randomBytes(12).toString('hex');
    const cipher = new RosterSensitiveExportService({} as any, {} as any);
    setup.crypto.encryptWorkbook.mockImplementation((plain, filePassword) => cipher.encryptWorkbook(plain, filePassword));
    const file = await setup.service.download('batch', { expectedVersion: 4, filePassword: password }, actor);
    const chunks: Buffer[] = []; for await (const chunk of file.getStream()) chunks.push(Buffer.from(chunk));
    const encrypted = Buffer.concat(chunks);
    expect(encrypted.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1');
    const plain = await officeCrypto.decrypt(encrypted, { password });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(plain as any);
    const sheet = workbook.getWorksheet('税前应发')!;
    expect(sheet.getCell('A1').value).toBe('测试环境');
    expect(['F3', 'G3', 'H3', 'I3', 'J3', 'K3'].map(cell => sheet.getCell(cell).value)).toEqual([17400, -200, 300, 0, 0, 17500]);
    expect(sheet.getCell('M3').value).toBe(1);
    expect(setup.tx.payrollExportRecord.create).toHaveBeenCalledTimes(1); expect(setup.tx.payrollSettlement.create).not.toHaveBeenCalled();
    expect(JSON.stringify(setup.tx.payrollEvent.create.mock.calls)).not.toContain(password);
    expect(JSON.stringify(setup.tx.payrollEvent.create.mock.calls)).not.toContain('17400');
    expect(file.getHeaders().disposition).toContain('v1.xlsx');
  }, 30000);
  it.each(['trial', 'formal'])('rejects non-validation channel %s before encryption', async purpose => {
    const setup = fixture(); setup.batch.purpose = purpose;
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: randomBytes(8).toString('hex') }, actor)).rejects.toThrow(ForbiddenException);
    expect(setup.crypto.encryptWorkbook).not.toHaveBeenCalled();
  });
  it.each(['draft', 'calculated', 'pending', 'returned', 'voided'])('rejects incomplete/invalid state %s', async status => {
    const setup = fixture(); setup.batch.status = status;
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: randomBytes(8).toString('hex') }, actor)).rejects.toThrow(ConflictException);
    expect(setup.crypto.encryptWorkbook).not.toHaveBeenCalled();
  });
  it('does not manufacture missing approved items as zero or trust status without every decision', async () => {
    const setup = fixture(); setup.version.lines.pop();
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: randomBytes(8).toString('hex') }, actor)).rejects.toThrow(ConflictException);
    setup.version.decisions.pop();
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: randomBytes(8).toString('hex') }, actor)).rejects.toThrow(ConflictException);
    expect(setup.crypto.encryptWorkbook).not.toHaveBeenCalled();
  });
  it('rechecks grants and effective version after encryption, not only before a slow worker', async () => {
    const setup = fixture();
    setup.crypto.encryptWorkbook.mockImplementation(async plain => {
      setup.access.assert.mockRejectedValueOnce(new ForbiddenException());
      return Buffer.from(plain);
    });
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: randomBytes(8).toString('hex') }, actor)).rejects.toThrow(ForbiddenException);
    expect(setup.crypto.encryptWorkbook).toHaveBeenCalledTimes(1);
    expect(setup.tx.payrollExportRecord.create).not.toHaveBeenCalled();
  });
  it('does not re-export an arrangement whose unpaid remainder was cancelled', async () => {
    const setup = fixture(); setup.tx.payrollEvent.findFirst.mockResolvedValue({ id: 'cancelled' } as any);
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: randomBytes(8).toString('hex') }, actor)).rejects.toThrow(ConflictException);
    expect(setup.crypto.encryptWorkbook).not.toHaveBeenCalled();
  });
  it.each(['70368744177664.01', '-70368744177664.01'])('rejects money that loses cents through Excel numeric delivery: %s', async amount => {
    const setup = fixture(); setup.version.lines[0].amount = new Prisma.Decimal(amount);
    setup.version.gross = setup.version.lines.reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0));
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: randomBytes(8).toString('hex') }, actor)).rejects.toThrow(ConflictException);
    expect(setup.crypto.encryptWorkbook).not.toHaveBeenCalled();
  });
  it('refuses to export a total different from the approved version', async () => {
    const setup = fixture(); setup.version.gross = new Prisma.Decimal('1');
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: randomBytes(8).toString('hex') }, actor)).rejects.toThrow(ConflictException);
  });

  it.each([false, true])('rechecks cross-month attendance ownership before returning a file, lateConflict=%s', async lateConflict => {
    const setup = fixture(), others: any[] = [];
    (setup.version as any).sources = { months: [{ month: '2026-11', sources: { attendance: {
      payload: { days: [{ records: [{ sourceId: 'night' }] }] },
    } } }] };
    (setup.tx as any).payrollAttendanceSnapshot = { findMany: jest.fn(async () => others) };
    const conflict = { month: '2026-12', version: 1, sourceHash: 'moved', payload: { days: [{ records: [{ sourceId: 'night' }] }] } };
    if (lateConflict) setup.crypto.encryptWorkbook.mockImplementation(async plain => { others.push(conflict); return Buffer.from(plain); });
    else others.push(conflict);
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: 'fictional-file-password' }, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(setup.tx.payrollExportRecord.create).not.toHaveBeenCalled();
    expect(setup.tx.payrollSettlement.create).not.toHaveBeenCalled();
    expect(setup.crypto.encryptWorkbook).toHaveBeenCalledTimes(lateConflict ? 1 : 0);
  });
});
