import { employeeDataChangeView, employeeArchiveView } from './employee-data-change-view';

describe('employee archive public response', () => {
  it('marks replacement of configured secrets before removing their fingerprints', () => {
    const result: any = employeeDataChangeView({
      baseValue: { profile: { idNumberFingerprint: 'old-id', bankAccountFingerprint: 'old-bank' } },
      proposedValue: { profile: { idNumberFingerprint: 'new-id', bankAccountFingerprint: 'new-bank' } },
      revisionHistory: [{ baseValue: { profile: { idNumberFingerprint: 'old-id' } },
        proposedValue: { profile: { idNumberFingerprint: 'new-id' } } }],
    });
    expect(result.changedFields).toEqual(['profile.idNumber', 'profile.bankAccount']);
    expect(result.revisionHistory[0].changedFields).toEqual(['profile.idNumber']);
    expect(JSON.stringify(result)).not.toMatch(/old-id|new-id|old-bank|new-bank|Fingerprint/);
  });

  it('does not invent replacements from configuration flags or randomized ciphertext', () => {
    const result: any = employeeDataChangeView({
      baseValue: { profile: { idNumberConfigured: true, bankAccountFingerprint: 'same', bankAccountEncrypted: 'cipher1' } },
      proposedValue: { profile: { idNumberConfigured: true, bankAccountFingerprint: 'same', bankAccountEncrypted: 'cipher2' } },
    });
    expect(result.changedFields ?? []).toEqual([]);
    expect(result.changedFields).toEqual([]);
  });

  it('filters persisted change markers to the public field allowlist', () => {
    const result: any = employeeDataChangeView({ changedFields: ['profile.idNumber', 'secret-text', 'passwordHash'] });
    expect(result.changedFields).toEqual(['profile.idNumber']);
  });
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

  it.each([employeeDataChangeView, employeeArchiveView])('keeps initialization evidence ciphertext out of public views', (view) => {
    const stored = {
      sourceEvidenceEncrypted: 'source-ciphertext',
      proposedValue: { employee: { employeeNo: 'SYNTHETIC-1' }, initializationPreviousEncrypted: 'previous-ciphertext' },
      history: [{ sourceEvidenceEncrypted: 'nested-source', initializationPreviousEncrypted: 'nested-previous', source: { rowNumber: 3 } }],
    };

    expect(view(stored)).toEqual({
      proposedValue: { employee: { employeeNo: 'SYNTHETIC-1' } },
      history: [{ source: { rowNumber: 3 } }],
    });
    expect(stored.sourceEvidenceEncrypted).toBe('source-ciphertext');
    expect(stored.proposedValue.initializationPreviousEncrypted).toBe('previous-ciphertext');
  });
});
