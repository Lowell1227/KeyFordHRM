import { archiveIssueStates } from './employee-archive-issues';

const request = (warning: Record<string, unknown>, overrides = {}) => ({
  id: 'request-1', userId: 'employee-1', requestVersion: 1, sourceSystem: 'roster_initialization',
  profileReviewStatus: 'approved', appliedAt: new Date('2026-01-01'), recordStatus: 'submitted',
  proposedValue: { employee: { companyText: 'Source company' }, source: { sheetName: 'Roster', rowNumber: 3 } },
  validationWarnings: [warning], ...overrides,
});
const user = { id: 'employee-1', employeeNo: 'SYNTHETIC-1', employmentHistory: [{
  id: 'employment-1', effectiveFrom: new Date('2020-01-01'), effectiveTo: null, companyText: 'Current company',
}], employeeProfile: { phone: null }, employeeContracts: [] };

describe('shared archive issue projection', () => {
  const conflict = { field: 'employee.companyText', kind: 'conflict', code: 'conflict',
    message: 'Company conflict', sourceValue: { companyText: 'Source A/B', rawRow: 'must not leak' } };

  it('shows only safe source/current values and allows confirming an applied conflict', () => {
    const [{ issue }] = archiveIssueStates(request(conflict), user);
    expect(issue.source.value).toBe('所属公司：Source A/B');
    expect(issue.current.value).toBe('Current company');
    expect(issue.canConfirmCurrent).toBe(true);
    expect(JSON.stringify(issue)).not.toContain('must not leak');
  });

  it('keeps identity candidates unbound and does not confirm missing draft values', () => {
    const draft = request({ field: 'identity', code: 'review', message: 'Candidate identity' }, {
      userId: null, recordStatus: 'draft', appliedAt: null, profileReviewStatus: 'pending',
      proposedValue: { employee: { name: 'Synthetic', employeeStatus: null }, identityCandidateUserId: 'candidate-1' },
    });
    const [{ issue }] = archiveIssueStates(draft, null);
    expect(issue.kind).toBe('identity');
    expect(issue.employeeId).toBeNull();
    expect(issue.canConfirmCurrent).toBe(false);
  });

  it('maps source-draft null lifecycle warnings to missing and removes only after completion', () => {
    const draft = request({ field: 'employeeStatus', code: 'review', message: 'Status unknown' }, {
      userId: null, recordStatus: 'draft', appliedAt: null, sourceSystem: 'roster_reconcile_20261030',
      proposedValue: { employee: { employeeStatus: null } },
    });
    expect(archiveIssueStates(draft, null)[0].issue).toMatchObject({ kind: 'missing', canConfirmCurrent: false });
    draft.proposedValue = { employee: { employeeStatus: 'active' } } as any;
    expect(archiveIssueStates(draft, null)).toEqual([]);
  });

  it('does not clear formal missing values from a pending proposal', () => {
    const source = request({ field: 'profile.phone', code: 'missing', message: 'Phone missing' });
    source.proposedValue = { profile: { phone: 'SYNTHETIC' } } as any;
    expect(archiveIssueStates(source, user)[0].issue.canConfirmCurrent).toBe(false);
  });

  it('preserves legacy profile and company-text completeness using formal values, including generic profile warnings', () => {
    const legacyProfile = request({ field: 'education', code: 'missing', message: 'Education missing' });
    expect(archiveIssueStates(legacyProfile, { ...user, employeeProfile: { education: 'Synthetic qualification' } })).toEqual([]);
    const company = request({ field: 'company', code: 'missing', message: 'Contract company missing' });
    const withoutText = { ...user, company: 'fuede', employmentHistory: [{ ...user.employmentHistory[0], companyText: null }] };
    expect(archiveIssueStates(company, withoutText)).toHaveLength(1);
    expect(archiveIssueStates(company, user)).toEqual([]);
    const profile = request({ field: 'profile', code: 'missing', message: 'Required profile fields missing' }, { proposedValue: { employee: {} } });
    const complete = { ...user, deptId: 'department-1', entryDate: new Date('2020-01-01'), status: 'active', employmentType: 'full_time' };
    expect(archiveIssueStates(profile, complete)).toEqual([]);
  });

  it('guards a confirmation with current facts but keeps a resolved historical source closed across later normal changes', () => {
    const source = request(conflict);
    const state = archiveIssueStates(source, user)[0];
    source.validationWarnings = [{ ...conflict, resolution: { decision: 'keep_current', warningSourceDigest: state.warningSourceDigest } }];
    expect(archiveIssueStates(source, user)).toEqual([]);
    expect(archiveIssueStates(source, user, true)[0].issue.status).toBe('resolved');
    const changed = { ...user, employmentHistory: [{ ...user.employmentHistory[0], companyText: 'Changed company' }] };
    expect(archiveIssueStates({ ...source, requestVersion: 2 }, changed)).toEqual([]);
    source.validationWarnings = [{ ...source.validationWarnings[0], sourceValue: 'A new source observation' }];
    expect(archiveIssueStates(source, changed)[0].issue.fingerprint).not.toBe(state.issue.fingerprint);
  });

  it('keeps source completeness kinds across submission/application instead of resurrecting review warnings', () => {
    const warning = { field: 'employeeStatus', code: 'review', message: 'Source status unknown' };
    const source = request(warning, { userId: null, sourceSystem: 'roster_reconcile_20261030', recordStatus: 'submitted',
      proposedValue: { employee: { employeeStatus: 'active' } }, appliedAt: null });
    expect(archiveIssueStates(source, null)).toEqual([]);
    const formal = { ...user, status: 'active', employmentHistory: [{ ...user.employmentHistory[0], employeeStatus: 'active' }] };
    expect(archiveIssueStates({ ...source, userId: 'employee-1', appliedAt: new Date() }, formal)).toEqual([]);
  });

  it('formats enum values in business language instead of leaking keys or UUIDs', () => {
    const source = request({ field: 'employee.status', code: 'review', message: 'Status' });
    expect(archiveIssueStates(source, { ...user, status: 'active' })[0].issue.current.value).toBe('在职');
  });

  it.each([
    ['employeeStatus', '试用期', '试用期'],
    ['employmentType', '全职', '全职'],
    ['employeeStatus', '源表待确认状态', '源表待确认状态'],
    ['employmentType', '源表特殊用工', '源表特殊用工'],
  ])('keeps source %s text %s visible', (field, sourceValue, expected) => {
    const source = request({ field, code: 'review', message: 'Source value requires review', sourceValue });
    expect(archiveIssueStates(source, user)[0].issue.source.value).toBe(expected);
  });

  it('displays legacy company aliases from legal company text while preserving the stored field and issue identity', () => {
    const source = request({ id: 'legacy-company', field: 'company', code: 'conflict', message: 'Company requires review' }, {
      proposedValue: { employee: { company: 'fuede', companyText: 'Source legal company' } },
    });
    const [{ issue }] = archiveIssueStates(source, user);
    expect(issue).toMatchObject({ id: 'legacy-company', field: 'company', source: { value: 'Source legal company' }, current: { value: 'Current company' } });
  });

  it('masks sensitive fields even if a warning carries a raw source value', () => {
    const source = request({ field: 'profile.idNumber', code: 'review', message: 'Identity requires review', sourceValue: 'SYNTHETIC-ID' });
    const [{ issue }] = archiveIssueStates(source, user);
    expect(issue.source.value).toBe('敏感信息已隐藏');
    expect(issue.canConfirmCurrent).toBe(false);
    expect(JSON.stringify(issue)).not.toContain('SYNTHETIC-ID');
  });

  it('invalidates an old popup and resolution when only source-file identity changes', () => {
    const source = request({ ...conflict, id: 'stable-source-issue' });
    source.proposedValue = { ...source.proposedValue, sourceFileHash: 'source-v1' } as any;
    const original = archiveIssueStates(source, user)[0];
    source.validationWarnings = [{ ...conflict, id: 'stable-source-issue', resolution: { decision: 'keep_current', warningSourceDigest: original.warningSourceDigest } }] as any;
    expect(archiveIssueStates(source, user)).toEqual([]);
    source.proposedValue = { ...source.proposedValue, sourceFileHash: 'source-v2' } as any;
    const [next] = archiveIssueStates(source, user);
    expect(next.issue.id).toBe(original.issue.id);
    expect(next.issue.fingerprint).not.toBe(original.issue.fingerprint);
    expect(next.issue.status).toBe('open');
  });
});
