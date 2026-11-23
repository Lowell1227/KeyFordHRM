import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { payrollHash } from './payroll-transaction';
import { payrollParameterDefinition } from './payroll-parameter-definition';
import { assertFormalPayrollScopeAvailable, readFormalPayrollAssignments, readFormalPayrollEmployments } from './payroll-employment-scope';

const employee = randomUUID(), otherEmployee = randomUUID(), subject = randomUUID(), otherSubject = randomUUID();
const date = (value: string) => new Date(value);
function policy(id: string, subjectId = subject, ids = [employee], from = '2026-11-01', to: string | null = null): any {
  return { id, subjectId, domain: 'formal', status: 'active', version: 1, effectiveFrom: date(from), effectiveTo: to ? date(to) : null,
    config: { employeeScope: { employeeIds: ids, evidenceRef: 'Fictional payer approval' } } };
}
function approved(row: any, previousParameterId: string | null = null): any {
  return { id: `release:${row.id}`, ruleId: row.id, subjectId: row.subjectId, domain: 'formal', status: 'approved', kind: 'rule',
    previousParameterId, parameterVersion: row.version, snapshotHash: payrollHash(payrollParameterDefinition('rule', row)) };
}
function fixture() {
  const p = policy('original'), state = { policies: [p], releases: [approved(p)], employments: [{ id: 'employment', userId: employee,
    contractSubjectId: otherSubject, effectiveFrom: date('2026-11-10'), effectiveTo: date('2026-11-20'), createdAt: date('2026-01-01'),
    employeeStatus: 'active', entryDate: date('2026-11-12'), leaveDate: date('2026-11-18'), employeeNo: 'FICTIONAL',
    user: { id: employee, name: 'Fictional employee', employeeNo: 'FICTIONAL' } }] as any[] };
  const tx: any = { payrollPolicy: { findMany: jest.fn(async ({ where }) => state.policies.filter(row => (!where.subjectId || row.subjectId === where.subjectId) && row.status === 'active')) },
    payrollParameterRelease: { findMany: jest.fn(async ({ where }) => state.releases.filter(row => row.status === 'approved' && (!where.subjectId || row.subjectId === where.subjectId))) },
    employmentRecord: { findMany: jest.fn(async () => state.employments) } };
  return { state, tx };
}
describe('explicit reviewed formal payer scope', () => {
  it('has no contract fallback when assignments are missing or unreviewed', async () => {
    const s = fixture(); s.state.releases = [];
    expect((await readFormalPayrollAssignments(s.tx, subject, '2026-11')).size).toBe(0);
    expect(await readFormalPayrollEmployments(s.tx, subject, '2026-11')).toEqual([]);
    expect(s.tx.employmentRecord.findMany).not.toHaveBeenCalled();
  });
  it('keeps actual contract history intact and annotates only explicitly assigned employment dates', async () => {
    const s = fixture(), before = JSON.stringify(s.state.employments);
    const records = await readFormalPayrollEmployments(s.tx, subject, '2026-11');
    expect(records[0].contractSubjectId).toBe(otherSubject);
    expect(records[0].payrollAssignment).toMatchObject({ subjectId: subject, workDates: expect.arrayContaining(['2026-11-12', '2026-11-18']) });
    expect(records[0].payrollAssignment.workDates).not.toContain('2026-11-11'); expect(records[0].payrollAssignment.workDates).not.toContain('2026-11-19');
    expect(JSON.stringify(s.state.employments)).toBe(before);
  });
  it('uses an expired successor to shadow its predecessor rather than reviving the old scope', async () => {
    const s = fixture(), next = policy('next', subject, [otherEmployee], '2026-11-10', '2026-11-15');
    s.state.policies.push(next); s.state.releases.push(approved(next, 'original'));
    const days = await readFormalPayrollAssignments(s.tx, subject, '2026-11');
    expect(days.get(employee)).toHaveLength(9); expect(days.get(otherEmployee)).toHaveLength(6);
    expect([...days.values()].flat()).not.toContain('2026-11-16');
  });
  it('does not let drafts or other subjects provide a fallback scope', async () => {
    const s = fixture(); s.state.policies[0].status = 'draft';
    const other = policy('other', otherSubject); s.state.policies.push(other); s.state.releases.push(approved(other));
    expect((await readFormalPayrollAssignments(s.tx, subject, '2026-11')).size).toBe(0);
  });
  it('rejects a changed reviewed definition rather than trusting active status alone', async () => {
    const s = fixture(); s.state.policies[0].config.employeeScope.employeeIds = [otherEmployee];
    await expect(readFormalPayrollAssignments(s.tx, subject, '2026-11')).rejects.toThrow(ConflictException);
  });
  it.each(['start', 'end', 'open'])('blocks an employee assigned to different payers during an inclusive overlap: %s', async edge => {
    const s = fixture(), candidate = policy('candidate', otherSubject, [employee], edge === 'end' ? '2026-11-30' : '2026-11-01', edge === 'open' ? null : '2026-11-30');
    await expect(assertFormalPayrollScopeAvailable(s.tx, candidate, null)).rejects.toThrow(ConflictException);
  });
  it('permits adjacent nonoverlapping payer assignments and distinct employees', async () => {
    const s = fixture(); s.state.policies[0].effectiveTo = date('2026-11-30'); s.state.releases[0] = approved(s.state.policies[0]);
    await expect(assertFormalPayrollScopeAvailable(s.tx, policy('candidate', otherSubject, [employee], '2026-12-01'), null)).resolves.toBeUndefined();
    await expect(assertFormalPayrollScopeAvailable(s.tx, policy('distinct', otherSubject, [otherEmployee]), null)).resolves.toBeUndefined();
  });
  it('honors replacement scope removal after its successor expires during cross-subject checks', async () => {
    const s = fixture(), removed = policy('removed', subject, [otherEmployee], '2026-11-10', '2026-11-15');
    s.state.policies.push(removed); s.state.releases.push(approved(removed, 'original'));
    await expect(assertFormalPayrollScopeAvailable(s.tx, policy('candidate', otherSubject, [employee], '2026-11-16'), null)).resolves.toBeUndefined();
  });
  it('does not treat an unapproved payer policy as an assignment', async () => {
    const s = fixture(); s.state.releases = [];
    await expect(assertFormalPayrollScopeAvailable(s.tx, policy('candidate', otherSubject), null)).resolves.toBeUndefined();
  });
});
