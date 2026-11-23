import { currentArchiveIssues } from './employee-archive-current-issues';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const at = d('2026-11-23');
function fixture(): any {
  return { id: 'employee-1', accountType: 'employee', status: 'active', archivedAt: null, deletedAt: null,
    entryDate: d('2020-01-01'), deptId: 'dept-1', employeeProfile: {},
    employeeContracts: [{ id: 'contract-1', isActive: true, effectiveFrom: d('2020-01-01'), expiresAt: d('2030-12-31'), name: '劳动合同' }] };
}
const issues = (u: any, context: any = {}) => currentArchiveIssues(u, { ...context, at });
describe('current dossier issues disappear with corrected formal data', () => {
  it('has no warnings for complete current facts or for unrelated optional profile blanks', () => {
    expect(issues(fixture())).toEqual([]);
  });
  it('removes missing-entry and missing-department issues directly after edits', () => {
    const u = { ...fixture(), entryDate: null, deptId: null };
    expect(issues(u).map(i => i.field)).toEqual(expect.arrayContaining(['employee.entryDate', 'employee.deptId']));
    u.entryDate = d('2020-01-01');
    expect(issues(u)).toHaveLength(1);
    u.deptId = 'department';
    expect(issues(u)).toEqual([]);
  });
  it('keeps the date-arrangement issue until all actual future dates are corrected', () => {
    const u = fixture();u.actualRegularDate = d('2027-04-19');u.employeeProfile.housingFundStartDate = d('2027-05-01');
    expect(issues(u)).toHaveLength(1);
    u.actualRegularDate = null;u.plannedRegularDate = d('2027-04-19');
    expect(issues(u)).toHaveLength(1);
    u.employeeProfile.housingFundStartDate = null;
    expect(issues(u)).toEqual([]);
  });
  it('does not convert plan dates or confirmed month evidence into errors', () => {
    const u = fixture();u.plannedRegularDate = d('2027-04-19');
    expect(issues(u, { proposals: [{ hrConfirmation20261123: { questions: [{ number: 6, socialSecurityStartMonth: '2026-03' }] } }] })).toEqual([]);
  });
  it('focuses social security when it is the only future actual date', () => {
    const u = fixture();u.employeeProfile.socialSecurityStartDate = d('2027-01-01');
    expect(issues(u)[0]).toMatchObject({ field: 'profile.socialSecurityStartDate', fields: ['profile.socialSecurityStartDate'] });
  });
  it('removes a regular-after-leave issue after correcting the actual regularization', () => {
    const u = fixture();u.status = 'resigned';u.leaveDate = d('2025-02-18');u.actualRegularDate = d('2025-05-18');
    expect(issues(u).map(i => i.id)).toContain('current:regularization');
    u.actualRegularDate = null;
    expect(issues(u)).toEqual([]);
  });
  it('shows expired recorded contracts for current workers and clears after renewal', () => {
    const u = fixture();u.employeeContracts[0].expiresAt = d('2026-10-10');
    expect(issues(u).map(i => i.id)).toContain('current:contract-expired');
    u.employeeContracts.push({ id: 'new-contract', isActive: true, effectiveFrom: d('2026-10-11'), expiresAt: d('2027-10-10') });
    expect(issues(u)).toEqual([]);
    u.status = 'resigned';u.employeeContracts.pop();
    expect(issues(u)).toEqual([]);
  });
  it('does not mistake a future renewal for a currently effective contract', () => {
    const u = fixture();u.employeeContracts[0].expiresAt = d('2026-10-10');
    u.employeeContracts.push({ id: 'future', isActive: true, effectiveFrom: d('2027-01-01'), expiresAt: d('2028-01-01') });
    expect(issues(u).map(i => i.id)).toContain('current:contract-expired');
  });
  it('groups overlapping pairs and removes the issue after their end dates are corrected', () => {
    const u = fixture();u.employeeContracts[0].expiresAt = d('2026-05-31');
    u.employeeContracts.push({ id: 'second', isActive: true, effectiveFrom: d('2025-09-01'), expiresAt: d('2028-08-31') });
    expect(issues(u)).toHaveLength(1);
    expect(issues(u)[0]).toMatchObject({ id: 'current:contract-overlap', origin: 'current', field: 'contracts' });
    u.employeeContracts[0].expiresAt = d('2025-08-31');
    expect(issues(u)).toEqual([]);
  });
  it('does not invent unknown contract starts or include removed contracts', () => {
    const u = fixture();u.employeeContracts.push({ id: 'unknown', isActive: true, effectiveFrom: null, expiresAt: d('2029-01-01') }, { id: 'removed', isActive: false, effectiveFrom: d('2020-01-01'), expiresAt: d('2035-01-01') });
    expect(issues(u)).toEqual([]);
  });
  it('retains no-contract reminder unless explicitly not applicable; archived/test records are excluded', () => {
    const u = fixture();u.employeeContracts = [];
    expect(issues(u)).toHaveLength(1);
    expect(issues(u, { proposals: [{ hrConfirmation20261123: { questions: [{ contractApplicability: '不适用' }] } }] })).toEqual([]);
    expect(issues({ ...u, archivedAt: at })).toEqual([]);
    expect(issues({ ...u, accountType: 'test' })).toEqual([]);
  });
  it('uses only relevant facts in fingerprints and reopens explanations for changed facts', () => {
    const u = fixture();u.entryDate = null;
    const item = issues(u)[0];u.position = 'Changed position';u.updatedAt = at;
    expect(issues(u)[0].fingerprint).toBe(item.fingerprint);
    const exemptions = [{ issueId: item.id, fingerprint: item.fingerprint, isExempt: true, version: 1 }];
    expect(issues(u, { exemptions })).toEqual([]);
    exemptions[0].isExempt = false;
    expect(issues(u, { exemptions })[0]).toMatchObject({ id: item.id, exemptionVersion: 1 });
    exemptions[0].isExempt = true;
    u.entryDate = d('2026-01-01');u.employeeContracts = [];
    expect(issues(u, { exemptions }).map(i => i.id)).toContain('current:contract-missing');
  });
  it('never includes raw contact, identity, bank or old-source data in payloads', () => {
    const u = fixture();u.entryDate = null;u.phone = 'SYNTHETIC-CONTACT';u.employeeProfile.idNumberEncrypted = 'SYNTHETIC-ID';u.employeeProfile.bankAccountEncrypted = 'SYNTHETIC-BANK';
    expect(JSON.stringify(issues(u))).not.toMatch(/SYNTHETIC/);
    expect(issues(u)[0].source.value).toBeNull();
  });
});
