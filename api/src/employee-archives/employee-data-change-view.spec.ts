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
