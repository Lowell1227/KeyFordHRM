import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import * as officeCrypto from 'officecrypto-tool';
import { randomBytes } from 'node:crypto';
import { PayrollExportService } from './payroll-export.service';
import { RosterSensitiveExportService } from '@/users/roster-sensitive-export.service';

describe('locked payroll export', () => {
  function fixture() {
    const batch = { id: 'batch', subjectId: 'subject', purpose: 'validation', status: 'approved', version: 4, month: '2026-11', payMonth: '2026-12' };
    const version = { id: 'calculation', version: 1, status: 'approved', gross: new Prisma.Decimal('17500'), approvedAt: new Date('2026-11-01T00:00:00Z'), voidedAt: null, issues: [],
      approvalStep: 2, approvalPath: ['reviewer', 'approver'], reviewerCount: 1,
      decisions: [{ step: 0, actorId: 'reviewer', action: 'approve' }, { step: 1, actorId: 'approver', action: 'approve' }],
      lines: ['fixed', 'absence', 'overtime', 'performance', 'adjustment'].map((itemCode, index) => ({ id: itemCode, employeeId: 'employee', attributionMonth: '2026-11', itemCode,
        amount: new Prisma.Decimal(['17400', '-200', '300', '0', '0'][index]), status: 'ready', evidence: { employeeName: '虚构核算甲', employeeNo: 'PAY_TEST' } })) };
    const tx = { payrollBatch: { findUnique: jest.fn(async () => batch) }, payrollVersion: { findFirst: jest.fn(async () => version) },
      payrollEvent: { create: jest.fn(async () => ({})), findFirst: jest.fn(async () => null) },
      payrollExportRecord: { create: jest.fn(async () => ({})) }, contractSubject: { findUniqueOrThrow: jest.fn(async () => ({ name: '虚构薪酬主体' })) },
      $queryRaw: jest.fn(async () => []), payrollSettlement: { create: jest.fn() } };
    const prisma = { $transaction: async (work: (tx: any) => any) => work(tx) };
    const access = { assert: jest.fn(async () => undefined), assertDomain: jest.fn(async () => 'validation') };
    const crypto = { encryptWorkbook: jest.fn<Promise<Buffer>, [Buffer, string]>(async plain => Buffer.from(plain)) };
    return { batch, version, tx, access, crypto, service: new PayrollExportService(prisma as any, access as any, crypto as any) };
  }
  const actor = { id: 'exporter', sysRole: 'employee' } as any;
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
    setup.access.assert.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ForbiddenException());
    await expect(setup.service.download('batch', { expectedVersion: 4, filePassword: randomBytes(8).toString('hex') }, actor)).rejects.toThrow(ForbiddenException);
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
});
