import { normalizeContractSubject, validateContractSubject } from './contract-subject-reference';

const subjectId = '11111111-1111-4111-8111-111111111111';
const client = (internalCompany: string | null = 'fansibao') => ({ contractSubject: {
  findUnique: jest.fn().mockResolvedValue({ id: subjectId, name: 'Synthetic subject', isActive: true, internalCompany }),
} });

describe('employee company directory boundaries', () => {
  it.each([undefined, 'fuede'])('freezes new directory selections without assigning a legacy code %s', async company => {
    const value: any = { contractSubjectId: subjectId, company, companyText: 'Forged' };
    await normalizeContractSubject(client() as any, value, {}, 'companyText');
    expect(value).toMatchObject({ company: null, companyText: 'Synthetic subject' });
    await expect(validateContractSubject(client(null) as any, value, {}, 'companyText')).resolves.toBeUndefined();
  });

  it('never infers a company from the subject name and permits an incomplete draft', async () => {
    const db = client(null);
    db.contractSubject.findUnique.mockResolvedValue({ id: subjectId, name: 'fuede', isActive: true, internalCompany: null });
    const value: any = { contractSubjectId: subjectId, company: 'fuede' };
    await normalizeContractSubject(db as any, value, {}, 'companyText');
    expect(value.company).toBeNull();
  });

  it('does not couple signing-company references to employee mappings', async () => {
    const value = { contractSubjectId: subjectId, signingCompany: 'Forged' };
    await normalizeContractSubject(client(null) as any, value, {}, 'signingCompany');
    await validateContractSubject(client(null) as any, value, {});
    expect(value).toEqual({ contractSubjectId: subjectId, signingCompany: 'Synthetic subject' });
  });

  it.each([{}, { contractSubjectId: null }])('leaves legacy no-subject company codes unchanged: %s', async extra => {
    const value = { company: 'beijing_fuede', ...extra };
    await normalizeContractSubject({} as any, value, {}, 'companyText');
    expect(value.company).toBe('beijing_fuede');
  });

  it('preserves missing historical company data during unrelated changes', async () => {
    const value: any = { position: 'New position' };
    await normalizeContractSubject({} as any, value, { company: null, companyText: null, contractSubjectId: null }, 'companyText');
    await expect(validateContractSubject({} as any, value, {}, 'companyText')).resolves.toBeUndefined();
    expect(value.company).toBeNull();
  });

  it('rejects invalid legacy codes even without a subject', async () => {
    await expect(validateContractSubject({} as any, { company: 'guessed' }, {}, 'companyText')).rejects.toThrow();
  });

  it.each([undefined, null])('retains an unlinked historical company snapshot when no directory selection changes: %s', async id => {
    const value: any = { contractSubjectId: id };
    await normalizeContractSubject({} as any, value,
      { contractSubjectId: null, company: null, companyText: 'Historical company' }, 'companyText');
    expect(value).toMatchObject({ company: null, companyText: 'Historical company' });
  });
});
