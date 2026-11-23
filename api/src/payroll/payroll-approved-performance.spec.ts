import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { readPayrollPerformance } from './payroll-performance-source';
import { assertPayrollApprovedPerformance } from './payroll-approved-performance';
import { payrollHash } from './payroll-transaction';
import { payrollParameterDefinition } from './payroll-parameter-definition';

async function fixture(manual = false) {
  const task: any = { id: 'task', employeeId: 'employee', cycleId: 'cycle', status: 'published', isExempt: false, participantDisposition: 'active',
    publishedAt: new Date('2026-11-30'), cycle: { type: 'monthly', startDate: new Date('2026-11-01'), endDate: new Date('2026-11-30') },
    gradeResult: { id: 'grade', calibratedGrade: 'A', rawGrade: 'B', isPublished: true, publishedAt: new Date('2026-11-30'), hrCalibratedAt: null, approvedAt: null }, appeals: [] };
  const state = { payments: [] as any[], events: [] as any[], settlements: [] as any[], policies: [] as any[], releases: [] as any[] };
  const tx: any = { assessmentTask: { findUnique: jest.fn(async () => task) },
    payrollNetPayment: { findMany: jest.fn(async () => state.payments) }, payrollEvent: { findMany: jest.fn(async () => state.events) },
    payrollSettlement: { findMany: jest.fn(async () => state.settlements) },
    payrollPolicy: { findMany: jest.fn(async () => state.policies) }, payrollParameterRelease: { findMany: jest.fn(async () => state.releases) } };
  const result = await readPayrollPerformance(tx, { employeeId: 'employee', cycleId: 'cycle', registeredCycleIds: ['cycle'], requiredMonth: '2026-11' });
  const frozen: any = manual ? { manualPerformance: [{ employeeId: 'employee', month: '2026-11', workDates: ['2026-11-10', '2026-11-20'],
    entries: [{ policyId: 'policy', amount: '500.00', evidenceRef: 'fictional-approved-input' }] }] } : { performance: [{ employeeId: 'employee', cycleId: 'cycle', result }] };
  const version: any = { id: 'version', version: 2, netSnapshot: {}, sources: { months: [{ month: '2026-11', sources: frozen }] },
    lines: [{ id: 'line', employeeId: 'employee', attributionMonth: '2026-11', itemCode: 'performance', amount: new Prisma.Decimal(500),
      entitlement: new Prisma.Decimal(500), paidBefore: new Prisma.Decimal(0), status: 'ready', evidence: {
        applicability: 'applicable', calculated: manual ? null : { code: 'performance', amount: '500.00' },
        ...(manual ? { manualPerformance: { amount: '500.00', evidenceRef: 'fictional-approved-input', policyIds: ['policy'] } } : {}),
      } }] };
  const batch = { id: 'batch', subjectId: 'subject' };
  function release(policy: any, previousParameterId: string | null = null) {
    return { ruleId: policy.id, previousParameterId, parameterVersion: policy.version, snapshotHash: payrollHash(payrollParameterDefinition('rule', policy)) };
  }
  const mapping = manual ? { sourceKind: 'manual', manualAmounts: { employee: '500.00' }, evidenceRef: 'fictional-approved-input', cycleIds: [], coefficients: {} }
    : { sourceKind: 'official', cycleIds: ['cycle'], coefficients: { A: '1', B: '0.8' }, coefficientVersion: 'approved-coefficients-v1', evidenceRef: 'fictional-approved-input' };
  const policy = { id: 'policy', subjectId: 'subject', domain: 'formal', version: 1, status: 'active', effectiveFrom: new Date('2026-11-01'), effectiveTo: null,
    config: { performance: { '2026-11': mapping } } };
  state.policies.push(policy); state.releases.push(release(policy));
  frozen.policies = JSON.parse(JSON.stringify(state.policies)); frozen.parameterReleases = JSON.parse(JSON.stringify(state.releases));
  frozen.attendance = { payload: { days: ['2026-11-10', '2026-11-20'].map(workDate => ({ employeeId: 'employee', workDate })) } };
  tx.assessmentTask.findUnique.mockClear();
  return { tx, task, state, frozen, version, batch, release, check: () => assertPayrollApprovedPerformance(tx, batch, version, 'formal') };
}

