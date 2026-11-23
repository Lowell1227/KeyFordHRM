import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertPayrollNetLines, assertPayrollNetShape, netSnapshotHash } from './payroll-net';

function reconciliationFixture(paid = '1000.00') {
  const gross = new Prisma.Decimal('1000.00');
  const lines = ['fixed', 'absence', 'overtime', 'performance', 'adjustment'].map(itemCode => ({
    employeeId: 'fictional-employee', attributionMonth: '2026-10', itemCode,
    entitlement: itemCode === 'fixed' ? gross : new Prisma.Decimal(0),
    paidBefore: new Prisma.Decimal(itemCode === 'fixed' ? paid : 0),
    amount: itemCode === 'fixed' ? gross.minus(paid) : new Prisma.Decimal(0),
  }));
  const body = { schema: 1, subjectId: 'fictional-subject', domain: 'formal', payDate: '2026-11-10',
    rows: [{ employeeId: 'fictional-employee', employeeName: 'Fictional employee', employeeNo: 'FICTIONAL-1',
      result: { status: 'ready', issues: [], gross: '1000.00', socialInsurance: '100.00', housingFund: '100.00', incomeTax: '80.00', net: '720.00',
        evidence: { parameter: { id: 'fictional-reviewed-profile' } } }, ledger: {} }],
    totals: { gross: '1000.00', socialInsurance: '100.00', housingFund: '100.00', incomeTax: '80.00', net: '720.00' } };
  return { lines, gross, snapshot: { ...body, sourceHash: netSnapshotHash(body) } };
}

describe('immutable net approval snapshot', () => {
  it('hashes JSONB without depending on object key order', () => {
    expect(netSnapshotHash({ b: { y: 2, x: 1 }, a: 0 })).toBe(netSnapshotHash({ a: 0, b: { x: 1, y: 2 } }));
  });
  it('rejects absent, partial and modified snapshots rather than approving gross as net', () => {
    for (const value of [null, {}, { schema: 1, rows: [], totals: null }]) {
      expect(() => assertPayrollNetShape(value)).toThrow(ConflictException);
    }
  });
  it.each(['1000.00', '400.00'])('validates full historical reconciliation while retaining %s paid before and each remaining balance', paid => {
    const f = reconciliationFixture(paid), before = JSON.stringify(f);
    expect(() => assertPayrollNetLines(f.snapshot, f.lines, f.gross, 'reconciliation')).not.toThrow();
    expect(JSON.stringify(f)).toBe(before);
    expect(() => assertPayrollNetLines(f.snapshot, f.lines, f.gross)).toThrow(ConflictException);
  });
  it.each(['equation', 'missing-paid', 'missing-entitlement', 'duplicate', 'summary'])('rejects invalid historical reconciliation %s instead of weakening the original balance equation', fault => {
    const f = reconciliationFixture('400.00');
    if (fault === 'equation') f.lines[0].amount = new Prisma.Decimal('599.00');
    if (fault === 'missing-paid') f.lines[0].paidBefore = null as any;
    if (fault === 'missing-entitlement') f.lines[0].entitlement = null as any;
    if (fault === 'duplicate') f.lines.push({ ...f.lines[0] });
    if (fault === 'summary') f.gross = new Prisma.Decimal('600.00');
    expect(() => assertPayrollNetLines(f.snapshot, f.lines, f.gross, 'reconciliation')).toThrow(ConflictException);
  });
});
