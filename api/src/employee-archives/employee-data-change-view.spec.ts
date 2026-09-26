import { employeeDataChangeView, employeeArchiveView } from './employee-data-change-view';

describe('employee archive public response', () => {
  it('removes credential and sensitive storage keys at every nesting level but preserves dates', () => {
    const date = new Date('2026-09-26T00:00:00Z');
    const result = employeeArchiveView({ id: 'employee', passwordHash: 'never-return', updatedAt: date,
      latestResignationReview: { proposedValue: { profile: { idNumberEncrypted: 'secret', idNumberFingerprint: 'hash' } } },
      history: [{ newValue: { bankAccountEncrypted: 'cipher', bankAccountFingerprint: 'hash', passwordHash: 'secret' } }],
    });
    expect(result.updatedAt).toBe(date);
    expect(result).not.toHaveProperty('passwordHash');
    expect(result.latestResignationReview.proposedValue.profile).toEqual({ idNumberConfigured: true });
    expect(result.history[0].newValue).toEqual({ bankAccountConfigured: true });
  });

  it('sanitizes change-request actors as well as before/after snapshots', () => {
    const result = employeeDataChangeView({ createdBy: { id: 'hr', passwordHash: 'secret' },
      proposedValue: { profile: { bankAccountFingerprint: 'hash' } } });
    expect(result.createdBy).toEqual({ id: 'hr' });
    expect(result.proposedValue.profile).toEqual({ bankAccountConfigured: true });
  });
});