describe('approved unpaid performance semantic freshness', () => {
  it('uses only the frozen employee/cycle/month without recapturing salary sources', async () => {
    const s = await fixture(); await expect(s.check()).resolves.toBeUndefined();
    expect(s.tx.assessmentTask.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { cycleId_employeeId: { employeeId: 'employee', cycleId: 'cycle' } } }));
  });
  it.each(['grade', 'publication', 'appeal', 'missing', 'period'])('blocks an automatic %s change', async kind => {
    const s = await fixture();
    if (kind === 'grade') s.task.gradeResult.calibratedGrade = 'C';
    if (kind === 'publication') s.task.gradeResult.isPublished = false;
    if (kind === 'appeal') s.task.appeals.push({ id: 'appeal', status: 'pending', finalResult: null, updatedAt: new Date() });
    if (kind === 'missing') s.tx.assessmentTask.findUnique.mockResolvedValue(null);
    if (kind === 'period') s.task.cycle.endDate = new Date('2026-12-01');
    await expect(s.check()).rejects.toThrow(ConflictException);
  });
  it.each(['confirmed', 'closed'])('does not treat employee %s or generic timestamps as a revised payable result', async status => {
    const s = await fixture(); s.task.status = status; s.task.gradeResult.updatedAt = new Date(); s.task.gradeResult.employeeConfirmedAt = new Date();
    await expect(s.check()).resolves.toBeUndefined();
  });
  it.each([false, true])('skips paid/cancelled automatic employees without reading mutable HRM results, cancelled=%s', async cancelled => {
    const s = await fixture(); s.task.gradeResult.isPublished = false;
    if (cancelled) s.state.events.push({ metadata: { employeeId: 'employee', versionId: 'version' } });
    else s.state.payments.push({ employeeId: 'employee' });
    await expect(s.check()).resolves.toBeUndefined(); expect(s.tx.assessmentTask.findUnique).not.toHaveBeenCalled();
    expect(s.tx.payrollNetPayment.findMany).toHaveBeenCalledWith({ where: { versionId: 'version', subjectId: 'subject', domain: 'formal' }, select: { employeeId: true } });
  });
  it('keeps other unpaid employees guarded when one employee was paid', async () => {
    const s = await fixture(); s.state.payments.push({ employeeId: 'other' }); s.task.gradeResult.calibratedGrade = 'D';
    await expect(s.check()).rejects.toThrow(ConflictException);
  });
  it('does not mistake cancellation of a different version for cancellation of the approved row', async () => {
    const s = await fixture(); s.task.gradeResult.isPublished = false;
    s.state.events.push({ metadata: { employeeId: 'employee', versionId: 'old-version' } });
    await expect(s.check()).rejects.toThrow(ConflictException);
  });
  it('also guards additional attribution months', async () => {
    const s = await fixture(); s.version.sources.months[0].month = '2026-10'; s.version.lines[0].attributionMonth = '2026-10';
    await expect(s.check()).rejects.toThrow(ConflictException);
  });
  it('preserves fully settled legacy gross results but guards a partial settlement', async () => {
    const s = await fixture(); s.version.netSnapshot = null; s.task.gradeResult.calibratedGrade = 'D';
    s.state.settlements.push({ lineId: 'line', amount: new Prisma.Decimal(300) });
    await expect(s.check()).rejects.toThrow(ConflictException);
    s.state.settlements.push({ lineId: 'line', amount: new Prisma.Decimal(200) });
    s.tx.assessmentTask.findUnique.mockClear(); await expect(s.check()).resolves.toBeUndefined();
    expect(s.tx.assessmentTask.findUnique).not.toHaveBeenCalled();
  });
  it('does not read HRM results or policies for sources without a frozen performance dependency', async () => {
    const s = await fixture(); s.frozen.performance = []; Object.assign(s.version.lines[0], { status: 'not_applicable',
      amount: new Prisma.Decimal(0), entitlement: new Prisma.Decimal(0), evidence: { applicability: 'not_applicable', calculated: null, adjustment: '0.00', adjustmentIds: [] } });
    await expect(s.check()).resolves.toBeUndefined(); expect(s.tx.assessmentTask.findUnique).not.toHaveBeenCalled(); expect(s.tx.payrollPolicy.findMany).not.toHaveBeenCalled();
  });
  it('checks manual amounts on frozen working dates without reading HRM performance', async () => {
    const s = await fixture(true); s.task.gradeResult.isPublished = false; await expect(s.check()).resolves.toBeUndefined();
    expect(s.tx.assessmentTask.findUnique).not.toHaveBeenCalled();
    expect(s.tx.payrollPolicy.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ subjectId: 'subject', domain: 'formal', status: 'active' }) }));
    expect(s.tx.payrollParameterRelease.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ subjectId: 'subject', domain: 'formal', status: 'approved' }) }));
  });
  it.each(['amount', 'evidence', 'automatic', 'unreviewed', 'tampered', 'gap', 'overlap', 'successor', 'dates'])('blocks changed or invalid manual inputs: %s', async kind => {
    const s = await fixture(true), policy = s.state.policies[0], mapping = policy.config.performance['2026-11'];
    if (kind === 'amount') mapping.manualAmounts.employee = '600.00';
    if (kind === 'evidence') mapping.evidenceRef = 'changed-input';
    if (kind === 'automatic') mapping.sourceKind = 'official';
    if (kind === 'unreviewed') s.state.releases = [];
    if (kind === 'tampered') policy.config.other = 'not-reviewed';
    if (kind === 'gap') policy.effectiveTo = new Date('2026-11-15');
    if (kind === 'overlap' || kind === 'successor') {
      const next = { ...policy, id: 'next', version: 2, effectiveFrom: new Date('2026-11-15') }; s.state.policies.push(next);
      s.state.releases.push(s.release(next, kind === 'successor' ? policy.id : null));
    }
    if (kind === 'dates') s.frozen.manualPerformance[0].workDates = [];
    if (!['unreviewed', 'tampered'].includes(kind)) s.state.releases[0] = s.release(policy);
    await expect(s.check()).rejects.toThrow(ConflictException);
    expect(s.tx.assessmentTask.findUnique).not.toHaveBeenCalled();
  });
  it.each([false, true])('does not let later manual parameter edits rewrite paid/cancelled rows, cancelled=%s', async cancelled => {
    const s = await fixture(true); s.state.policies.length = 0;
    if (cancelled) s.state.events.push({ metadata: { employeeId: 'employee', versionId: 'version' } });
    else s.state.payments.push({ employeeId: 'employee' });
    await expect(s.check()).resolves.toBeUndefined(); expect(s.tx.payrollPolicy.findMany).not.toHaveBeenCalled();
  });
  it('deduplicates one manual rule across working dates and ignores a future successor', async () => {
    const s = await fixture(true), next = { ...s.state.policies[0], id: 'future', version: 2, effectiveFrom: new Date('2026-12-01') };
    s.state.policies.push(next); s.state.releases.push(s.release(next, 'policy')); await expect(s.check()).resolves.toBeUndefined();
  });
  it('compares the same trimmed evidence and canonical cents used by manual capture', async () => {
    const s = await fixture(true), policy = s.state.policies[0];
    policy.config.performance['2026-11'].evidenceRef = ' fictional-approved-input ';
    policy.config.performance['2026-11'].manualAmounts.employee = '500'; s.state.releases[0] = s.release(policy);
    await expect(s.check()).resolves.toBeUndefined();
  });
  it.each(['manual', 'cycle', 'coefficient', 'table', 'evidence', 'unreviewed'])('blocks approved automatic mapping changes even when the old HRM result remains ready: %s', async kind => {
    const s = await fixture(), original = s.state.policies[0], next = { ...original, id: 'new-policy', version: 2, config: JSON.parse(JSON.stringify(original.config)) };
    const mapping = next.config.performance['2026-11'];
    if (kind === 'manual') Object.assign(mapping, { sourceKind: 'manual', manualAmounts: { employee: '800.00' }, cycleIds: [], coefficients: {} });
    if (kind === 'cycle') mapping.cycleIds = ['different-cycle'];
    if (kind === 'coefficient') mapping.coefficients.A = '1.5';
    if (kind === 'table') mapping.coefficientVersion = 'approved-coefficients-v2';
    if (kind === 'evidence') mapping.evidenceRef = 'new-approved-basis';
    s.state.policies.push(next); if (kind !== 'unreviewed') s.state.releases.push(s.release(next, original.id));
    await expect(s.check()).rejects.toThrow(ConflictException);
    expect(s.tx.assessmentTask.findUnique).not.toHaveBeenCalled();
  });
  it.each([false, true])('fails closed when a manual/automatic nonzero performance dependency disappears, manual=%s', async manual => {
    const s = await fixture(manual); if (manual) delete s.frozen.manualPerformance; else delete s.frozen.performance;
    await expect(s.check()).rejects.toThrow(ConflictException);
  });
  it('fails closed for a missing zero-valued manual dependency with explicit manual evidence', async () => {
    const s = await fixture(true); delete s.frozen.manualPerformance;
    s.version.lines[0].amount = s.version.lines[0].entitlement = new Prisma.Decimal(0);
    await expect(s.check()).rejects.toThrow(ConflictException);
  });
  it('does not let one complete employee dependency conceal another missing employee', async () => {
    const s = await fixture(); s.version.lines.push({ ...s.version.lines[0], id: 'second-line', employeeId: 'second' });
    await expect(s.check()).rejects.toThrow(ConflictException);
  });
  it('allows explicitly authorized adjustment-only performance without requiring an HRM result', async () => {
    const s = await fixture(); delete s.frozen.performance;
    s.frozen.adjustments = [{ id: 'adjustment', employeeId: 'employee', itemCode: 'performance', amount: '500.00' }];
    s.version.lines[0].evidence = { applicability: 'not_applicable', calculated: null, adjustment: '500.00', adjustmentIds: ['adjustment'] };
    await expect(s.check()).resolves.toBeUndefined(); expect(s.tx.assessmentTask.findUnique).not.toHaveBeenCalled();
  });
  it('does not accept an adjustment-only label without the matching authorized evidence', async () => {
    const s = await fixture(); delete s.frozen.performance;
    s.version.lines[0].evidence = { applicability: 'not_applicable', calculated: null, adjustment: '500.00', adjustmentIds: [] };
    await expect(s.check()).rejects.toThrow(ConflictException);
  });
  it('preserves a fully settled performance month while fixed wages or another month are still unpaid', async () => {
    const s = await fixture(); s.version.netSnapshot = null; s.task.gradeResult.isPublished = false;
    s.version.lines.push({ ...s.version.lines[0], id: 'fixed', itemCode: 'fixed', amount: new Prisma.Decimal(1000) },
      { ...s.version.lines[0], id: 'other-month', attributionMonth: '2026-10', amount: new Prisma.Decimal(100) });
    s.state.settlements.push({ lineId: 'line', amount: new Prisma.Decimal(500) });
    s.state.events.push({ metadata: { lineId: 'other-month' } });
    await expect(s.check()).resolves.toBeUndefined(); expect(s.tx.assessmentTask.findUnique).not.toHaveBeenCalled();
  });
  it.each(['paid', 'cancelled'])('does not revalidate missing or obsolete dependency schemas for %s history', async kind => {
    const s = await fixture(); s.version.sources = null;
    if (kind === 'paid') s.state.payments.push({ employeeId: 'employee' });
    else s.state.events.push({ metadata: { versionId: 'version', employeeId: 'employee' } });
    await expect(s.check()).resolves.toBeUndefined(); expect(s.tx.assessmentTask.findUnique).not.toHaveBeenCalled(); expect(s.tx.payrollPolicy.findMany).not.toHaveBeenCalled();
  });
  it('preserves a legacy settled performance line even if its dependency was not retained', async () => {
    const s = await fixture(); s.version.netSnapshot = null; s.version.sources = null;
    s.state.settlements.push({ lineId: 'line', amount: new Prisma.Decimal(500) });
    await expect(s.check()).resolves.toBeUndefined();
  });
  it('does not equate an unexplained zero performance line with explicit non-applicability', async () => {
    const s = await fixture(); s.version.sources = null; s.version.lines[0].amount = s.version.lines[0].entitlement = new Prisma.Decimal(0);
    s.version.lines[0].evidence = {};
    await expect(s.check()).rejects.toThrow(ConflictException);
  });
  it.each(['legacy', 'formal', 'monthly_workdays', 'changed'])('limits pre-release compatibility to the unchanged original validation root: %s', async kind => {
    const s = await fixture(); s.state.releases = []; s.frozen.parameterReleases = [];
    const policy = s.state.policies[0];
    policy.domain = kind === 'formal' ? 'formal' : 'validation';
    policy.config.performance['2026-11'].sourceKind = kind === 'formal' ? 'official' : 'fictional';
    if (kind === 'monthly_workdays') policy.config.fixedSalaryBasis = 'monthly_workdays';
    s.frozen.policies = JSON.parse(JSON.stringify(s.state.policies));
    const source = await readPayrollPerformance(s.tx, { employeeId: 'employee', cycleId: 'cycle', registeredCycleIds: ['cycle'] });
    s.frozen.performance[0].result = source;
    if (kind === 'changed') policy.config.performance['2026-11'].coefficients.A = '2';
    const check = assertPayrollApprovedPerformance(s.tx, s.batch, s.version, policy.domain);
    if (kind === 'legacy') await expect(check).resolves.toBeUndefined(); else await expect(check).rejects.toThrow(ConflictException);
  });
  it('allows a reviewed successor with unchanged automatic mapping rather than recapturing unrelated salary configuration', async () => {
    const s = await fixture(), next = { ...s.state.policies[0], id: 'next', version: 2, effectiveFrom: new Date('2026-11-15') };
    s.state.policies.push(next); s.state.releases.push(s.release(next, 'policy'));
    await expect(s.check()).resolves.toBeUndefined();
  });
  it('rejects a missing or malformed automatic snapshot as a conflict, not a TypeError', async () => {
    for (const snapshot of [undefined, null, [], 'invalid']) {
      const s = await fixture(); s.frozen.performance[0].result = { status: 'ready', snapshot };
      await expect(s.check()).rejects.toThrow(ConflictException);
      s.state.payments.push({ employeeId: 'employee' });
      await expect(s.check()).resolves.toBeUndefined();
    }
  });
  it('rejects malformed automatic attendance days as a conflict without applying that guard to manual or paid rows', async () => {
    const s = await fixture(); s.frozen.attendance.payload.days = {};
    await expect(s.check()).rejects.toThrow(ConflictException);
    s.state.payments.push({ employeeId: 'employee' }); await expect(s.check()).resolves.toBeUndefined();
    const manual = await fixture(true); manual.frozen.attendance.payload.days = {};
    await expect(manual.check()).resolves.toBeUndefined();
  });
});
