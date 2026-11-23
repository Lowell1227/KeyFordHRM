import { Prisma } from '@prisma/client';
import { PayrollSourcesService } from './payroll-sources.service';
import { payrollDays } from './payroll-data.service';
import { payrollHash } from './payroll-transaction';
import { payrollParameterDefinition } from './payroll-parameter-definition';
import { convertDingtalkAttendance } from './payroll-dingtalk-attendance';
import { normalizeAttendance } from './payroll-attendance-normalizer';
import type { DingtalkAttendanceRead } from '@/dingtalk/dingtalk-attendance.service';

describe('payroll source capture', () => {
  const month = '2026-11', subjectId = 'subject', employeeId = '00000000-0000-4000-8000-000000000001';
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
      policies: [{ id: 'policy', config, effectiveFrom: new Date('2026-01-01'), effectiveTo: null as Date | null }],
      standards: [{ id: 'standard', employeeId, effectiveFrom: new Date('2026-01-01'), effectiveTo: null,
        fixedMonthly: new Prisma.Decimal('17400'), performanceBase: null, performanceMode: 'none' }],
      employments: [{ id: 'employment', userId: employeeId, contractSubjectId: subjectId,
        effectiveFrom: new Date('2026-01-01'), effectiveTo: null, employeeStatus: 'active', entryDate: null, leaveDate: null,
        employeeNo: 'PAY_HISTORICAL',
        user: { id: employeeId, name: '虚构核算人员', employeeNo: 'PAY_FIXTURE' } }],
      openings: ['fixed', 'absence', 'overtime', 'performance', 'adjustment'].map(itemCode => ({ id: `opening-${itemCode}`, employeeId, itemCode, amount: new Prisma.Decimal(0), confirmedAt: new Date('2026-01-01'), confirmedById: 'finance', reference: 'Fictional opening verification' })),
      settlements: [] as any[], adjustments: [] as any[],
      otherAttendance: [] as any[], releases: [] as any[],
    };
    const tx = {
      payrollAttendanceSnapshot: { findFirst: jest.fn(async () => data.attendance), findMany: jest.fn(async () => data.otherAttendance) },
      payrollPolicy: { findMany: jest.fn(async () => data.policies) },
      payrollStandard: { findMany: jest.fn(async () => data.standards) },
      employmentRecord: { findMany: jest.fn(async () => data.employments) },
      payrollOpeningBalance: { findMany: jest.fn(async () => data.openings) },
      payrollSettlement: { findMany: jest.fn(async () => data.settlements) },
      payrollAdjustment: { findMany: jest.fn(async () => data.adjustments) },
      payrollParameterRelease: { findMany: jest.fn(async () => data.releases) },
    };
    return { data, tx, capture: (domain: 'validation' | 'formal' = 'validation') => new PayrollSourcesService().capture(tx as any, subjectId, month, domain) };
  }
  function workdayFixture() {
    const value = fixture();
    Object.assign(value.data.policies[0].config, { fixedSalaryBasis: 'monthly_workdays', workCalendars: { [month]: {
      sourceVersion: 'fictional-v1', evidenceRef: 'Fictional full-month calendar',
      days: value.data.attendance.payload.days.map(({ workDate, units }) => ({ workDate, units })),
    } } });
    return value;
  }
  function manualFixture() {
    const value = workdayFixture();
    Object.assign(value.data.standards[0], { performanceMode: 'additional', performanceBase: null });
    value.data.policies[0].config.performance = { [month]: { sourceKind: 'manual', manualAmounts: { [employeeId]: '1234.56' }, evidenceRef: 'Fictional HR confirmation', cycleIds: [], coefficients: {} } } as any;
    return value;
  }
  function formalFixture<T extends ReturnType<typeof fixture>>(value: T): T {
    const policy = value.data.policies[0];
    Object.assign(policy, { subjectId, domain: 'formal', status: 'active', version: 1 });
    Object.assign(policy.config, { employeeScope: { employeeIds: [employeeId], evidenceRef: 'Fictional actual payer assignment' } });
    value.data.releases.push({ id: 'rule-release', ruleId: policy.id, standardId: null, previousParameterId: null, parameterVersion: 1,
      snapshotHash: payrollHash(payrollParameterDefinition('rule', policy as any)) });
    return value;
  }
  it.each([
    { minutes: 1, absence: '-205.76', gross: '17194.24' },
    { minutes: 5, absence: '-1028.81', gross: '16371.19' },
    { minutes: 10, absence: '-2057.61', gross: '15342.39' },
  ])('calculates a verified $minutes-minute lateness through adapter, normalization and formal sources without rounding hours', async expected => {
    const { minutes } = expected;
    const value = formalFixture(workdayFixture()), workDate = `${month}-01`;
    const at = (time: string) => `${workDate}T${time}:00+08:00`;
    const lateAt = at(`09:${String(minutes).padStart(2, '0')}`);
    const read: DingtalkAttendanceRead = {
      month, organizationKey: 'fictional-organization', scope: { employeeIds: [employeeId], from: workDate, to: workDate },
      complete: true, pending: [], days: [{ employeeId, workDate, complete: true, restsKnown: true,
        rests: [{ startsAt: at('12:00'), endsAt: at('13:00') }], approvals: [],
        schedule: [
          { id: '1', classId: 'fictional-class', workDate, checkType: 'OnDuty', plannedAt: at('09:00'), isRest: false, approvalLinked: false },
          { id: '2', classId: 'fictional-class', workDate, checkType: 'OffDuty', plannedAt: at('18:00'), isRest: false, approvalLinked: false },
        ], punches: [
          { id: 'p1', planId: '1', workDate, checkType: 'OnDuty', plannedAt: at('09:00'), checkedAt: lateAt, result: 'Late', location: 'Normal', approvalLinked: false },
          { id: 'p2', planId: '2', workDate, checkType: 'OffDuty', plannedAt: at('18:00'), checkedAt: at('18:00'), result: 'Normal', location: 'Normal', approvalLinked: false },
        ] }],
    };
    const converted = convertDingtalkAttendance(read, { expected: [{ employeeId, workDate, units: '1', required: true }],
      observationVersion: 1, previous: [], approvalMappings: {} });
    expect(converted.complete).toBe(true);
    const normalized = normalizeAttendance(converted.input);
    expect(normalized.issues).toEqual([]);
    Object.assign(value.data.attendance.payload.days[0], normalized.days[0]);
    value.data.policies[0].config.normalHourly = '12345.67';
    (value.data.policies[0].config.paidHourly as any).late = '0';
    value.data.releases[0].snapshotHash = payrollHash(payrollParameterDefinition('rule', value.data.policies[0] as any));
    const before = JSON.stringify(value.data), result = await value.capture('formal');
    expect(result.issues).toEqual([]);
    expect(result.lines.find(row => row.itemCode === 'absence')?.amount).toBe(expected.absence);
    expect(result.gross).toBe(expected.gross);
    expect(JSON.stringify(value.data)).toBe(before);
  });
  it('does not relax four-decimal pricing configuration when accepting precise attendance durations', async () => {
    const value = formalFixture(workdayFixture());
    value.data.policies[0].config.normalHourly = '100.12345';
    value.data.releases[0].snapshotHash = payrollHash(payrollParameterDefinition('rule', value.data.policies[0] as any));
    const result = await value.capture('formal');
    expect(result.gross).toBeNull();
    expect(result.issues.join()).toContain('单位价');
  });
  it.each(['late', 'early'])('keeps verified %s hours unconfigured until hourly treatment is explicitly approved', async type => {
    const value = workdayFixture();
    value.data.attendance.payload.days[0].records = [{ type, state: 'effective', hours: '0.5', effectiveHours: '0.5', resolution: 'usable', unit: 'hour' }];
    const pending = await value.capture();
    expect(pending.gross).toBeNull(); expect(pending.issues.join()).toContain('待遇');
    (value.data.policies[0].config.paidHourly as any)[type] = '0';
    const resolved = await value.capture();
    expect(resolved.issues).toEqual([]);
    expect(resolved.lines.find(row => row.itemCode === 'absence')?.amount).toBe('-50.00');
    expect(resolved.gross).toBe('17350.00');
    (value.data.policies[0].config.paidHourly as any)[type] = '100';
    const paid = await value.capture();
    expect(paid.issues).toEqual([]); expect(paid.lines.find(row => row.itemCode === 'absence')?.amount).toBe('0.00');
  });
  it('selects a reviewed actual payer scope across contract subjects without changing employment history', async () => {
    const value = formalFixture(workdayFixture()); value.data.employments[0].contractSubjectId = 'different-contract';
    const before = JSON.stringify(value.data.employments), result = await value.capture('formal');
    expect(result.issues).toEqual([]); expect(result.gross).toBe('17500.00');
    expect((result.sources as any).employments[0]).toMatchObject({ contractSubjectId: 'different-contract', payrollAssignment: { subjectId } });
    expect(JSON.stringify(value.data.employments)).toBe(before);
  });
  it('leaves formal payroll unconfigured without a reviewed payer scope, despite existing contracts', async () => {
    const value = workdayFixture(), result = await value.capture('formal');
    expect(result.gross).toBeNull(); expect(result.issues.join()).toContain('正式发薪人员范围待配置');
    expect(result.lines).toEqual([]);
  });
  it('freezes scope in the source hash and invalidates an in-review source after a reviewed assignment changes', async () => {
    const value = formalFixture(workdayFixture()), before = await value.capture('formal'), frozen = JSON.stringify(before.sources);
    (value.data.policies[0].config as any).employeeScope.employeeIds = ['00000000-0000-4000-8000-000000000002'];
    value.data.releases[0].snapshotHash = payrollHash(payrollParameterDefinition('rule', value.data.policies[0] as any));
    const after = await value.capture('formal');
    expect(after.sourceHash).not.toBe(before.sourceHash); expect(after.gross).toBeNull(); expect(JSON.stringify(before.sources)).toBe(frozen);
  });
  it('intersects payer effective dates with HRM employment dates without prorating manual performance', async () => {
    const value = formalFixture(manualFixture()); value.data.policies[0].effectiveFrom = new Date('2026-11-11');
    value.data.releases[0].snapshotHash = payrollHash(payrollParameterDefinition('rule', value.data.policies[0] as any));
    const result = await value.capture('formal');
    expect(result.issues).toEqual([]);
    expect(result.lines.find(row => row.itemCode === 'fixed')?.amount).toBe('8700.00');
    expect(result.lines.find(row => row.itemCode === 'performance')?.amount).toBe('1234.56');
  });
  it.each(['validation', 'formal'] as const)('manual wages are counted once, without reading performance in %s', async domain => {
    const value = manualFixture(); if (domain === 'formal') formalFixture(value);
    const { capture, tx } = value;
    const task = jest.fn(() => { throw new Error('Manual wages must not read performance'); });
    Object.assign(tx, { assessmentTask: { findUnique: task } });
    const result = await capture(domain);
    expect(result.issues).toEqual([]);
    expect(result.lines.find(row => row.itemCode === 'performance')?.amount).toBe('1234.56');
    expect(result.gross).toBe('18734.56');
    expect((result.sources as any).manualPerformance[0]).toMatchObject({ employeeId, month, entries: [{ policyId: 'policy', amount: '1234.56', evidenceRef: 'Fictional HR confirmation' }] });
    expect(task).not.toHaveBeenCalled();
  });
  it('does not prorate manually confirmed performance for a mid-month hire', async () => {
    const { data, capture } = manualFixture();
    data.employments[0].effectiveFrom = new Date('2026-11-11');
    data.attendance.payload.days = data.attendance.payload.days.slice(10);
    const result = await capture();
    expect(result.issues).toEqual([]);
    expect(result.lines.find(row => row.itemCode === 'fixed')?.amount).toBe('8700.00');
    expect(result.lines.find(row => row.itemCode === 'performance')?.amount).toBe('1234.56');
  });
  it('manual zero is explicit; missing amount or basis blocks, without fallback to old base', async () => {
    const { data, capture } = manualFixture();
    const mapping = data.policies[0].config.performance[month] as any;
    mapping.manualAmounts[employeeId] = '0.00';
    expect((await capture()).lines.find(row => row.itemCode === 'performance')?.amount).toBe('0.00');
    delete mapping.manualAmounts[employeeId];
    expect((await capture()).gross).toBeNull();
    mapping.manualAmounts[employeeId] = '1234.56'; mapping.evidenceRef = '';
    expect((await capture()).gross).toBeNull();
  });
  it('manual input changes affect fingerprints and do not mutate previous snapshots', async () => {
    const { data, capture } = manualFixture(); const before = await capture();
    const frozen = JSON.stringify(before.sources);
    (data.policies[0].config.performance[month] as any).manualAmounts[employeeId] = '1300';
    const after = await capture();
    expect(after.sourceHash).not.toBe(before.sourceHash);
    expect(after.lines.find(row => row.itemCode === 'performance')?.amount).toBe('1300.00');
    expect(JSON.stringify(before.sources)).toBe(frozen);
  });
  it('a prior actual manual payment is deducted once rather than added again in a correction', async () => {
    const { data, capture } = manualFixture();
    data.settlements.push({ id: 'prior-manual-payment', amount: new Prisma.Decimal('1000'), line: { employeeId, itemCode: 'performance' } });
    const result = await capture();
    expect(result.lines.find(row => row.itemCode === 'performance')).toMatchObject({ entitlement: '1234.56', paidBefore: '1000.00', amount: '234.56' });
  });
  it('conflicting manual rules within the same month block instead of adding or prorating the values', async () => {
    const { data, capture } = manualFixture();
    data.policies[0].effectiveTo = new Date('2026-11-15');
    const config = JSON.parse(JSON.stringify(data.policies[0].config));
    config.performance[month].manualAmounts[employeeId] = '2000.00';
    data.policies.push({ ...data.policies[0], id: 'second', effectiveFrom: new Date('2026-11-16'), effectiveTo: null, config });
    const result = await capture();
    expect(result.gross).toBeNull(); expect(result.issues.join()).toContain('人工绩效金额');
    expect(result.lines.every(row => row.amount === null)).toBe(true);
  });
  it('uses full-month workdays for a mid-month hire, with absence deducted only once', async () => {
    const { data, capture } = workdayFixture(); data.employments[0].effectiveFrom = new Date('2026-11-11');
    data.attendance.payload.days = data.attendance.payload.days.slice(10);
    data.attendance.payload.days[0].records = [{ type: 'unpaid_leave', state: 'effective', hours: '2', effectiveHours: '2', resolution: 'usable', unit: 'hour' }];
    const result = await capture();
    expect(result.issues).toEqual([]);
    expect(result.lines.find(row => row.itemCode === 'fixed')?.amount).toBe('8700.00');
    expect(result.lines.find(row => row.itemCode === 'absence')?.amount).toBe('-200.00');
    expect(result.gross).toBe('8500.00');
  });
  it('does not accept an employed-window divisor, incomplete calendar or attendance unit reduction', async () => {
    const { data, capture } = workdayFixture();
    data.policies[0].config.monthlyUnits[month] = '10';
    expect((await capture()).issues.join()).toContain('完整月');
    data.policies[0].config.monthlyUnits[month] = '20';
    data.attendance.payload.days[0].units = '0';
    expect((await capture()).issues.join()).toContain('日历');
    data.attendance.payload.days[0].units = '1';
    (data.policies[0].config as any).workCalendars[month].days.pop();
    expect((await capture()).gross).toBeNull();
  });
  it('keeps old validation examples compatible but blocks formal calculation without the confirmed basis', async () => {
    expect((await fixture().capture()).gross).not.toBeNull();
    const result = await formalFixture(fixture()).capture('formal');
    expect(result.gross).toBeNull(); expect(result.issues.join()).toContain('固定工资');
  });
  it('a calendar source revision invalidates the source fingerprint even if the amounts stay the same', async () => {
    const { data, capture } = workdayFixture(); const before = await capture();
    (data.policies[0].config as any).workCalendars[month].sourceVersion = 'fictional-v2';
    const after = await capture(); expect(after.gross).toBe(before.gross); expect(after.sourceHash).not.toBe(before.sourceHash);
  });
  it('does not silently prorate additional performance for a mid-month hire', async () => {
    const { data, capture, tx } = workdayFixture();
    data.employments[0].effectiveFrom = new Date('2026-11-11');
    Object.assign(data.standards[0], { performanceMode: 'additional', performanceBase: new Prisma.Decimal('2000') });
    data.policies[0].config.performance = { [month]: { cycleIds: ['monthly'], sourceKind: 'fictional', coefficients: { A: '1.2' }, coefficientVersion: 'approved-v1', evidenceRef: 'Fictional coefficient approval' } };
    Object.assign(tx, { assessmentTask: { findUnique: jest.fn(async () => ({
      id: 'task', employeeId, cycleId: 'monthly', status: 'published', participantDisposition: 'active', isExempt: false,
      publishedAt: new Date('2026-11-20'), cycle: { type: 'monthly', startDate: new Date('2026-11-01'), endDate: new Date('2026-11-30') },
      gradeResult: { id: 'grade', calibratedGrade: 'A', rawGrade: 'A', isPublished: true, publishedAt: new Date('2026-11-20') }, appeals: [],
    })) } });
    const result = await capture(); expect(result.gross).toBeNull(); expect(result.issues.join()).toContain('绩效计发比例');
    data.employments[0].effectiveFrom = new Date('2026-11-01');
    const full = await capture(); expect(full.issues).toEqual([]);
    expect(full.lines.find(row => row.itemCode === 'performance')?.amount).toBe('2400.00');
    (data.policies[0].config.performance[month] as any).coefficientVersion = '';
    expect((await capture()).issues.join()).toContain('系数表');
  });
  it('rejects multiple automatic cycles across effective rule segments within one wage month', async () => {
    const { data, capture, tx } = workdayFixture();
    Object.assign(data.standards[0], { performanceMode: 'additional', performanceBase: new Prisma.Decimal('2000') });
    data.policies[0].config.performance = { [month]: { cycleIds: ['monthly-a'], sourceKind: 'fictional', coefficients: { A: '1.2' }, coefficientVersion: 'v1', evidenceRef: 'Fictional approval' } } as any;
    data.policies[0].effectiveTo = new Date('2026-11-15');
    const config = JSON.parse(JSON.stringify(data.policies[0].config)); config.performance[month].cycleIds = ['monthly-b'];
    data.policies.push({ ...data.policies[0], id: 'second-auto', effectiveFrom: new Date('2026-11-16'), effectiveTo: null, config });
    Object.assign(tx, { assessmentTask: { findUnique: jest.fn(async ({ where }) => ({
      id: where.cycleId_employeeId.cycleId, employeeId, cycleId: where.cycleId_employeeId.cycleId,
      status: 'published', participantDisposition: 'active', isExempt: false, publishedAt: new Date('2026-11-20'),
      cycle: { type: 'monthly', startDate: new Date('2026-11-01'), endDate: new Date('2026-11-30') },
      gradeResult: { id: 'grade', calibratedGrade: 'A', rawGrade: 'A', isPublished: true, publishedAt: new Date('2026-11-20') }, appeals: [],
    })) } });
    const result = await capture();
    expect(result.gross).toBeNull(); expect(result.issues.join()).toContain('多个考核来源');
  });
  it('uses the sealed source and exact money, preserving each obligation', async () => {
    const { capture } = fixture(), result = await capture();
    expect(result.issues).toEqual([]); expect(result.gross).toBe('17500.00');
    expect(result.lines.map(row => [row.itemCode, row.amount])).toEqual([
      ['fixed', '17400.00'], ['absence', '-200.00'], ['overtime', '300.00'], ['performance', '0.00'], ['adjustment', '0.00'],
    ]);
    expect((await capture()).sourceHash).toBe(result.sourceHash);
  });

  it.each([false, true])('another month claiming the same source blocks prior approval regardless of settled=%s', async settled => {
    const { data, capture } = fixture();
    Object.assign(data.attendance.payload.days[0].records[1], { sourceId: 'cross-month-night' });
    if (settled) data.settlements.push({ id: 'already-paid', amount: new Prisma.Decimal('300'), line: { employeeId, itemCode: 'overtime' } });
    const original = await capture(), frozen = JSON.stringify(data.attendance);
    data.otherAttendance.push({ id: 'other-month', month: '2026-12', version: 1, sourceHash: 'changed-work-day',
      payload: { days: [{ records: [{ sourceId: 'cross-month-night' }] }] } });
    const changed = await capture();
    expect(changed.issues.join()).toContain('跨月');
    expect(changed.gross).toBeNull();
    expect(changed.lines.every(line => line.amount === null)).toBe(true);
    expect(changed.sourceHash).not.toBe(original.sourceHash);
    expect(JSON.stringify(data.attendance)).toBe(frozen);
    expect(data.settlements.length).toBe(settled ? 1 : 0);
  });

  it('unrelated records in other months do not change the source fingerprint', async () => {
    const { data, capture } = fixture();
    Object.assign(data.attendance.payload.days[0].records[1], { sourceId: 'this-month-night' });
    const original = await capture();
    data.otherAttendance.push({ id: 'unrelated', month: '2026-12', version: 3, sourceHash: 'unrelated',
      payload: { days: [{ records: [{ sourceId: 'different-night' }] }] } });
    expect((await capture()).sourceHash).toBe(original.sourceHash);
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
