import { Prisma } from '@prisma/client';
import { PayrollSourcesService } from './payroll-sources.service';
import { payrollDays } from './payroll-data.service';

describe('payroll source capture', () => {
  const month = '2026-11', subjectId = 'subject', employeeId = 'employee';
  function fixture() {
    const days = payrollDays(month).map((workDate, index) => ({ employeeId, workDate, units: index < 20 ? '1' : '0', required: index < 20, issues: [], records: index === 0 ? [
      { type: 'unpaid_leave', state: 'effective', hours: '2', effectiveHours: '2', resolution: 'usable', unit: 'hour' },
      { type: 'overtime', state: 'effective', hours: '2', effectiveHours: '2', resolution: 'usable', unit: 'hour', overtimeKind: 'weekday' },
    ] : [] }));
    const config = { rounding: 'item_half_up', monthlyUnits: { [month]: '20' }, cutoverMonth: month,
      normalHourly: '100', paidHourly: { unpaid_leave: '0' }, overtime: { hourlyBase: '100', weekday: '1.5' },
      reviewers: ['reviewer'], approvers: ['approver'], performance: {} };
    const data = {
      attendance: { id: 'attendance', month, status: 'sealed', sealedHash: 'sealed', payload: { days, issues: [], sync: { complete: true } } },
      policies: [{ id: 'policy', config, effectiveFrom: new Date('2026-01-01'), effectiveTo: null }],
      standards: [{ id: 'standard', employeeId, effectiveFrom: new Date('2026-01-01'), effectiveTo: null,
        fixedMonthly: new Prisma.Decimal('17400'), performanceBase: null, performanceMode: 'none' }],
      employments: [{ id: 'employment', userId: employeeId, contractSubjectId: subjectId,
        effectiveFrom: new Date('2026-01-01'), effectiveTo: null, employeeStatus: 'active', entryDate: null, leaveDate: null,
        employeeNo: 'PAY_HISTORICAL',
        user: { id: employeeId, name: '虚构核算人员', employeeNo: 'PAY_FIXTURE' } }],
      openings: ['fixed', 'absence', 'overtime', 'performance', 'adjustment'].map(itemCode => ({ id: `opening-${itemCode}`, employeeId, itemCode, amount: new Prisma.Decimal(0), confirmedAt: new Date('2026-01-01'), confirmedById: 'finance', reference: 'Fictional opening verification' })),
      settlements: [] as any[], adjustments: [] as any[],
    };
    const tx = {
      payrollAttendanceSnapshot: { findFirst: jest.fn(async () => data.attendance) },
      payrollPolicy: { findMany: jest.fn(async () => data.policies) },
      payrollStandard: { findMany: jest.fn(async () => data.standards) },
      employmentRecord: { findMany: jest.fn(async () => data.employments) },
      payrollOpeningBalance: { findMany: jest.fn(async () => data.openings) },
      payrollSettlement: { findMany: jest.fn(async () => data.settlements) },
      payrollAdjustment: { findMany: jest.fn(async () => data.adjustments) },
    };
    return { data, capture: () => new PayrollSourcesService().capture(tx as any, subjectId, month, 'validation') };
  }
  it('uses the sealed source and exact money, preserving each obligation', async () => {
    const { capture } = fixture(), result = await capture();
    expect(result.issues).toEqual([]); expect(result.gross).toBe('17500.00');
    expect(result.lines.map(row => [row.itemCode, row.amount])).toEqual([
      ['fixed', '17400.00'], ['absence', '-200.00'], ['overtime', '300.00'], ['performance', '0.00'], ['adjustment', '0.00'],
    ]);
    expect((await capture()).sourceHash).toBe(result.sourceHash);
  });
  it('does not infer missing opening amounts as zero', async () => {
    const { data, capture } = fixture(); data.openings = [];
    const result = await capture(); expect(result.gross).toBeNull();
    expect(result.issues.join()).toContain('期初'); expect(result.lines.every(row => row.amount === null)).toBe(true);
  });
  it('does not price an alleged sealed snapshot without query completion evidence', async () => {
    const { data, capture } = fixture(); data.attendance.payload.sync.complete = false;
    expect((await capture()).gross).toBeNull();
  });
  it.each(['confirmedById', 'reference'])('requires opening confirmation evidence: %s', async field => {
    const { data, capture } = fixture(); (data.openings[0] as any)[field] = '';
    expect((await capture()).gross).toBeNull();
  });
  it('new unsealed attendance invalidates the fingerprint and blocks approval', async () => {
    const { data, capture } = fixture(), before = await capture(); data.attendance.status = 'draft';
    const after = await capture(); expect(after.gross).toBeNull(); expect(after.sourceHash).not.toBe(before.sourceHash);
  });
  it('net delta counts actual settlements, never export counts', async () => {
    const { data, capture } = fixture();
    data.settlements = [{ id: 'actual-payment', amount: new Prisma.Decimal('150'), line: { employeeId, itemCode: 'fixed' } }];
    const result = await capture(); expect(result.lines[0].paidBefore).toBe('150.00'); expect(result.lines[0].amount).toBe('17250.00');
  });
  it('persistent authorized adjustments do not disappear after an earlier batch', async () => {
    const { data, capture } = fixture(); data.adjustments = [{ id: 'adjustment', employeeId, itemCode: 'fixed', amount: new Prisma.Decimal('50') }];
    data.settlements = [{ id: 'paid-adjusted', amount: new Prisma.Decimal('17450'), line: { employeeId, itemCode: 'fixed' } }];
    const result = await capture(); expect(result.lines[0].entitlement).toBe('17450.00'); expect(result.lines[0].amount).toBe('0.00');
  });
  it('explicit monthly divisor is required instead of defaulting to days or21.75', async () => {
    const { data, capture } = fixture(); data.policies[0].config.monthlyUnits = {} as any;
    expect((await capture()).gross).toBeNull();
  });
  it('does not price duplicate or superseded source hours', async () => {
    const { data, capture } = fixture();
    const original = data.attendance.payload.days[0].records[0];
    data.attendance.payload.days[0].records.push({ ...original, resolution: 'covered', effectiveHours: '0' });
    expect((await capture()).lines.find(row => row.itemCode === 'absence')?.amount).toBe('-200.00');
  });
  it('does not expose another subject employment but still blocks overlaps', async () => {
    const { data, capture } = fixture();
    data.employments.push({ ...data.employments[0], id: 'foreign-history', contractSubjectId: 'foreign-subject', employeeNo: 'FOREIGN_SECRET' });
    const result = await capture();
    expect(result.gross).toBeNull();
    expect(result.issues.join()).toContain('任职时间重叠');
    expect(JSON.stringify(result.sources)).not.toContain('foreign-subject');
    expect(JSON.stringify(result.sources)).not.toContain('FOREIGN_SECRET');
  });
  it('freezes the historical employment number rather than the current login number', async () => {
    const result = await fixture().capture();
    expect((result.lines[0].evidence as any).employeeNo).toBe('PAY_HISTORICAL');
  });
});
