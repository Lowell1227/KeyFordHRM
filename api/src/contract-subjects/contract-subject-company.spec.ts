import { normalizeContractSubject, validateContractSubject } from './contract-subject-reference';

const subjectId = '11111111-1111-4111-8111-111111111111';
const client = (internalCompany: string | null = 'fansibao') => ({ contractSubject: {
  findUnique: jest.fn().mockResolvedValue({ id: subjectId, name: 'Synthetic subject', isActive: true, internalCompany }),
} });

describe('employee company mapping boundaries', () => {
  it.each([undefined, 'fuede'])('derives new selections from the directory, ignoring caller company %s', async company => {
    const value: any = { contractSubjectId: subjectId, company, companyText: 'Forged' };
    await normalizeContractSubject(client() as any, value, {}, 'companyText');
    expect(value).toMatchObject({ company: 'fansibao', companyText: 'Synthetic subject' });
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
});
